// SunJSSE console output is not JSON and is not a stable public API.
const COMPACT = /^javax\.net\.ssl\|(?<level>[^|]+)\|(?<tid>[^|]+)\|(?<thread>.*?)\|(?<ts>\d{4}-\d{2}-\d{2} [^|]+)\|(?<src>[^|]*)\|(?<msg>.*)$/;
const LEGACY_RECORD = /^(?<thread>.+?),\s*(?<action>READ|WRITE):\s*(?:TLSv?\d(?:\.\d)?|SSLv\d)/;

export function parseTsUtcMillis(raw) {
    const match = String(raw).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) (.+)$/);
    if (!match) return -1;
    const [, year, month, day, clockHour, minute, second, ms, zone] = match;
    // SSLLogger uses Java's kk (1–24), where 24:xx is midnight on this date.
    const hour = clockHour === '24' ? '00' : clockHour;
    const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, +ms));
    if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day
        || date.getUTCHours() !== +hour || date.getUTCMinutes() !== +minute || date.getUTCSeconds() !== +second) return -1;
    const zones = { UTC: '+00:00', GMT: '+00:00', CET: '+01:00', CEST: '+02:00', EST: '-05:00', EDT: '-04:00', CST: '-06:00', CDT: '-05:00', MST: '-07:00', MDT: '-06:00', PST: '-08:00', PDT: '-07:00', JST: '+09:00' };
    // Ambiguous abbreviations (e.g. CST) must not be assigned a guessed offset.
    const offset = zone === 'CST' ? null : (zones[zone] || zone.match(/^(?:GMT|UTC)?([+-]\d{2}:?\d{2})$/)?.[1]);
    if (!offset) return -1;
    const value = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${offset}`);
    return Number.isFinite(value) ? value : -1;
}

export function parseLine(line) {
    const groups = String(line).match(COMPACT)?.groups;
    return groups ? { ...groups, tsRaw: groups.ts, epochMillis: parseTsUtcMillis(groups.ts), format: 'compact' } : null;
}

export function readTlsRecords(input) {
    const lines = input.map(line => String(line).replace(/\x1b\[[0-9;]*m/g, ''));
    if (lines.length) lines[0] = lines[0].replace(/^\uFEFF/, '');
    const records = [];
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        let pl = parseLine(lines[i]);
        let prefixEnd = i;
        if (!pl && lines[i].trim() === '{' && /^\s*"logger"\s*:\s*"javax.net.ssl"/.test(lines[i + 1] || '')) {
            const fields = {};
            for (let j = i + 1; j <= Math.min(i + 8, lines.length - 1); j++) {
                const field = lines[j].match(/^\s*"([^"]+)"\s*:\s*"(.*)"[,]?\s*$/);
                if (field) fields[field[1]] = field[2];
                if (field?.[1] === 'message') { prefixEnd = j; break; }
            }
            if (fields.message != null && fields['thread id'] != null) pl = {
                msg: fields.message, thread: fields['thread name'], tid: fields['thread id'],
                tsRaw: fields.time, epochMillis: parseTsUtcMillis(fields.time), src: fields.caller, format: 'expanded',
            };
        }
        if (pl) {
            current = { pl, rawLines: lines.slice(i, prefixEnd + 1), prefixLength: prefixEnd - i + 1, sourceStart: i + 1 };
            records.push(current);
            i = prefixEnd;
        } else if (current) current.rawLines.push(lines[i]);
    }
    if (records.length) return records;
    // Old SunJSSE prints handshake bodies without thread IDs or timestamps.
    // A shared, interleaved legacy stream cannot be correlated reliably.
    const legacyNames = new Set(lines.map(line => line.match(LEGACY_RECORD)?.groups?.thread).filter(Boolean));
    const ambiguous = legacyNames.size > 1;
    const thread = legacyNames.size === 1 ? [...legacyNames][0] : null;
    let action = null;
    let role = null;
    let sawCertificateRequest = false;
    let pendingHello = null;
    for (const [lineIndex, line] of lines.entries()) {
        const record = line.match(LEGACY_RECORD)?.groups;
        if (record) action = record.action;
        let message = null;
        if (/^\*\*\* ClientHello\b/.test(line)) {
            sawCertificateRequest = false;
            role = action === 'READ' ? 'server' : null;
            message = role === 'server' ? 'Consuming ClientHello handshake message' : 'Legacy ClientHello';
        } else if (/^\*\*\* ServerHello,/.test(line)) {
            message = `${role === 'server' ? 'Produced' : 'Consuming'} ServerHello handshake message ${line}`;
        } else if (/^\*\*\* Finished\s*$/.test(line)) {
            message = `${action === 'READ' ? 'Consuming' : 'Produced'} Finished handshake message`;
        } else if (/^\*\*\* CertificateRequest/.test(line)) {
            sawCertificateRequest = true;
            message = 'CertificateRequest handshake message';
        } else if (/^\*\*\* Certificate chain/.test(line)) {
            message = sawCertificateRequest ? `${role === 'server' ? 'Consuming' : 'Produced'} client Certificate message` : 'Server Certificate message';
        }
        else if (record || /(?:SEND|RECV).*ALERT:|handling exception:|SSLHandshakeException:/.test(line)) message = line;
        if (record?.action === 'WRITE' && role == null && pendingHello) {
            pendingHello.pl.msg = 'Produced ClientHello handshake message';
            pendingHello = null;
            role = 'client';
        }
        if (message) {
            current = { pl: { msg: message, thread, tid: null, epochMillis: -1, tsRaw: null, format: 'legacy', ambiguous }, rawLines: [line], prefixLength: 1, sourceStart: lineIndex + 1 };
            records.push(current);
            if (message === 'Legacy ClientHello') pendingHello = current;
        } else if (current) current.rawLines.push(line);
    }
    return records;
}
