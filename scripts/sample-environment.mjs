// Javacores can include the process environment. Controlled sample JVMs must
// not inherit CI credentials, private proxy credentials or injected JVM options.
export function sampleEnvironment(environment = process.env) {
    const permitted = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']);
    return Object.fromEntries(Object.entries(environment).filter(([key]) => permitted.has(key.toUpperCase())));
}
