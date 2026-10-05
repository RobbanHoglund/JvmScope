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
