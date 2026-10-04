# Thread & Lock Dependency Map

This package adds an interactive dependency graph to the JvmScope · Java Thread Dump Analyzer (`jvmscope/tda.html`). The graph is constructed entirely in the browser from the analyzer's parsed snapshot model; it does not require a backend graph database or an external rendering service.

## Density-and-focus revision

The graph now uses stronger progressive disclosure so a large JVM snapshot remains readable instead of opening as a wall of resources.

The default is:

- **View:** Resource map
- **Scope:** Contention overview
- **Density:** Compact
- **Layout:** Dependency flow
- **Labels:** Smart
- **Notifications, virtual-thread mounts, and edge labels:** Off

The Compact profile displays at most the five highest-priority contended resources and at most six waiter observations per displayed resource. The Balanced profile raises those limits to ten resources and twelve waiters per resource. Complete contention removes those projection limits without changing the underlying evidence model.

Compaction is projection-only. The complete snapshot remains available to search, inspect, focus, and reopen in the raw forensic view. The metrics row reports how many waiter observations were compacted.

## Resource filters

The new resource filter bar independently controls:

- **Monitors / synchronized**
- **Synchronizers / Lock-AQS** such as ownable synchronizers and `ReentrantLock` evidence
- **Owner not observed** waits

This makes it possible to hide synchronizers completely, inspect only `synchronized` monitor contention, inspect only Lock/AQS contention, or suppress unresolved waits that cannot be connected to an observed owner.

The existing relationship filters remain independent:

- waits;
- holds;
- notification waits;
- virtual-thread mounts;
- edge labels.

Selecting a hidden lock from search or the hotspot cockpit automatically re-enables the required resource family and opens a bounded neighborhood instead of expanding the entire raw graph.

## Thread-role highlighting

The **Highlight threads** control can emphasize:

- waiting to enter `synchronized`;
- holding `synchronized`;
- both holding and waiting for `synchronized`;
- waiting for a synchronizer;
- holding a synchronizer;
- both holding and waiting for a synchronizer;
- any lock waiter, holder, or dual-role thread;
- JVM-confirmed deadlock participants.

Matching thread nodes receive a strong role highlight. Their relevant locks, owners, and waiters remain visible as context, while unrelated branches fade. The counter beside the control distinguishes matches visible in the current compact projection from matches in the full snapshot.

`Object.wait()` / monitor-notification evidence is deliberately excluded from **waiting to enter synchronized**. It is still available through the separate Notifications relation filter, but is not misrepresented as monitor-entry contention.

The thread inspector also shows exact synchronized and synchronizer roles and provides quick highlight actions for the selected thread's roles.

## Focused investigation

The **Focus** action shows the selected node and up to two relationship hops. Focus temporarily bypasses the normal scope and density limits but remains bounded to the selected neighborhood.

Focus is available from:

- the toolbar;
- the selected-node inspector;
- full-snapshot search results;
- contention-hotspot rows, including resources hidden by compaction.

The focus bar clearly states when the normal scope is bypassed and provides a one-click return to the selected scope.

## Improved contention cockpit

Before a node is selected, the inspector acts as a contention cockpit rather than an empty panel. It includes:

- current monitor, synchronizer, unresolved-wait, and deadlock counts;
- Compact, Balanced, and Complete density presets;
- All resources, synchronized only, and synchronizers only presets;
- role-highlight presets;
- top matching contended resources, including visible/hidden state and waiter counts;
- top observed blocking threads;
- threads that are both holding and waiting.

A hotspot row can reveal a resource that the current density profile filtered out without switching to the full raw map.

## Layout and label changes

The dependency-flow layout now places:

- waiting/dependent threads on the left;
- monitor or synchronizer resources in a ranked center lane;
- observed owners/blockers on the right.

Waiters are distributed across bounded columns and rows around their primary hotspot. Link distances are longer and force strengths are lower, which reduces overlap. Smart labels use a stricter budget and always preserve selected, searched, deadlocked, and role-highlighted evidence.

The lock symbols are now explicit:

- `M` — monitor / synchronized;
- `S` — synchronizer / Lock-AQS;
- `X` — mixed evidence.

A compacted lock label can show both visible and total waiter counts.

## Graph projections

### Resource map

- Thread → monitor/synchronizer for parsed waits.
- Monitor/synchronizer → owning thread for observed ownership.
- Notification waits remain visually distinct and do not create false blocker dependencies.
- Mounted virtual thread → carrier relationships remain available as a separate edge type.

### Thread dependencies

- Aggregated waiter → observed-owner relationships.
- Multiple lock reasons can be represented on one dependency edge.
- Opposite-direction dependencies are curved and labelled independently.
- A wait with no observed owner remains in Resource map and cannot honestly become a thread-to-thread dependency.

## Evidence boundaries

The graph distinguishes:

- **Observed wait-for dependency:** a wait and an owner matched by lock identity in the same snapshot.
- **Observed dependency cycle:** a strongly connected component in the derived wait-for graph. This is a diagnostic signal, not automatically a JVM-confirmed deadlock.
- **Confirmed deadlock:** authoritative evidence from the JVM Java-level deadlock section. Only this category receives confirmed-deadlock treatment.

The graph can reconstruct an explicit thread → lock → owner cycle from authoritative deadlock metadata when the regular stack section omits one of the lock lines.

## Main files

- `assets/javautils/tda/dependency-graph.js` — pure graph and evidence model.
- `assets/javautils/tda/dependency-graph-view.js` — D3 renderer, projections, layout, search, focus, inspector, and interactions.
- `assets/javautils/tda/dependency-graph-density.js` — defaults, raw-map density classification, and smart-label prioritization.
- `assets/javautils/tda/dependency-graph-visibility.js` — DOM-free contention compaction, resource visibility, and exact thread-role classification.
- `assets/javautils/tda.js` — integration with the selected snapshot and existing thread-details modal.
- `jvmscope/tda.html` — graph controls, resource/relation filters, density guard, metrics, inspector, and legend.
- `assets/javautils/styles.css` — graph visual system, role highlighting, filters, presets, responsive behavior, and fullscreen mode.
- `test/tda/dependency-graph.test.js` — graph-model regression tests.
- `test/tda/dependency-graph-density.test.js` — default, density, and smart-label tests.
- `test/tda/dependency-graph-visibility.test.js` — compaction, filtering, waiter prioritization, and role-classification tests.

## Keyboard controls

With the graph workspace focused:

- `/` or `S`: focus search.
- `+` / `-`: zoom.
- `F`: fit graph.
- `Esc`: clear neighborhood focus, otherwise clear node selection.
- On a focused node: `Enter`/Space selects, `D` opens full thread details, and `P` toggles pinning.

## Validation performed

- `npm test`: **146 tests passed, 0 failed**.
- Modified JavaScript modules passed `node --check`.
- A headless Chromium harness exercised the actual D3 view with 158 synthetic threads and 12 lock resources:
  - Compact opened with 5 resources and 40 total nodes rather than the complete graph.
  - 39 waiter observations were compacted.
  - Hiding synchronizers left only monitor resources.
  - synchronized-waiter highlighting produced matching and muted node classes with a visible/full count.
  - two-hop focus reduced the projection from 40 to 13 nodes.
  - no browser console errors or page errors were observed.

The browser validation screenshot is distributed separately from the source package because it is test evidence, not an application runtime asset.

A production Vite build could not be executed in the Linux packaging environment because the latest supplied archive contains Windows-native Rolldown and Lightning CSS binaries. The full Windows package preserves those dependencies. The clean source package excludes `node_modules`; run `npm install` on the target platform before building.

## Local development

```bash
npm install
npm run dev
```

Tests:

```bash
npm test
```

Production build:

```bash
npm run build
```
