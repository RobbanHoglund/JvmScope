import assert from 'node:assert/strict';
import { createWriteStream, readFileSync, existsSync, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { manifest, selection, saveJson, safeFile, json } from './model.mjs';

const API = 'https://api.foojay.io/disco/v3.0/';
export async function fetchJson(url, fetcher = fetch) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await fetcher(url, { signal: AbortSignal.timeout(30000) });
            if (!r.ok) throw new Error(`Discovery HTTP ${r.status}: ${url}`);
            const value = await r.json();
            assert.ok(Array.isArray(value.result), 'Invalid discovery response'); return value.result;
        } catch (e) { last = e; if (attempt < 2) await delay(500 * (attempt + 1)); }
    }
    throw last;
}
export function choosePackage(packages, major, distribution) {
    return packages.filter(p => p.major_version === major && p.distribution === distribution
        && p.release_status === manifest.releaseStatus && p.operating_system === 'linux'
        && ['x64', 'amd64', 'x86_64'].includes(p.architecture) && p.lib_c_type === 'glibc' && p.archive_type === 'tar.gz'
        && p.package_type === 'jdk' && p.directly_downloadable === true && p.javafx_bundled === false)
        .sort((a, b) => a.java_version.localeCompare(b.java_version, 'en', { numeric: true }) || a.id.localeCompare(b.id)).at(-1);
}
export function boundMatrix(entries) {
    assert.ok(entries.length <= 256, 'More than 256 available JVMs. Select a subset of versions/vendors and run separate captures; nothing was truncated.');
    return entries.map(({ key }) => ({ key }));
}
export async function discover({ versions = 'all', vendors = 'all', material = 'all', runId, sourceCommit, fetcher = fetch }) {
    assert.ok(['all', 'tda', 'tls'].includes(material));
    assert.match(runId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
    const chosenVersions = selection(versions, manifest.versions, 'Java versions');
    const chosenVendors = selection(vendors, manifest.distributions, 'vendors');
    const pairs = chosenVersions.flatMap(major => chosenVendors.map(distribution => ({ key: `${distribution}-${major}`, major, distribution })));
    const entries = new Array(pairs.length); let next = 0;
    // Four bounded requests; transient API failures remain errors rather than unavailable packages.
    await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < pairs.length) {
            const i = next++, pair = pairs[i];
            try {
                const parameters = new URLSearchParams({ distribution: pair.distribution, version: String(pair.major), architecture: 'x64',
                    operating_system: 'linux', archive_type: 'tar.gz', package_type: 'jdk', directly_downloadable: 'true', latest: 'available', release_status: 'ga' });
                const url = API + 'packages?' + parameters;
                const packages = await fetchJson(url, fetcher);
                assert.ok(packages.every(p => typeof p.id === 'string' && Number.isInteger(p.major_version)
                    && typeof p.distribution === 'string' && typeof p.java_version === 'string'), 'Invalid package catalog schema');
                const pkg = choosePackage(packages, pair.major, pair.distribution);
                if (!pkg) entries[i] = { ...pair, status: 'unavailable', error: 'No directly downloadable GA Linux x64 glibc JDK in the catalog', discoveryUrl: url };
                else {
                    const infoUrl = API + 'ids/' + pkg.id;
                    const info = (await fetchJson(infoUrl, fetcher))[0];
                    assert.ok(info && /^https:\/\//.test(info.direct_download_uri), 'No HTTPS package download');
                    if (info.checksum) {
                        const lengths = { md5: 32, sha1: 40, sha256: 64, sha512: 128 };
                        assert.ok(lengths[info.checksum_type], 'Unknown catalog checksum algorithm');
                        assert.match(info.checksum, new RegExp(`^[a-f0-9]{${lengths[info.checksum_type]}}$`, 'i'));
                    }
                    entries[i] = { ...pair, status: 'available', discoveryUrl: url, package: { ...pkg, ...info, infoUrl } };
                }
            } catch (e) { entries[i] = { ...pair, status: 'discovery-error', error: e.message }; }
        }
    }));
    const matrix = boundMatrix(entries.filter(e => e.status === 'available'));
    return { schemaVersion: 1, runId, sourceCommit, material, discoveredAt: new Date().toISOString(), platform: manifest.platform, entries, matrix };
}
export async function download(entry, directory, fetcher = fetch) {
    assert.equal(entry.status, 'available');
    const pkg = entry.package;
    const catalogHash = pkg.checksum ? createHash(pkg.checksum_type) : null;
    assert.ok(/^https:\/\//.test(pkg.direct_download_uri));
    const target = safeFile(directory, 'jdk.tar.gz');
    let url = pkg.direct_download_uri, response;
    for (let redirect = 0; redirect <= 5; redirect++) {
        assert.ok(url.startsWith('https://'), 'JDK download redirected away from HTTPS');
        response = await fetcher(url, { signal: AbortSignal.timeout(180000), redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel();
        assert.ok(response.headers.get('location'), 'JDK redirect lacks a destination');
        url = new URL(response.headers.get('location'), url).href;
        if (redirect === 5) throw new Error('Too many JDK download redirects');
    }
    assert.ok(response.ok && response.body, `JDK download failed: HTTP ${response.status}`);
    const hash = createHash('sha256'); let bytes = 0;
    const check = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > 600_000_000) return callback(new Error('JDK download exceeds size limit'));
        hash.update(chunk); catalogHash?.update(chunk); callback(null, chunk);
    }});
    await pipeline(Readable.fromWeb(response.body), check, createWriteStream(target, { flags: 'wx' }));
    const checksum = hash.digest('hex');
    if (catalogHash) assert.equal(catalogHash.digest('hex'), pkg.checksum.toLowerCase(), 'JDK archive checksum mismatch');
    const provenance = { url: pkg.direct_download_uri, finalUrl: url, bytes, archiveSha256: checksum,
        catalogChecksum: pkg.checksum || null, catalogChecksumType: pkg.checksum_type || null,
        verification: pkg.checksum ? 'HTTPS plus catalog checksum' : 'HTTPS; catalog checksum unavailable',
        packageId: pkg.id };
    saveJson(join(directory, 'download.json'), provenance);
    return { target, provenance };
}
export function missingReport(plan, entry, error, status = 'incomplete') {
    return { schemaVersion: 1, id: `${plan.runId}-${entry.key}-${plan.material}`, major: entry.major,
        distribution: entry.distribution, package: entry.package || null, capturedAt: plan.discoveredAt,
        sourceCommit: plan.sourceCommit, material: plan.material, status, error, cases: [] };
}
export function aggregate(plan, directory) {
    const reports = [];
    for (const entry of plan.entries) {
        const path = safeFile(directory, `${entry.key}/report.json`);
        if (!existsSync(path)) saveJson(path, missingReport(plan, entry, entry.error || 'No job artifact (installation failure, timeout or cancellation)',
            entry.status === 'available' ? 'incomplete' : entry.status));
        const report = json(path);
        assert.equal(report.id, `${plan.runId}-${entry.key}-${plan.material}`, 'Artifact belongs to another run');
        assert.equal(report.major, entry.major); assert.equal(report.distribution, entry.distribution);
        assert.equal(report.sourceCommit, plan.sourceCommit, 'Artifact belongs to another source revision');
        reports.push(`${entry.key}/report.json`);
    }
    const unexpected = existsSync(directory) ? readdirSync(directory).filter(name => !name.endsWith('.json') && !plan.entries.some(e => e.key === name)) : [];
    assert.equal(unexpected.length, 0, `Unexpected runtime artifacts: ${unexpected}`);
    const summary = { schemaVersion: 1, runId: plan.runId, sourceCommit: plan.sourceCommit, reports };
    saveJson(join(directory, 'summary.json'), summary); return summary;
}
