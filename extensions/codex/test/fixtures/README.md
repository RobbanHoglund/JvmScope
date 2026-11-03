# Codex test fixtures

`no-findings-java25.txt` is a synthetic HotSpot Java 25 regression fixture: one
snapshot, 20 records with Java states (13 RUNNABLE, 3 WAITING, 4 TIMED_WAITING),
two header-only VM records and no prioritized analyzer findings. The first
thread contains a simulated synchronous HTTP wait; example classes, counters
and identities are constructed test data. It covers the empty-report regression
without committing the user's diagnostic capture.

`multiple-deadlocks.txt` is the existing synthetic multiple-cycle fixture.

`http-client-selection.txt` is synthetic HotSpot-like Java 25 test data: one
application thread, four HTTP selector threads with identical frames but distinct
lock addresses, and one worker with a different stack. It contains no user capture.
`multi-thread.spec.mjs` drives the packaged MCP server and sandboxed browser host
through overview, main, HTTP selection and text-only collection advice in English
and Swedish. Its assessments are scripted protocol/UI inputs, not fresh model
trials. It checks original source isolation, local selection, panel resizing,
compact/reopen navigation and old report tabs as well as narrow/light layouts.

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

`thread-followup-en.json` and `thread-followup-sv.json` record fresh independent
model conversations on 2026-11-03 using the updated skill for the 0.6.2 candidate.
The trial bundle still carried the 0.6.1 manifest; the fixture records that value
and the exact skill SHA-256. Each run analyzed the public synthetic capture,
verified source and presented a snapshot-wide overview. A separate manual
`inspect_thread_details` call then opened main's source. The user asked what its
HTTP wait establishes without asking to show the stack again; both models
presented a new focused assessment. They also consulted bundled guidance. A final
procedural question about additional evidence produced text only, with no tools.

`thread-followup-flow.spec.mjs` replays those actual AI assessments and replies
through fresh MCP calls and real manual UI navigation. It checks the new focused
report, the untouched earlier source view, natural stack height, text-only advice
and the correct parent assessment after a backend restart. The replay does not
repeat the model's knowledge searches, rerun a model, or operate Codex desktop.
