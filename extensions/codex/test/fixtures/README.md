# Codex test fixtures

`no-findings-java25.txt` is a synthetic HotSpot Java 25 regression fixture: one
snapshot, 20 records with Java states (13 RUNNABLE, 3 WAITING, 4 TIMED_WAITING),
two header-only VM records and no prioritized analyzer findings. The first
thread contains a simulated synchronous HTTP wait; example classes, counters
and identities are constructed test data. It covers the empty-report regression
without committing the user's diagnostic capture.

`multiple-deadlocks.txt` is the existing synthetic multiple-cycle fixture.
