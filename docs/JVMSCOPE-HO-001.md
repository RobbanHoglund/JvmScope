# JVMSCOPE-HO-001 implementation record

Started from main `8c8de3c4cb910a0bffbfedc48d1d7d736f1ed698` on local branch
`codex/incident-findings-knowledge`. No publication, push or repository-policy
changes are part of this task. User diagnostics stay in browser memory.

## Stage 1 — process evidence

LAUNCH-01/02 were already fixed and their negative/positive controls remain.
LAUNCH-03 was confirmed: the classical jcmd PID/date/header triple lost its PID.
The parser now preserves a strictly recognized positive `PID:` line immediately
before a recognized timestamp and HotSpot header, in the corresponding raw
snapshot. An optional collector ISO time is retained too. Arbitrary numbers and
loose numeric preambles do not identify a process. Existing process segmentation
prevents a missing PID bridging conflicting known PIDs. A repeated PID still does
not identify a process globally across hosts, namespaces or restarts; the tool
cannot establish that context from these captures alone.

Verified full Node suite (677 tests), 441 runtime reports/documentation replay,
and real worker browser tests on desktop/laptop. Unit controls cover joined and
separate input, collector time, same/different/missing PID and known–unknown–other
known PID, temporal values, raw boundaries, history/change state and measured
charts. No captures, compatibility reports or persistent diagnostic data changed.

## Stage 2 — blocking progression

The worker reuses the snapshot dependency builder (including class-init and
explicit lock ownership). Incoming paths are traversed with visited sets; the
blocker is excluded from its own dependent count, even in cycles. Ambiguous
owners are separate from definite counts. Prioritization is peak unique observed
dependents, then exact adjacent comparable recurrence; it is not an impact score.
Only endpoint thread series cross snapshots. Lock addresses never do.

Selection lives inside the existing dependency map, reusing its renderer and
thread inspector. It survives snapshot navigation and resets on dataset replace.
Full reachable neighborhoods are shown rather than the manual two-hop focus.
Partial/process-incompatible snapshots cannot prove disappearance or decreases;
counts remain observations/lower bounds. Changed stacks and repeated waits do not
establish progress or continuous blocking. Unresolved owners remain in the full
map and do not become identified-blocker candidates.

Verified 367 TDA unit tests and desktop/laptop worker/UI progression tests:
growing waiters, indirect chains, cycles, ownership changes, per-snapshot raw
references, different PIDs, partial data, ambiguous owners and empty patterns.
No new backend or graph dashboard was introduced.

## Stage 3 — selected findings report

Add one snapshot or the observed snapshots of one selected pattern. Findings are
detached copies, with source/snapshot-local raw references, SHA-256 of input,
analysis/schema version, selection, time labels, recorded table/chart context,
observation, derivation, caveats, next checks and explicitly labelled user notes.
Ranking is explicitly based on the candidate's full history, even for a one-
snapshot report. Search/table filters do not restrict dependency evidence and are
not misrepresented as analysis scope. Dataset replacement leaves saved evidence
unchanged. Nothing is stored across page reloads.

Reuses the existing graph PNG renderer without downloading a separate image;
HTML embeds the captured snapshot's PNG, labelled with its snapshot. Markdown
keeps textual evidence and points to the separate graph export. No full raw
dump is included. Preview, sensitivity warning and explicit review checkbox
precede export. Remove/reorder/notes are local UI operations. All dynamic HTML is
escaped; Markdown metacharacters/HTML are escaped to avoid active markup or
external image links. HTML has restrictive CSP, no scripts or external resources,
and the preview is sandboxed.

Verified 369 TDA unit tests and desktop/laptop browser tests covering capture,
ordering/removal, notes, PNG, dataset replacement, preview, local download and
absence of external requests. Hostile filenames/text/notes and unsafe graphic
URIs are tested. Existing local graph export continues to work.

## Stage 4 — Java Knowledge Base

Eight separate static articles sit below the analyzer links on home. Local search
and version/topic filters, capability tables and an upgrade comparison reuse one
metadata source. Article URLs and reloads work on preview, Java and Pages. The
Java root now opens home instead of redirecting to TLS; analyzer URLs, aliases,
health checks and request rejection contracts remain intact. No database or
analysis API was added. Search text is not sent, persisted or put into URLs.

Sources were checked against OpenJDK JEPs, the JDK 27 file-dump schema and official
JDK APIs/command/migration guides on 2026-10-05. In particular, compact headers
are experimental/off in 24, product/off in 25–26 and default on in 27; monitor
unpinning changes in 24 and older tracePinnedThreads advice is obsolete. G1
string deduplication requires 8u20+, while major-only tables retain that update
qualification. Vendor/collector/architecture restrictions are explicit. This
is a bounded metadata subset, not an exhaustive migration or removed-flag list.

Documented runtime capability, collection evidence and analyzer verification
are separate sections. Coverage counts are imported from the existing generated
README evidence at build time, with links to exact build/VM/provider reports.
Editorial claims are not automatically verified by a capture workflow.
Maintenance instructions are in `JAVA-KNOWLEDGE-BASE.md`.

Verified full Node suite (685 tests), 441 capture reports/documentation replay,
12 Pages browser controls on desktop/laptop (all four stages), 73-file Pages
artifact validation and 1320 real Java HTTP/configuration assertions, including
every new page/resource, gzip, HEAD, ETag and graceful shutdown. Docker is absent
from this machine; a Linux container run is environment-blocked, not passed.

## Separate adversarial/system review

The PID contract was checked at session splitting, identity/counter annotation,
series/history, lock precedence/change summaries, worker transfer and UI charts.
It prevents future conflicting-process correlation; it does not establish a
global PID identity or repair evidence someone previously exported.

The new progression projection was challenged with ambiguous prior owners,
ambiguous identities, duplicate/reversed/missing times, partial gaps and long
chains. Prior ambiguous ownership does not become a definite recurring edge.
Temporal comparisons require ordered source timestamps and exact adjacent
matches; counts within a snapshot remain usable when temporal comparison is
unavailable. A traversal/evidence budget (100000 visits / 25000 retained
relations) contains the additional quadratic reachability work. When exceeded,
the worker returns an explicit unavailable-pattern status, without a misleading
partial ranking; existing snapshot/table analysis remains available. Correlation
lookup maps avoid a second quadratic scan during relation comparisons.

Report evidence now retains source-time/collection qualifiers and graph
presentation context. SVG export dimensions are captured before async rendering,
and Blob URLs are released on failure as well as success. The saved evidence,
selection and hash are copied before awaits; changing a session does not resolve
saved findings against new threads. No automatic repair, storage, anonymization,
telemetry or network analysis was introduced. Missing observation cannot be added
as a one-snapshot finding; the pattern's existing observations can still be chosen.

The full preview browser sweep initially passed 248 cases (8 Pages-only cases
skipped) and exposed two old navigation expectations: they assumed three links
before the knowledge link existed. The assertions were updated to check all four
destinations, including direct article pages; their rerun and final boundary
results are recorded below. This evidence does not constitute blanket GA approval.

The real browser chain test also found an existing worker-transfer failure:
per-thread contention/class-initialization annotations linked back through full
participants, creating deep recursive relationship graphs. Chromium postMessage
could fail with maximum stack depth even when Node cloning passed. Per-thread
annotations now carry shallow source-key/name/state/raw-coordinate participant
references. Snapshot-level chains still point to the actual snapshot threads;
table, graph, smart analysis, classification, raw view and thread-details
consumers were checked. Long monitor and class-init chains now cross the real
worker boundary, retain all 400 threads and show the bounded-projection warning.
Source captures, counters, root relationship evidence and classifications are
not dropped. This corrects future analysis; already exported reports are unchanged.

## Critical reading of the handover

The direction is appropriate, with these necessary scope qualifications:

- A recurring identified blocker is an observational candidate, not a proven
  root cause. Similar stacks or repeated identifiers cannot fill missing process,
  timestamp, ownership or collection evidence. Ambiguous ownership in the previous
  snapshot cannot inflate the count of comparable blocking recurrences.
- Major Java versions do not specify a vendor, update, platform or collection
  format. The generated capture evidence must remain distinct from documented
  runtime capabilities; neither is certification of every Java 7–27 JVM.
- Pattern ranking uses full observed pattern history. A finding can select just
  one snapshot. Table/search/chart presentation filters do not filter dependency
  evidence; the report discloses this rather than suggesting the scopes coincide.
- The first knowledge release is a maintained, source-backed subset, not an
  exhaustive flag/default migration checker. Capturing a new JDK does not verify
  editorial facts automatically. No flags or speed improvements are recommended
  solely from a thread dump.
- Large incident projections need explicit resource limits even though the
  original prompt did not specify them. Exhausting the additional traversal
  budget leaves the ordinary snapshot available and reports pattern analysis as
  unavailable. It must not silently return a complete-looking partial ranking.

## Final verification

- `npm test`: 688 Node tests passed, plus 441 generated capture/report replays.
  After the final recurrence qualification, the 375 TDA unit tests passed again.
- Pages: the full configured suite passed 64 desktop/laptop cases. The final
  ambiguity regression and the progression/budget/report controls passed all
  8 cases against the rebuilt Pages artifact. Article routes, legal files,
  workers and the 73-file static artifact were validated.
- Java: 22 focused desktop/laptop browser cases passed against the new JAR and
  existing linked runtime. After the final change, the same 8 progression,
  ambiguity, budget and report controls passed against the rebuilt JAR.
- `:slim:serverTest :slim:jar`: the final build passed 1320 real HTTP/configuration
  assertions. Dependency installation and frontend build tasks were excluded
  only on this final rebuild: dependencies were already installed, the Node suite
  had passed and Vite's slim build was run immediately beforehand.
- The earlier preview sweep passed 248 cases and skipped 8 Pages-only cases;
  two outdated navigation assertions were fixed and passed on rerun. This is
  recorded separately rather than claiming an unperformed clean full rerun.
- Docker is not installed; Linux container execution remains environment-blocked.
  No Railway deployment, remote workflow or push was attempted. These results
  do not confer blanket GA approval.

The user's running local package was preserved. Tests used isolated ports and a
new JAR with the existing linked runtime. The currently running app therefore
needs a normal rebuild/restart before showing this branch's changes.
