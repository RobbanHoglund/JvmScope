import {
    certificateCommonName,
    classifyTlsFailureEvidence,
    deriveTlsDirection,
    resolveTlsPeerHost,
    summarizeTlsTransportFailure,
    TLS_FAILURE_HIGHLIGHT,
    readTlsAlert,
    isTlsCorrelationAmbiguous,
} from './tls-core.js';
import { readTlsRecords } from './tls-log-records.js';

// Typical JSSE line:
// javax.net.ssl|ALL|E4|ForkJoinPool.commonPool-worker-1|2026-03-04 08:18:36.531 GMT|null:-1|message...
const SNI_VALUE = /\bserver_name\b.*?\bvalue\s*=\s*([a-zA-Z0-9.-]+)/i;
const HOST_NAME_VALUE = /type\s*=\s*host_name\s*\(\d+\)\s*,\s*value\s*=\s*([a-zA-Z0-9.-]+)/i;
const NEGOTIATED_CIPHER = /\bcipher suite"?\s*[:=]\s*"?((?:TLS|SSL)_[A-Z0-9_]+)/i;

const SNI = /server_name\s*:\s*(\S+)/i;
const HOST = /\bpeer host\s*:\s*(\S+)/i;

const PRODUCED_CLIENT_CERTIFICATE =
    /^(?:Produced|Consuming)\s+client\s+Certificate(?:\s+handshake)?\s+message\b/i;

const CERTIFICATE_REQUEST_MESSAGE =
    /^(?:Consuming\s+|Produced\s+)?CertificateRequest\s+(?:handshake\s+)?message\b/i;

const CERTIFICATE_AUTHORITIES_START =
    /"certificate\s+authorities"\s*:\s*\[/i;

const CERT_SUBJECT_VALUE =
    /"subject"\s*:\s*"([^"]+)"/i;

const CERT_MESSAGE_END =
    /^\s*\)\s*$/;
	
function captureFailureReason(interaction, text) {
    if (!text) return;
    const evidence = classifyTlsFailureEvidence(text, {
        sawHandshakeFinished: interaction.sawHandshakeFinished,
    });
    if (!evidence) return;

    interaction.failureEvidence ||= [];
    interaction.failureEvidence.push(evidence);

    if (!evidence.promotesHandshakeFailure) return;

    if (
        interaction.failureReasonPriority == null ||
        evidence.priority >= interaction.failureReasonPriority
    ) {
        interaction.failureReason = evidence.text;
        interaction.failureReasonPriority = evidence.priority;
    }
}

class Interaction {
    constructor() {
        this.rawLines = [];
        // Source positions are presentation metadata. Keep connection grouping,
        // failure classification and the complete raw record projection unchanged.
        this.observedRecords = [];
        this.threads = new Set();
		this.tids = new Set();
        this.startTs = Number.MAX_SAFE_INTEGER;
        this.endTs = Number.MIN_SAFE_INTEGER;
        this.startTsRaw = null;
        this.endTsRaw = null;
        this._lastObservedTs = null;
        this._missingClock = false;
        this._reversedClock = false;

        this.negotiatedCipherSuite = null;

        this.tlsVersion = null;
        this.cipherSuite = null;
        this.sni = null;
        this.peerHost = null;
        this.failureReason = null;
		this.failureReasonPriority = -1;
		this.failureEvidence = [];

        this.sawClientHello = false;
        this.sawServerHello = false;
        this.sawCertRequest = false;
        this.sawClientCertSelectionFailure = false;
        this.sawHandshakeFinished = false;
        this.producedFinished = false;
        this.consumedFinished = false;
        this.helloRetryPending = false;
        this.correlationQuality = 'thread-based';
        this.correlationWarnings = [];
        this._serverHelloCount = 0;
        this._finishedMessages = new Set();
        this._localEndpointRole = null;
        this._messageKind = null;
        this._protocolExplicit = false;

        this.outcome = 'unknown';


        this.direction = 'unknown';

        this.initiatedByLocal = false;
        this.initiatedByPeer = false;


        this.warningHighlights = [];
		
		this.sawProducedClientCertificate = false;
		this.clientCertSubject = null;
		this.clientCertSubjectCn = null;

		this.certificateAuthorities = [];
		this.certificateAuthoritiesRaw = null;
		this.certificateAuthoritiesText = null;
		this.sawCertificateAuthoritiesBlock = false;

		this._captureProducedClientCertificate = false;
		this._clientCertCaptureBudget = 0;
		this._captureCertificateRequest = false;
		this._captureCertificateAuthorities = false;
		this._certificateRequestCaptureBudget = 0;
    }

    hasAnyContent() {
        return this.rawLines.length > 0;
    }

    isRealHandshakeInteraction() {
        return (
            this.sawClientHello ||
            this.sawServerHello ||
            this.initiatedByLocal ||
            this.initiatedByPeer ||
            this.sawHandshakeFinished ||
            this.sawCertRequest ||
            this.failureReason
        );
    }
	
	captureProducedClientCertificateSubject(text) {
	    if (!text) return;

	    if (PRODUCED_CLIENT_CERTIFICATE.test(text)) {
	        this.sawProducedClientCertificate = true;
	        this._captureProducedClientCertificate = true;
	        this._clientCertCaptureBudget = 160;
	    }

	    if (!this._captureProducedClientCertificate || this.clientCertSubject) return;

        const subjectMatch = text.match(/"subject"\s*:\s*"(.*)"\s*,?\s*$/) || text.match(CERT_SUBJECT_VALUE) || (this._legacyRecord && text.match(/^\s*Subject:\s*(.+)$/));
	    if (subjectMatch) {
	        this.clientCertSubject = subjectMatch[1].trim();

            this.clientCertSubjectCn = certificateCommonName(this.clientCertSubject) || this.clientCertSubject;

	        this._captureProducedClientCertificate = false;
	        this._clientCertCaptureBudget = 0;
	        return;
	    }

	    this._clientCertCaptureBudget -= 1;

	    if (this._clientCertCaptureBudget <= 0 || CERT_MESSAGE_END.test(text)) {
	        this._captureProducedClientCertificate = false;
	    }
	}

	captureCertificateRequestAuthorities(text) {
	    if (!text) return;

        if (this._legacyRecord && this._captureCertificateRequest && /^Cert Authorities:/.test(text)) {
            this.sawCertificateAuthoritiesBlock = true;
            this._captureCertificateAuthorities = true;
            return;
        }
        if (this._legacyRecord && this._captureCertificateAuthorities) {
            const authority = text.match(/^<(.+)>$/);
            if (authority) this.addCertificateAuthority(authority[1]);
            else { this._captureCertificateRequest = false; this._captureCertificateAuthorities = false; this.certificateAuthoritiesComplete = true; }
            return;
        }

	    if (CERTIFICATE_REQUEST_MESSAGE.test(text)) {
	        this.sawCertRequest = true;
	        this._captureCertificateRequest = true;
	        this._captureCertificateAuthorities = false;
	        this._certificateRequestCaptureBudget = 250;
	    }

	    if (!this._captureCertificateRequest) return;

	    if (!this._captureCertificateAuthorities) {
	        const startMatch = text.match(CERTIFICATE_AUTHORITIES_START);
	        if (startMatch) {
	            this.sawCertificateAuthoritiesBlock = true;
	            this._captureCertificateAuthorities = true;
	            const afterStart = text.slice(startMatch.index + startMatch[0].length);
	            this.captureCertificateAuthorityLine(afterStart);
	        }
	    } else {
	        this.captureCertificateAuthorityLine(text);
	    }

	    this._certificateRequestCaptureBudget -= 1;
	    if (
	        this._certificateRequestCaptureBudget <= 0 ||
	        (!this._captureCertificateAuthorities && CERT_MESSAGE_END.test(text))
	    ) {
	        this._captureCertificateRequest = false;
	        this._captureCertificateAuthorities = false;
	    }
	}

	captureCertificateAuthorityLine(text) {
	    if (!this._captureCertificateAuthorities || text == null) return;

        let quote = false;
        let escaped = false;
        let closeIdx = -1;
        for (let index = 0; index < text.length; index++) {
            if (escaped) { escaped = false; continue; }
            if (text[index] === '\\') { escaped = true; continue; }
            if (text[index] === '"') quote = !quote;
            if (text[index] === ']' && !quote) { closeIdx = index; break; }
        }
	    const content = closeIdx >= 0 ? text.slice(0, closeIdx) : text;

	    this.addCertificateAuthoritiesFromContent(content);

	    if (closeIdx >= 0) {
            this.certificateAuthoritiesComplete = true;
	        this._captureCertificateAuthorities = false;
	        this._captureCertificateRequest = false;
	        this._certificateRequestCaptureBudget = 0;
	    }
	}

	addCertificateAuthoritiesFromContent(content) {
	    if (!content) return;
        if (!content.trimStart().startsWith('"')) {
            this.addCertificateAuthority(content);
            return;
        }

	    const quoted = Array.from(content.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
	    if (quoted.length) {
	        quoted.forEach((value) => this.addCertificateAuthority(value));
	        return;
	    }

	    this.addCertificateAuthority(content);
	}

	addCertificateAuthority(value) {
	    let normalized = String(value || '').trim();
	    normalized = normalized.replace(/,+$/g, '').trim();
        if (normalized.startsWith('"') && normalized.endsWith('"')) normalized = normalized.slice(1, -1);
	    if (!normalized) return;

	    if (!this.certificateAuthorities.includes(normalized)) {
	        this.certificateAuthorities.push(normalized);
	        this.certificateAuthoritiesRaw = this.certificateAuthorities.join('\n');
	        this.certificateAuthoritiesText = this.certificateAuthorities.join(' | ');
	    }
	}

    addRawLine(line, pl, parseDetails = true) {
        this.rawLines.push(line);
        if (!pl && !parseDetails) return;
        const text = pl?.msg || line;
        if (pl) {
            this._legacyRecord = pl.format === 'legacy';
            this._failureDetails = /Fatal\s*\(|exception|fatal alert|handshake failed/i.test(text);
            this._messageKind = /\bServerHello\b/.test(text) ? 'server-hello' : /\bClientHello\b/.test(text) ? 'client-hello' : null;
            this._sniDetails = this._messageKind === 'client-hello' || /(?:extension\s*[: ]\s*server_name|^server_name\b)/i.test(text);
            this._serverHelloComplete = pl.completeBody || pl.format === 'legacy';
            this._captureProducedClientCertificate = false;
            this._captureCertificateRequest = false;
            this._captureCertificateAuthorities = false;
            if (pl.format === 'legacy' && !isTlsCorrelationAmbiguous(this)) this.correlationQuality = pl.ambiguous ? 'ambiguous-legacy' : 'unscoped-legacy';
        }
        const negotiatedVersion = pl && text.match(/^Negotiated (?:protocol version|TLS version):?\s*(TLSv1(?:\.[0-3])?)/i);
        const selectedVersion = this._messageKind === 'server-hello' && text.match(/"selected version"\s*:\s*\[?(TLSv1(?:\.[0-3])?)/);
        const serverVersion = this._messageKind === 'server-hello' && text.match(/(?:"server version"\s*:\s*"|\*\*\* ServerHello,\s*)(TLSv1(?:\.[0-3])?)/);
        if (negotiatedVersion || selectedVersion) {
            this.tlsVersion = (negotiatedVersion || selectedVersion)[1];
            this._protocolExplicit = true;
        } else if (serverVersion && !this._protocolExplicit && this._serverHelloComplete) this.tlsVersion = serverVersion[1];
        const selectedCipher = text.match(NEGOTIATED_CIPHER);
        if (selectedCipher && (this._messageKind === 'server-hello' || (pl && /^Negotiated cipher suite/i.test(text)))) this.negotiatedCipherSuite = selectedCipher[1];
        if (pl && /^(?:Produced|Consuming) HelloRetryRequest\b/.test(text)) this.helloRetryPending = true;

        this.captureCertificateRequestAuthorities(pl?.msg || line);

		this.captureProducedClientCertificateSubject(pl?.msg || line);
		
        // highlights
        if ((pl || this._failureDetails) && TLS_FAILURE_HIGHLIGHT.test(line)) {
            this.warningHighlights.push(line);
        }

        // Interpret exception details only inside a diagnostic record.
        if (!pl && this._failureDetails) {
		    captureFailureReason(this, line);
		}


        // SNI extraction from any line (structured details)
        if (!this.sni && this._sniDetails) {
            const hn = line.match(HOST_NAME_VALUE);
            if (hn) this.sni = hn[1];
        }
        if (!this.sni && this._sniDetails) {
            const sn2 = line.match(SNI_VALUE);
            if (sn2) this.sni = sn2[1];
        }

        if (!pl) return;

        if (pl.thread != null) this.threads.add(pl.thread);
		if (pl.tid) this.tids.add(pl.tid);

        if (pl.epochMillis >= 0) {
            if (this._lastObservedTs != null && pl.epochMillis < this._lastObservedTs) this._reversedClock = true;
            this._lastObservedTs = pl.epochMillis;
            if (pl.epochMillis < this.startTs) {
                this.startTs = pl.epochMillis;
                this.startTsRaw = pl.tsRaw;
            }
            if (pl.epochMillis > this.endTs) {
                this.endTs = pl.epochMillis;
                this.endTsRaw = pl.tsRaw;
            }
        } else this._missingClock = true;

        const msg = pl.msg;

        if (!this._legacyRecord) {
            const hello = msg.match(/^(Produced|Consuming) (ClientHello|ServerHello|HelloRetryRequest)\b/);
            const explicit = msg.match(/^(Produced|Consuming) (client|server) (?:Finished|Certificate(?:Verify)?)(?: handshake)? message\b/);
            const certificateRequest = msg.match(/^(Produced|Consuming) CertificateRequest\b/);
            const observation = hello || explicit || certificateRequest;
            if (observation) {
                const senderRole = hello ? hello[2] === 'ClientHello' ? 'client' : 'server'
                    : explicit ? explicit[2] : 'server';
                const localRole = observation[1] === 'Produced' ? senderRole : senderRole === 'client' ? 'server' : 'client';
                if (this._localEndpointRole && this._localEndpointRole !== localRole) {
                    this.markCorrelationAmbiguous('Handshake endpoint roles conflict across produced/consumed observations. Records may belong to different connections.');
                } else this._localEndpointRole = localRole;
            }
        }

        if (/^(?:Produced|Consuming) ServerHello\b/.test(msg) && ++this._serverHelloCount > 1) {
            this.markCorrelationAmbiguous('Multiple ServerHello observations in one thread group. Records may belong to different connections.');
        }
        const finished = msg.match(/^(Produced|Consuming) (?:(client|server) )?Finished handshake message/);
        if (finished && !this._legacyRecord) {
            const key = `${finished[1]}:${finished[2] || ''}`;
            if (this._finishedMessages.has(key)) this.markCorrelationAmbiguous('Repeated Finished observations cannot establish a single connection exchange.');
            this._finishedMessages.add(key);
        }

        if (msg.includes('Produced ClientHello')) this.initiatedByLocal = true;
        if (msg.includes('Consuming ClientHello')) this.initiatedByPeer = true;


        if (/^(?:Produced|Consuming|Legacy) ClientHello\b/.test(msg)) this.sawClientHello = true;
        if (/^(?:Produced|Consuming) ServerHello\b/.test(msg)) this.sawServerHello = true;
        if (msg.toLowerCase().includes('certificaterequest')) this.sawCertRequest = true;
        if (msg.includes('No X.509 cert selected')) this.sawClientCertSelectionFailure = true;

        if (/^Produced (?:client |server )?Finished handshake message/.test(msg)) this.producedFinished = true;
        if (/^Consuming (?:client |server )?Finished handshake message/.test(msg)) this.consumedFinished = true;
        if (/^Handshake (?:completed|finished)\b/i.test(msg) || (this.producedFinished && this.consumedFinished)) this.sawHandshakeFinished = true;
        if (!this.sni && this._sniDetails) {
            const sn = msg.match(SNI);
            if (sn) this.sni = sn[1];
            if (!this.sni) {
                const sn2b = msg.match(SNI_VALUE);
                if (sn2b) this.sni = sn2b[1];
            }
        }

        if (!this.peerHost) {
            const h = msg.match(HOST);
            if (h) this.peerHost = h[1];
        }


		captureFailureReason(this, msg);
    }

    markCorrelationAmbiguous(reason, quality = this._legacyRecord ? 'ambiguous-legacy' : 'ambiguous-thread') {
        this.correlationQuality = quality;
        if (!this.correlationWarnings.includes(reason)) this.correlationWarnings.push(reason);
    }

    finalizeSummary() {
        const transportFailure = summarizeTlsTransportFailure(this.failureReason, {
            sawClientHello: this.sawClientHello,
            sawServerHello: this.sawServerHello,
        });
        if (transportFailure) this.failureReason = transportFailure;

        if (this.sawHandshakeFinished && !this.failureReason) {
            this.outcome = 'success';
        }			 else if (this.failureReason) {
            this.outcome = 'failure';
        } else {
            this.outcome = 'unknown';
        }


        if (this.outcome === 'unknown') {
            if (this.sawClientHello && this.tlsVersion && !this.failureReason && !this.sawHandshakeFinished) {
				this.outcomeDetail =
				    `Handshake started, but no final outcome was captured. ClientHello and ${this.tlsVersion} were observed, but the log does not show handshake completion or a fatal error.`;
            } else if (this.sawClientHello && !this.failureReason) {
                this.outcomeDetail =
                    'Handshake started, but no final success or failure was captured in the available log lines.';
            }
        }

        this.direction = deriveTlsDirection({
            initiatedByLocal: this.initiatedByLocal,
            initiatedByPeer: this.initiatedByPeer,
        });
        this.peerHostSource = this.peerHost ? 'explicit' : this.direction === 'outbound' && this.sni ? 'outbound-sni' : null;
        this.peerHost = resolveTlsPeerHost({
            peerHost: this.peerHost,
            sni: this.sni,
            direction: this.direction,
        });

        if (this.negotiatedCipherSuite) {
            this.cipherSuite = this.negotiatedCipherSuite;
        }

        this.threadCount = this.tids.size || this.threads.size || null;
		this.tidDisplay = this.tids.size > 0 ? Array.from(this.tids).join(', ') : '—';
        this.warnCount = this.warningHighlights.length + this.correlationWarnings.length;
		this.lineCount = this.rawLines.length;

        if (isTlsCorrelationAmbiguous(this)) {
            this.outcome = 'unknown';
            this.direction = 'unknown';
            this.tlsVersion = null;
            this.cipherSuite = null;
            this.peerHost = null;
            this.peerHostSource = null;
            this.sni = null;
            this.failureReason = null;
            this.clientCertSubject = null;
            this.clientCertSubjectCn = null;
            this.certificateAuthorities = [];
            this.certificateAuthoritiesRaw = null;
            this.certificateAuthoritiesText = null;
            this.certificateAuthoritiesComplete = false;
            this.clientCertificateEmpty = false;
            this.sawHandshakeFinished = false;
            this.outcomeDetail = this.correlationQuality === 'ambiguous-thread'
                ? 'Conflicting handshake observations on one JVM thread cannot be attributed to a single connection. Inspect the raw records; outcome and negotiated/certificate facts remain unknown.'
                : 'Unresolved or interleaved legacy handshakes have no reliable connection identity for their bodies. Inspect the raw records; outcomes remain unknown.';
        }
        this.timeQuality = this._missingClock ? 'unavailable' : this._reversedClock ? 'reversed' : 'reliable';
        this.durationMs =
            this.timeQuality === 'reliable' && this.startTs !== Number.MAX_SAFE_INTEGER && this.endTs !== Number.MIN_SAFE_INTEGER
                ? Math.max(0, this.endTs - this.startTs)
                : -1;
    }
}

export function splitIntoInteractionsFromLines(lines) {
    const result = [];
    const currentByThread = new Map();
    const records = readTlsRecords(lines);
    const finish = key => {
        const interaction = currentByThread.get(key);
        if (interaction?.isRealHandshakeInteraction()) result.push(interaction);
        currentByThread.delete(key);
    };
    for (const record of records) {
        const pl = record.pl;
        const key = pl.tid ? 'tid:' + pl.tid.toUpperCase() : 'legacy';
        let current = currentByThread.get(key);
        const clientHello = /^(?:Produced|Consuming|Legacy) ClientHello\b/.test(pl.msg);
        let boundaryWarning = null;
        if (clientHello && current?.hasAnyContent()) {
            if (current.sawClientHello && current.helloRetryPending && !current.sawHandshakeFinished && !current.failureReason) current.helloRetryPending = false;
            else {
                // A JVM thread is not a connection ID. A new ClientHello cannot
                // retire an unfinished handshake or make its later records attributable.
                if (current.isRealHandshakeInteraction()
                    && (isTlsCorrelationAmbiguous(current) || (!current.sawHandshakeFinished && !current.failureReason))) {
                    boundaryWarning = pl.format === 'legacy'
                        ? 'A new legacy ClientHello follows an unresolved handshake; subsequent records have no reliable connection identity.'
                        : 'A new ClientHello shares a JVM thread with an unresolved handshake; subsequent records have no reliable connection identity.';
                    current.markCorrelationAmbiguous(boundaryWarning);
                }
                finish(key);
                current = null;
            }
        }
        if (!current) { current = new Interaction(); currentByThread.set(key, current); }
        if (boundaryWarning) current.markCorrelationAmbiguous(boundaryWarning, pl.format === 'legacy' ? 'ambiguous-legacy' : 'ambiguous-thread');
        current.observedRecords.push({
            message: pl.msg, epochMillis: pl.epochMillis, tsRaw: pl.tsRaw,
            format: pl.format, prefixLength: record.prefixLength,
            rawStart: current.rawLines.length,
            rawEnd: current.rawLines.length + record.rawLines.length,
            sourceStart: record.sourceStart,
        });
        pl.completeBody = record.rawLines.some(line => /^\)\s*$/.test(line)) || /\}\)\s*$/.test(pl.msg)
            || (pl.format === 'expanded' && record.rawLines.some(line => /^\}\s*$/.test(line)));
        current.addRawLine(record.rawLines[0], pl);
        let details = pl.format !== 'compact' || /\(\s*$/.test(pl.msg);
        for (let i = 1; i < record.rawLines.length; i++) {
            // Expanded headers are metadata; the actual message is already processed.
            const metadata = i < record.prefixLength;
            current.addRawLine(record.rawLines[i], null, details && !metadata);
            if (pl.format === 'compact' && /^\)\s*$/.test(record.rawLines[i])) details = false;
            if (pl.format === 'expanded' && /^\}\s*$/.test(record.rawLines[i])) details = false;
        }
        if (PRODUCED_CLIENT_CERTIFICATE.test(pl.msg)
            && /"certificate_list"\s*:\s*\[\s*\]/.test(record.rawLines.join('\n'))) current.clientCertificateEmpty = true;
        const alert = readTlsAlert(pl.msg, record.rawLines);
        if (alert?.reason) captureFailureReason(current, alert.reason);
    }
    for (const key of currentByThread.keys()) finish(key);
    result.forEach((interaction, index) => { interaction.finalizeSummary(); interaction.id = index + 1; });
    return result;
}

export function analyzeTlsLog(text) {
    const interactions = splitIntoInteractionsFromLines(String(text ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n'));
    const warnings = [];
    if (!interactions.length) warnings.push('No recognizable SunJSSE handshake or TLS failure was found. Use javax.net.debug=ssl,handshake; custom logging formats may need conversion.');
    if (interactions.some(item => item.correlationQuality === 'ambiguous-legacy')) warnings.push('Unresolved or interleaved legacy handshake bodies cannot be assigned reliably. Results remain unknown; capture each connection separately.');
    if (interactions.some(item => item.correlationQuality === 'ambiguous-thread')) warnings.push('Conflicting handshake records share a JVM thread. Their connection identity is ambiguous; outcomes remain unknown. Capture the connections separately.');
    return { interactions, warnings, status: !interactions.length ? 'unsupported' : warnings.length ? 'partial' : 'success' };
}
