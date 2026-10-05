/** Read the existing generated matrix, never maintain a second coverage table. */
export function parseGeneratedCoverage(readme) {
    const section=String(readme).split('<!-- JVM-SAMPLES:START -->')[1]?.split('<!-- JVM-SAMPLES:END -->')[0];
    if(!section) throw new Error('Generated JVM evidence section is missing.');
    const rows=section.split('\n').filter(line=>/^\| \d+ \|/.test(line)).map(line=>line.split('|').slice(1,-1).map(s=>s.trim()));
    const versions = new Set();
    if (!rows.length) throw new Error('Generated JVM evidence rows are missing.');
    return rows.map(([version,tda,tls,tdaDistributions,tlsDistributions])=>{
        if (![version,tda,tls].every(v => /^\d+$/.test(v)) || Number(version) < 7 || versions.has(version)
            || !tdaDistributions || !tlsDistributions) throw new Error('Invalid generated JVM evidence row.');
        versions.add(version);
        return {version:Number(version),tda:Number(tda),tls:Number(tls),tdaDistributions,tlsDistributions};
    });
}
