# Java Knowledge Base maintenance

## Content search

The existing local article filter searches editorial text, practical blocks and
release metadata. Result cards add escaped, highlighted text excerpts and link
to the corresponding article section. `knowledge/search.js` shares literal word
matching with article finding, handles JVM-option punctuation and the VT alias,
and bounds queries at 512 characters. Article finding highlights individual word
matches, has next/previous controls and Enter/Shift+Enter navigation, and refreshes
after version/format changes. Ctrl+F focuses the field; Esc or Clear removes its
highlights without changing the article text or code. Highlighting is capped at
500 marks, with the complete match count still reported.

Following a result puts the search terms and section in the URL fragment, which
is not sent in HTTP requests. This allows direct navigation and reload with
highlighting. The fragment is visible in the address and browser history: review
the URL before sharing it. Queries are not written to localStorage/sessionStorage,
sent to a service or included in a new search index/database. Both Java and Pages
deliver the same frontend implementation. Native section anchors still work.
Editing or clearing an imported search removes its old find fragment, so reload
does not silently restore stale terms. The return link retains the original
result query. Search is literal and case-insensitive, not fuzzy or semantic;
multiword result filtering requires every term, while excerpts and article marks
show individual word matches. Version/topic filters remain independent.

Local verification, 2026-10-07: 699 Node tests, 102 strict Pages browser cases,
20 Knowledge Base cases against the rebuilt Java JAR, and 1,320 real Java
server/configuration assertions passed. Browser cases cover desktop/laptop,
fragment navigation and clearing, Java/format updates, hostile search strings,
unchanged code text and absence of search data in HTTP or browser storage.
This change only affects knowledge search/rendering and shared frontend delivery;
TDA/TLS engines, workers and diagnostic handling are unchanged. No new JVM
captures or Linux/container run were performed. Published sites are unchanged
until a separate release of these local edits.

The eight articles and their upstream release transitions live in
`frontend/assets/javautils/knowledge/data.js`. The two practical guides use text
blocks in `knowledge/guides.js` and the escaped renderer in `knowledge/view.js`.
Every article has capability, scope/version/default, benefit, limitation,
configuration-check, measurement and primary-source sections. Existing editorial
records retain their 2026-10-05 verification date; the revised thread-dump and
object-header guides and new release facts were checked on 2026-10-06; the
carrier/format distinction and Java 7/8 class-pointer option were corrected
against tagged upstream sources on 2026-10-07. Release
states carry their own primary-source links and check date, with the older date
as an explicit fallback. Recheck JEP/JDK/vendor documentation before changing a
date or adding release claims. Unknown vendor ports, backports, collectors and
updates must not inherit certification from an upstream major version.

`featureState` drives both article capability tables and upgrade comparisons.
`collectionEvidence` also uses these states for selected Java and plain/JSON
formats. Command availability (19+), per-thread and lock evidence (25), park-blocker
owners for AbstractOwnableSynchronizer waits (26), and numeric JSON identifiers
and formatVersion 2 (27) are separate transitions. Plain text does not inherit
JSON schema claims. Mounted virtual-thread carrier identifiers have their own
JSON-only capability (25+), shared by the articles, support and comparison views;
plain text never inherits it. Unknown VM/version combinations remain unverified.

The separate UseCompressedClassPointers option is unavailable in the checked
OpenJDK 7u80 flag definitions and present in the tagged Java 8 definitions. These
are sources for the named option, not claims about whether class-pointer
compression exists as a mechanism. Later deprecated/obsolete states remain
separate. Links permit only the explicit upstream jdk/jdk7u/jdk8u repositories.

There is no independent upgrade matrix. The generated README capture-evidence
section is imported at build time for case counts; exact build, VM/provider and
format evidence stays in `JVM-SAMPLE-RESULTS.md`. Capture workflow results update
that generated material, and a rebuilt site receives the new counts. The detailed
evidence link is pinned to the build revision, using the same GITHUB_SHA/git HEAD
selection as Pages metadata. Builds without a valid revision do not substitute a
moving main link. Captures do not automatically verify editorial release claims.

The pages distinguish documented JVM capabilities, actual collection fields and
JvmScope analyzer verification. Memory/tuning articles describe the measurements
needed and link to the diagnostic support section; they do not repeat TDA/TLS
case counts as evidence for an optimization.

Search uses AND tokens from visible article/guide text, applicable Java-version
labels, scoped feature text and a small terminology list. Title/flag/term matches
rank above incidental body text. Source URLs, object keys and verification dates
are not searched. JVM -XX flag prefixes are normalized without equating compact
headers and compressed references. Quoted/parenthesized JVM flags use the same
prefix normalization, preserving the actual flag name and AND filtering.
Search is local and is not put in URLs,
storage or requests. An explicit page Java version initializes the comparison
source and support inspection; later article-filter changes preserve the chosen
upgrade pair. Section navigation precedes the capability table; anchors preserve
the Java query on direct links/reload.

The renderer accepts only paragraph/list/table/code/callout blocks, escapes text,
and restricts source links to primary-source hosts. Illustrative output and
layout arithmetic are labeled separately from measured fixtures. Static article
HTML paths are explicit Vite entries and Java-server routes; Pages verifies all
article asset URLs. Add/remove an article consistently in those delivery
boundaries and rerun unit, browser, Pages artifact and real Java HTTP tests.

This is a scoped guide, not an exhaustive migration/flag checker. No tuning
recommendation follows solely from a thread dump. GC parsing and TLS
certificate-selection analysis remain future work, with no empty tool links.

## Practical-example verification, 2026-10-06

A temporary, stdin-controlled Java program was compiled and run with Amazon
Corretto HotSpot 25.0.3+9-LTS on Windows x64. Targeted jcmd calls successfully
checked VM.version, VM.command_line, VM.flags -all, help Thread.print,
Thread.print -l -e, help Thread.dump_to_file and a JSON file dump. The JSON main
thread contained tid/time/name/state/stack/monitorsOwned, used a string tid and
had no top-level formatVersion member. Classical output supplied state and CPU.
The inspected target reported 8-byte alignment, compact headers off, compressed
oops on and compressed class pointers on. These are observations from that
controlled target, not universal defaults or a heap-benefit measurement.

Upstream tagged ThreadDumper sources at jdk-24-ga/25-ga/26-ga/27-ga were checked
against release notes for state/time/lock, park-owner and JSON-type transitions.
This was not a fresh execution of every JDK/vendor. Existing generated capture
verification remains the authority for tested runtimes.

The arithmetic layout table explicitly assumes conventional 12-byte versus
compact 8-byte headers and 8-byte alignment; it demonstrates why padding can
eliminate a nominal header saving. No JOL/heap-size measurement is claimed.

Regression checks cover unavailable Java 7/17 file-dump combinations, 19/20
preview context, 21/25/26/27 evidence and schema changes, reverse comparisons,
unknown runtime/provider, title/flag/multiword search, hostile text/source URLs,
evidence permalinks, direct anchors, filter independence and local-only behavior.
The article-entry documents remain JavaScript-rendered shells. Build-time
prerendering is a separate delivery improvement, not included in this change.

## KB019 follow-up verification, 2026-10-07

KB019-01/02/03 are covered by negative and positive tests: plain versus JSON
carrier evidence, Java 7/8 class-pointer flag availability and sources, later
flag lifecycle, and quoted/parenthesized plus/minus JVM prefixes. Browser tests
exercise the shared article/support/comparison projections and confirm section
navigation is visible before the capability table on desktop and laptop.

The complete npm test chain passed (696 Node tests), including replay of 441
existing runtime reports. Pages build/payload checks passed, as did 24 Pages
browser cases and 16 Knowledge Base cases against the rebuilt Java JAR.
The actual Java HTTP server passed 1,320 configuration/server assertions.
The follow-up did not recapture every JVM/vendor or execute a new Linux/container
run. Tagged upstream sources substantiate these metadata corrections; successful
tests do not certify every provider/update or establish a general GA approval.

The change affects knowledge metadata/search/rendering and frontend delivery.
Analyzer engines, workers and user-data handling are unchanged; diagnostic data
and search stay local. Existing published content is only corrected after a
separate publication of the new revision. No stored user diagnostics need repair.
