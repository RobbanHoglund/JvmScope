# Knowledge Base review for VS Code 1.0.0

Review date: 2026-10-17. Scope: all eight articles, the index, both practical
guides, the shared feature/version model, search, source links and delivery in
the standalone frontend and VS Code webview.

## Outcome

The reviewed Java claims are supported by the primary sources listed below.
No Java rule or release-transition correction was identified in this review.
Two reproducible webview defects were fixed with browser regressions: section
links could leave the article, and the active search match had insufficient
visual distinction in the light theme. The maintenance guide also contained an
outdated statement denying all query-bearing URLs; it now explains the existing
local URL-fragment behavior consistently.

Version **1.0.0** marks the extension's first stable major release after 0.3.x.
The manifest, lockfile, package filename, workflow artifact paths and current
release documentation agree on that version. The actual VSIX validator rejects
Preview and pre-release metadata. This change does not publish to Marketplace.

## Article review

| Article | Claims and practical guidance checked | Primary evidence |
| --- | --- | --- |
| Collect the right thread dump | Target-side command help and permissions; platform versus virtual-thread coverage; separate snapshots versus an atomic JVM deadlock report; Java 25 lock/time/state evidence, Java 26 park-owner evidence and Java 27 numeric JSON fields; carrier IDs remain JSON-only. | jcmd manual, ThreadMXBean API, JDK 25–27 release notes and tagged ThreadDumper/schema sources. |
| CPU, elapsed and allocation: evidence and limits | Counters versus rates; RUNNABLE does not establish CPU use; missing values remain unknown; management APIs have platform-thread and availability limits; allocation is not retained memory. | Java 25 java.lang.management and com.sun.management ThreadMXBean APIs. |
| Virtual threads, carriers and pinning | Final virtual threads in Java 21; waiting-task scalability rather than automatic CPU acceleration; Java 24 synchronized-block pinning change; remaining native/foreign-call limits; version-specific diagnostic advice. | JEP 444, Java 21/24 virtual-thread guides and JDK 24 release notes. |
| String interning and application caches | intern() returns the canonical reference; callers must use that result; identity and equality are separate; an application cache has its own key, lifetime and eviction policy. | String.intern() and Map API contracts. |
| String Deduplication versus Compact Strings | Backing-storage deduplication does not merge String object identities; G1 deduplication dates from 8u20 and requires configuration; compact strings use Latin-1 or UTF-16 storage, not UTF-8; benefit needs measurement. | JDK 8u20 release notes and the java launcher manual. |
| Compact headers, compressed oops and class pointers | Separate mechanisms and flags; Java 24 experimental/off, 25–26 product/off and 27 default-on compact headers; the separate class-pointer option is absent from checked Java 7 flag definitions, present in Java 8, later deprecated/obsolete; illustrative layout arithmetic includes alignment. | Tagged Java 7u80/8 HotSpot flags, JDK 24–27 release notes and Oracle compressed-reference documentation. |
| GC, heap and process memory before tuning | Heap, native and resident memory are distinct; NMT must be enabled at startup and does not account for every native allocation; G1 default scope changes must be version-qualified; a thread dump alone cannot establish a memory benefit. | NMT and GC tuning guides, java manual and JDK 27 release notes. |
| Upgrade checklist: verify, compare, measure | Comparison uses the same feature states as articles; source and target selections remain independent; reverse comparisons work; actual VM flags, collector, architecture and workload must be checked before attributing a benefit. | Shared-model inspection, the release sources above and existing comparison tests. |

The model distinguishes documented capabilities from observed dump fields and
JvmScope's tested captures. It does not claim that an upstream major version
certifies every vendor, backport, architecture or update. Source dates remain
attached to individual facts; earlier dates were not advanced merely because
the frontend tests passed.

## Defects fixed and regression evidence

### Section navigation inside a VS Code webview

Before the fix, selecting **Inspect** resolved `#check` against the webview's
resource-directory `<base>` and navigated out of the article. The host now
resolves same-document fragments against the logical article URL, scrolls to the
target and moves keyboard focus without replacing the webview. An event already
handled by an analyzer is left to that handler, preserving the deadlock panel's
focus behavior.

The browser regression exercises Mechanism, Version scope, Inspect and Measure,
plus the heading permalink and subsequent Tab navigation. It checks that Java
and format selections, search highlights and the real webview URL survive, and
that no host page-navigation request is emitted. The existing deadlock-cycle
test verifies the shared handler does not steal focus from analyzer shortcuts.

### Active article-search match in host themes

The active match's outline had approximately **1.4:1** contrast against the
surrounding light-theme surface. It now uses the host's active-selection text
and background colors and focus-border color. The browser regression moves to
the next result, checks `aria-current` and verifies at least **4.5:1** text
contrast and **3:1** outline contrast in the four tested host palettes: light,
dark, high-contrast dark and high-contrast light. Arbitrary custom theme palettes
are not individually certified.

## Functional and visual coverage

- Every packaged article opens through its declared route, retains Java-version
  links, and sends its primary-source link through the external-link bridge.
- All nine Knowledge Base pages are checked at 600 px across the four host
  palettes. Representative screenshots were visually inspected for heading
  wrapping, readable controls, tables, surfaces and source navigation.
- Existing narrow-split checks cover all articles at 360/600 px. Standalone
  tests cover desktop/laptop layouts, including narrow responsive behavior.
- Search checks cover AND filtering, JVM flags, escaping, keyboard navigation,
  local fragment restoration/clearing, unchanged example code, bounded results
  and independence from Java/format selections. Search terms are not written to
  HTTP requests or browser storage.
- Existing model tests cover unavailable capabilities, preview/final release
  boundaries, plain versus JSON evidence, unknown runtime/provider states,
  reverse comparisons and source-link validation.

## Local verification results

| Check | Result |
| --- | --- |
| Complete frontend test chain | 801 tests passed; 441 existing runtime reports replayed. |
| Extension unit tests | 24 passed. |
| Production webview browser suite | 40 passed after rebuilding the extension assets, including both new regressions and the existing TDA/TLS checks. |
| Standalone Knowledge Base browser suite | 22 passed against the rebuilt production frontend, across desktop and laptop projects. |
| Whitespace/patch validation | `git diff --check` passed. |

The browser runs used Chromium 153 with the project's Playwright runner. The
webview suite exercises real packaged host modules, resource rewriting and CSP
with a simulated VS Code transport; it is distinct from the workflow's real
extension-host tests. Final archive validation and CI results are recorded on the PR.

## Primary sources consulted

- [jcmd, JDK 27](https://docs.oracle.com/en/java/javase/27/docs/specs/man/jcmd.html)
- [ThreadMXBean, Java 25](https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html)
  and [HotSpot extensions](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.management/com/sun/management/ThreadMXBean.html)
- [String, Java 25](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html)
  and [Map](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html)
- [Virtual threads, Java 21](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html),
  [Java 24 guide](https://docs.oracle.com/en/java/javase/24/core/virtual-threads.html)
  and [JEP 444](https://openjdk.org/jeps/444)
- [JDK 8u20 release notes](https://www.oracle.com/java/technologies/javase/8u20-relnotes.html)
- [JDK 24 release notes](https://www.oracle.com/java/technologies/javase/24-relnote-issues.html),
  [JDK 25](https://www.oracle.com/java/technologies/javase/25-relnote-issues.html),
  [JDK 26](https://www.oracle.com/java/technologies/javase/26-relnote-issues.html)
  and [JDK 27](https://www.oracle.com/java/technologies/javase/27-relnote-issues.html)
- [java launcher, JDK 27](https://docs.oracle.com/en/java/javase/27/docs/specs/man/java.html)
- [Native Memory Tracking](https://docs.oracle.com/en/java/javase/27/vm/native-memory-tracking.html)
  and [GC tuning introduction](https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html)
- [Compressed references](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/performance-enhancements-7.html)
- [Java 7u80 flags](https://github.com/openjdk/jdk7u/blob/jdk7u80-b15/hotspot/src/share/vm/runtime/globals.hpp)
  and [Java 8 flags](https://github.com/openjdk/jdk8u/blob/jdk8-b132/hotspot/src/share/vm/runtime/globals.hpp)
- [ThreadDumper, JDK 24](https://github.com/openjdk/jdk/blob/jdk-24-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java),
  [JDK 25](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java)
  and [JDK 26](https://github.com/openjdk/jdk/blob/jdk-26-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java)
- [Thread-dump JSON schema, JDK 27](https://github.com/openjdk/jdk/blob/jdk-27-ga/src/jdk.management/share/classes/com/sun/management/doc-files/threadDump.html)

## Limits

This review does not constitute new execution of every supported JDK/vendor.
The frontend test chain replays **441 existing runtime reports**; their original
capture provenance remains authoritative. No new heap/JOL measurement, Java
server matrix or independent installed-VS-Code OS matrix was run locally for
this review. The extension workflow supplies the installed-VS-Code checks.

Some direct OpenJDK JEP requests were rejected by the retrieval environment.
Oracle documentation and tagged OpenJDK source were used for the corresponding
facts; that retrieval failure is not evidence that the article links are broken.
The external-link tests verify dispatch through the host, not continuous uptime
of all external sites. Publication is a separate step after merging and checking
the release workflow.
