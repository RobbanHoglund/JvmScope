# Codex test fixtures

`no-findings-java25.txt` is a synthetic HotSpot Java 25 regression fixture: one
snapshot, 20 records with Java states (13 RUNNABLE, 3 WAITING, 4 TIMED_WAITING),
two header-only VM records and no prioritized analyzer findings. The first
thread contains a simulated synchronous HTTP wait; example classes, counters
and identities are constructed test data. It covers the empty-report regression
without committing the user's diagnostic capture.

`multiple-deadlocks.txt` is the existing synthetic multiple-cycle fixture.

`conversation-sv.json` and `conversation-en.json` record two independent model
trials on 2026-10-28, each with a fresh context reading the bundled skill. The
model analyzed `no-findings-java25.txt`, inspected the source, presented an
overview and answered a follow-up asking to show/explain `main`. Each trial
called the packaged stdio MCP server. The fixtures retain the actual AI-written
assessments and final chat answers; private paths and transient report IDs are
not retained.

`conversation.spec.mjs` replays those assessments through fresh real MCP calls
and presents each report in a separate sandboxed iframe/tab. It checks the
visible stack, chat answers, navigation and isolation between older and newer
reports. This is deterministic protocol/browser replay, not a model evaluation
rerun in CI and not the Codex desktop host. New independent model trials remain
necessary when changing the skill or response instructions. The test-only
`agent-session.mjs` and `agent-request.mjs` helpers can record those trials
against the packaged server without changing the installed plugin.
