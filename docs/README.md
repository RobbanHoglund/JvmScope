# JvmScope documentation

Start with the [project README](../README.md) for features, Java input matrix,
privacy, local startup and deployment. The application's searchable Help covers
collection commands and interpretation while using each analyzer.

## Current guides

- [Examples](EXAMPLES.md): named scenarios, controlled-capture provenance and regeneration.
- [Development](DEVELOPMENT.md): layout, application/preview builds, ports and tests.
- [JVM sample workflow](JVM-SAMPLES.md): manual collection, validation, import and README generation.
- [JVM sample results](JVM-SAMPLE-RESULTS.md): generated evidence by exact build, provider and scenario.
- [Slim deployment](../slim/README.md): portable runtime, container and Railway setup.
- [GitHub Pages](GITHUB-PAGES.md): static publication alongside Railway, testing and comparison.
- [Scripts](../scripts/README.md): launch, capture and verification command reference.
- [Sample provenance](../testdata/README.md): safe fixtures and private-data boundaries.
- [TDA tests](../frontend/test/tda/README.md): formats, runtime builds and session contracts.
- [TLS tests](../frontend/test/tls/README.md): runtime builds, diagnostic and UI contracts.
- [Publication review](PUBLICATION-REVIEW.md): evidence, blockers and release limits.
- [Issue reporting policy](../CONTRIBUTING.md) and [security policy](../SECURITY.md): issue reports, sole-maintainer development and private reporting.
- [Spring removal](SPRING-REMOVAL.md): single-server contract, migration and verification.

## Future work

[Roadmap](TODO.md) records desired Java 7–27 coverage and possible future JVM
analyzers. It describes goals, not shipped or verified functionality.

## Historical records

These are dated records, not the current support matrix or release verdict:

- [Initial public-release review](PUBLICATION-REVIEW-2026-10-03.md): former Spring baseline and historical test gaps.
- [Initial migration](INITIAL-MIGRATION.md): clean snapshot and package migration.
- [Pages feasibility study](GITHUB-PAGES-FEASIBILITY.md): isolated prototype before implementation.
- [Java 25–27 review](../frontend/test/JAVA25-27-REVIEW.md): earlier controlled captures and source comparisons.
- [JDK 26/27 format review](../frontend/test/tda/JDK26-27-REVIEW.md).
- [TLS GA review](../frontend/test/tls/GA-REVIEW.md) and [earlier TLS review](../frontend/test/tls/TLS-REVIEW.md).
- [Container measurements](../slim/VERIFICATION.md).
- [Thread dependency graph implementation notes](../frontend/IMPLEMENTATION_NOTES_THREAD_DEPENDENCY_GRAPH.md).

Older counts, predecessor product names, deployment addresses and command paths
describe their original build. Use current scripts and CI for JvmScope.
Historical evidence is retained for traceability rather than deleted.
