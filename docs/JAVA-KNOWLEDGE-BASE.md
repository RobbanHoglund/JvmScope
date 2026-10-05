# Java Knowledge Base maintenance

The eight articles and their upstream release transitions live in
`frontend/assets/javautils/knowledge/data.js`. Every article has capability,
scope/version/default, benefit, limitation, configuration-check, measurement
and primary-source sections. The visible verification date is 2026-10-05.
Recheck the linked JEP/JDK/vendor documentation before changing this date or
adding release claims. Unknown vendor ports, backports, collectors and update
levels must not inherit certification from an upstream major version.

`featureState` drives both article capability tables and the upgrade comparison.
There is no independent upgrade matrix. The generated README capture-evidence
section is imported at build time to supply verified case counts; exact build,
VM/provider and format evidence stays in `JVM-SAMPLE-RESULTS.md`. A new capture
workflow result updates that generated material, then a rebuilt site receives
the new counts. It does not automatically verify the editorial release claims.

The pages distinguish documented JVM capabilities, actual fields in a selected
collection format and JvmScope's analyzer verification. Search is local and is
not put in URLs, storage or requests. Static article HTML paths are explicit
Vite entries and Java-server routes; Pages verifies all article asset URLs.
Add/remove an article consistently in those delivery boundaries and rerun unit,
browser, Pages artifact and real Java HTTP tests.

This is a scoped guide, not an exhaustive migration/flag checker. No tuning
recommendation follows solely from a thread dump. GC parsing and TLS
certificate-selection analysis remain future work, with no empty tool links.
