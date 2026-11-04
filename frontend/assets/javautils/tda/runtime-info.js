import { escapeHtml } from './ui-safety.js';

// JDK-8364106 adds a second, indented line to classic HotSpot dumps. VM
// versions and Java/runtime versions are distinct (notably HotSpot 25 on Java 8).
export function classicRuntimeInfo(lines, headerIndex) {
    const header = String(lines[headerIndex] || '').trim();
    if (!header.startsWith('Full thread dump ')) return null;
    const vm = header.slice('Full thread dump '.length).replace(/:$/, '');
    const opening = vm.lastIndexOf(' (');
    const version = opening >= 0 && vm.endsWith(')') ? vm.slice(opening + 2, -1).match(/^(\S+)(?:\s+(.*))?$/) : null;
    const info = { sourceFormat: 'hotspot-classic', vmName: version ? vm.slice(0, opening) : vm,
        vmVersion: version?.[1] || null, vmInfo: version?.[2] || null, vmHeaderLine: headerIndex + 1,
        javaVersion: null, runtimeVersion: null, runtimeDescription: null, debugLevel: null,
        jdkHeaderLine: null, jdkHeader: null };
    const line = String(lines[headerIndex + 1] || '');
    if (!/^\s*JDK version:/.test(line)) return info;
    info.jdkHeaderLine = headerIndex + 2; info.jdkHeader = line.trim();
    const body = info.jdkHeader.slice('JDK version:'.length).trim();
    const buildStart = body.lastIndexOf('(');
    if (buildStart < 0 || !body.endsWith(')')) return info;
    const build = body.slice(buildStart + 1, -1).match(/^(?:(\S+)\s+)?build(?:\s+(.*))?$/);
    const prefix = body.slice(0, buildStart).trimEnd(), javaStart = prefix.lastIndexOf('(');
    if (!build || javaStart < 0 || !prefix.endsWith(')')) return info;
    info.runtimeDescription = prefix.slice(0, javaStart).trim() || null;
    info.javaVersion = prefix.slice(javaStart + 1, -1).trim() || null;
    info.debugLevel = build[1] || null;
    info.runtimeVersion = build[2]?.trim() || null;
    return info;
}

export function fileRuntimeInfo(value, sourceFormat) {
    return typeof value === 'string' && value.trim() ? { sourceFormat, runtimeVersion: value.trim() } : null;
}

const labels = {
    en: { runtime: 'Java runtime', vm: 'JVM', description: 'Runtime / vendor text', javaVersion: 'JDK version',
        build: 'Runtime build', debug: 'Debug level', vmName: 'VM name', vmVersion: 'VM version', vmInfo: 'VM mode', raw: 'Recorded JDK header',
        note: 'Recorded metadata for this snapshot. A VM version is not necessarily the Java version; matching versions do not establish process identity.' },
    sv: { runtime: 'Java-runtime', vm: 'JVM', description: 'Runtime / leverantörstext', javaVersion: 'JDK-version',
        build: 'Runtime-build', debug: 'Debugnivå', vmName: 'VM-namn', vmVersion: 'VM-version', vmInfo: 'VM-läge', raw: 'Registrerad JDK-rad',
        note: 'Registrerade uppgifter för denna snapshot. VM-versionen är inte alltid Java-versionen; lika versioner bevisar inte samma process.' },
};
export function runtimeInfoMarkup(info, locale = 'en') {
    if (!info) return '';
    const t = labels[locale] || labels.en;
    const rows = [['javaVersion', 'javaVersion'], ['runtimeVersion', 'build'], ['runtimeDescription', 'description'],
        ['debugLevel', 'debug'], ['vmName', 'vmName'], ['vmVersion', 'vmVersion'], ['vmInfo', 'vmInfo']]
        .filter(([key]) => info[key]).map(([key, label]) => [t[label], info[key]]);
    if (info.jdkHeader && !info.javaVersion && !info.runtimeVersion) rows.push([t.raw, info.jdkHeader]);
    if (!rows.length) return '';
    const runtime = info.runtimeVersion || info.javaVersion;
    return `<details class="runtime-info"><summary>${escapeHtml(runtime ? t.runtime : t.vm)}${runtime || info.vmVersion ? ` · ${escapeHtml(runtime || info.vmVersion)}` : ''}</summary>
        <dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
        <p class="runtime-note">${escapeHtml(t.note)}</p></details>`;
}
