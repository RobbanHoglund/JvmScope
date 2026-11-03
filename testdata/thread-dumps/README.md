# Thread-dump samples

| File | Source and use |
| --- | --- |
| `real-java-all-1-snapshot.txt` | Existing controlled Java scenario capture; inspect one snapshot. |
| `real-java-all-3-snapshots.txt` | Existing controlled scenario sequence; compare counters and reported cycles. |
| `java26-runtime-version.txt` | Real Eclipse Temurin 26.0.2.1+1 sequence with the extra `JDK version:` header. |
| `java27-runtime-version.txt` | Real Amazon Corretto 27+35-FR sequence, including its runtime/vendor text. |

The runtime-version files are byte-for-byte copies of the three-snapshot
`classic-sequence.txt` captures already stored in `testdata/jvm-samples/`.
They are not hand-written or newly captured for this feature. Original capture
directories and SHA-256 checksums are recorded in
`runtime-version-provenance.json`; the source directories retain the original
runtime/capture evidence. No headers, thread names, counters or locks were edited.

Load either file in the web application, VS Code or Codex. Expand **Java runtime**
in a snapshot's report to see the recorded JDK version, full runtime build,
runtime/vendor text and VM version separately. Select another snapshot to check
that the metadata follows it. The raw capture and its physical source lines are
unchanged.

The format follows [JDK-8364106](https://bugs.openjdk.org/browse/JDK-8364106) and
the [integrated OpenJDK change](https://github.com/openjdk/jdk/commit/158e59ab9184127089f9693ce256001f64b5945c).
The extra line is optional for compatibility with older captures and backports.
A VM version such as HotSpot `25.x` is not by itself evidence of Java 25.
