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
