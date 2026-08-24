# Changelog

## 2.17.0

### Added

- **Durable completion records**: Terminal bundled, remote, milestone, and journey completions are persisted as `CompletionRecord`s in the stack's Grafana App Platform store. Writes pass through the plugin backend so user attribution and stack scope are stamped server-side from the request context; whether a role may write is decided by upstream App Platform RBAC on the caller's own forwarded identity. The durable key `(guideSource, guideId)` uses the explicit/resolved repository (which wins over the manifest's own value, since the manifest schema defaults an absent repository) so real V1 and `online-cdn` guides persist under their true source. The subscriber is armed once from the universal plugin bootstrap, and fact emission is surface-neutral — completing a guide in the sidebar, floating panel, full-screen, or guide reader records the same fact. A whole-journey record requires every currently-expected milestone to be complete (not a bare count), so a revised journey cannot record from stale milestone progress. Completion UI remains synchronous: each fact is normalized and persisted to a bounded, user/org-scoped localStorage queue off the completion-emission path (no synchronous storage scan), then drained in the background. Concurrent tabs coordinate drains with a lease (capped items per pass, released between passes), the request is bounded below the lease TTL, and each POST carries the event's stable id as a required idempotency key so a retried or cross-tab send cannot mint a duplicate durable record. Retry backoff is clamped after jitter to a true maximum; 401/408/429/5xx retry while other 4xx drop. A 403 is never dropped: an absent grant is a condition of the stack, not a defect in the record, so it joins the same disarm-and-keep path a structural 404 takes — the completion is retained and drains once the grant lands — and reports its own telemetry reason so a grant that never arrives is discoverable instead of accumulating silently. Queued facts older than the backend's 30-day acceptance horizon are dropped locally rather than replayed, and degradation (missing route, dropped/evicted/expired records, persistence/drain failures) surfaces as a warn-level log plus one typed low-cardinality telemetry event. A record is durable only after the POST succeeds; clearing browser storage or evicting the bounded queue can still lose pending events. "Reset all learning progress" discards queued-but-unsent writes as well as local progress, so a reset cannot be followed by durable records appearing for the guides it just cleared. (Epic #1411, backend #1433, frontend #1434)
- **Standalone private guides record completions**: A stack's own App Platform guides opened outside a package — orphan and flat-list entries, `?doc=api:<id>` share links, and auto-dock tab restore — carried no `packageInfo`, so the content producer emitted a title and nothing else and the durable write failed closed on the missing manifest id. Those launches now carry the guide's own stable identity, so completing a private guide records like any other. (#1664)
- **Callout block**: A generic block for setting content apart — an author-written label plus a markdown body — for objectives, summaries, or a call to action. Wired through the schema, parser, renderer, the block editor (including inside `collapsible` and `conditional` branches), and the CLI's authoring registry. Deliberately has no type enum, so there is no per-value table that can drift between the renderer and the editor. (#1684)
- **Manifests carry a canonical block count**: `pathfinder-cli build-stats` stamps each package's `manifest.json` with the completion denominator at build time, computed by one schema-driven module at tier 1 that the CLI, the upload script, the frontend, and a future Go port all share. The denominator is a guide's total block count excluding containers; `multistep`, `guided`, `conditional`, and `snippet-ref` each count as exactly one and are never traversed into. Computing at build time means no author asserts these numbers, so they cannot be wrong. (#1661)
- **Unknown manifest keys reach `repository.json`**: The packaging CLI forwards any unrecognized top-level key from a package's `manifest.json` into that package's `repository.json` entry, instead of two independent layers silently dropping it. Adding package metadata is now a content-repo change rather than a CLI change plus a release. (#1662)
- **Interactive-learning banner experiment**: `pathfinder.interactive-learning-banner-experiment` tests whether explaining interactive learning up front increases engagement. The treatment arm shows a dismissible explanatory banner above the context page's profile bar and above opened guide content on every surface; control renders nothing and is byte-identical to today. Enrollment emits one exposure the first time a Pathfinder panel opens. The banner has no call to action — this is the flag, the enrollment seams, and the surfaces only. (#1628)

### Changed

- **Grafana 13.2.0 and React 19**: `react` and `react-dom` move to 19.2.8, matching what Grafana core 13.2 builds against, alongside `@grafana/{data,e2e-selectors,i18n,runtime,schema,ui}` 13.2.0 and `@grafana/faro-instrumentation-replay` 2.10. The two had to land together: the 13.2.0 packages declare a hard `react@">=19"` peer, so the version bump alone could not install. `@grafana/scenes`' stale `react@^18` peer cap is overridden at install time only — `react` is a webpack external, so the override cannot change what scenes resolves at runtime. The declared `grafanaDependency` is unchanged at `>=12.3.0-0`. (#1674)

### Security

- **Inbound Grafana ID tokens are cryptographically verified**: The App Platform proxies checked the caller's `X-Grafana-Id` token structurally rather than verifying it. A new verifier fetches the stack's JWKS from `{appURL}/api/signing-keys/keys` and checks the signature, `typ`, and `exp`, rejecting tokens that carry no `exp`. Each verifier is cached per app URL for at most five minutes, so a key removed from the live JWKS cannot stay trusted indefinitely, while the key cache's immediate re-fetch on an unknown `kid` still applies inside that window. The identity gate's boolean became a four-state status shared by all three routes — verified, rejected, unverifiable, and signing-keys-down — so a stack whose signing keys are temporarily down gets a retryable 503 with `Retry-After` rather than a soft-200 envelope. (#1604)
- **`react-router-dom` 6.30.5**: Picks up the fix for CVE-2026-53668 / GHSA-jjmj-jmhj-qwj2, an open redirect that could lead to XSS in applications carrying open redirects (CVSS 6.9, medium). (#1680)

### Fixed

- **Discover more launches resolve their course context**: A path launched from My Learning before any docs-panel, sidebar, or full-screen instance had mounted rendered as a bare standalone document — no milestone toolbar, no progress chrome, no next/previous navigation. The package resolver was only ever registered from a panel constructor, so the launch raced ahead of it existing. It is now wired at plugin load. Discover more also carries the manifest it already fetched into the launch, saving a redundant sibling-manifest round trip. (#1638)
- **Editor saves no longer destroy `spec.manifest` and provenance**: An App Platform PUT replaces the whole object, but the editor rebuilt `spec` and `metadata` from literals on every write. Saving a learning-path cover page deleted `spec.manifest`, silently collapsing the path into a flat guide whose milestones stopped rendering; every write erased `metadata.annotations`, including the provenance marks `scripts/upsert-learning-path.sh` stamps, so a later run of that script refused the package without `--overwrite`. Editor-owned spec fields now layer over the spec last read, and `resourceVersion`, `annotations`, and `labels` carry through all three writes. Both come from the same snapshot, so the 409 keeps guarding exactly the object whose unowned fields are being replayed. (#1663)
- **Unverifiable write identity is a standing condition, not a transient one**: The completion-records write gate answered 401 for a stack with no resolvable app URL — and therefore no resolvable signing-keys URL. The write contract defines 401 as transient, so the client retried every queued write until the 30-day retention horizon and never disarmed. It now returns a structural 404 carrying its own reason string: the session disarms while retaining the queued records, and re-arms on a later app load. (#1660)
- **Challenge can no longer create empty markdown inside a branch**: The inline branch block picker offered block types the inline form cannot construct, so selecting Challenge produced an empty markdown block. The picker is restricted to constructible types, and a defensive default covers a missing switch arm. (#1642)
- **E2E runner bounds stuck steps and browser deaths**: A browser OOM roughly 135 seconds into a task left the runner waiting about 920 seconds before returning, and a deterministic guide error ran for about 24 minutes because the outer guide timeout did not bound a stuck operation inside a single step. A wall-clock backstop and browser-termination monitoring now close the page and write an `infrastructure_error` result. Normal skippable and mandatory failure behaviour is unchanged. (#1624)
- **E2E chains start where the previous guide finished**: Learning-path milestones often depend on resources an earlier milestone created at a dynamic route that no manifest can declare. A guide's final successful same-origin location now carries to the next guide in its dependency chain, so a URL milestone starts on the page it needs instead of restarting at `/`. Explicit authored locations still win. (#1651)
- **E2E lease acquisition survives the dev environment's rate limit**: The pool manager paces lifecycle requests to stay within the dev API limit, but the runner aborted every request after 15 seconds — abandoning 15 lease requests that the pool manager later completed in 15 to 53 seconds, each consuming a stack whose one-time runner token the client could not replay. Acquisition now permits 90 seconds; retirement keeps its own 15-second deadline, and acquisition timeouts stay non-retryable. (#1672)
- **E2E bootstrap retry budget covers a slow first paint**: Roughly 15 chains per run of 161 stopped waiting for `window.__pathfinderPluginConfig` at just under 10 seconds, on stacks that had been healthy for 26 to 58 minutes — a per-page initialization race rather than stack maturity. Each panel-open attempt now gets 20 seconds, with the existing single reload retry preserved, and the outer guide setup deadline rises from 120 to 140 seconds so the second attempt is not truncated. (#1688)

### Chore

- **`create-experiment` skill**: The end-to-end recipe for setting up an A/B experiment — flag shape, variant validation, enrollment seam, exposure and behaviour analytics, QA overrides, tests, docs, and a teardown list. It exists because four of the platform's constraints are silent when violated: a boolean flag emits no exposure event and yields no readout, MTFF allocates per stack rather than per user, the registry's `values` array validates nothing at runtime, and a flag's first read is what defines enrollment. (#1629)
- **Release workflow pinned to Node 24**: `grafana/plugin-actions/build-plugin` defaults its `node-version` to 20, which this repo has required Node 24 to build since well before the React 19 migration. Every tag-triggered release run had failed since December 2025, dying while loading `webpack.config.ts` because `undici` calls a Node 22+ API that Node 20 does not provide. (#1694)
- **Resolver and learning-path docs refreshed**: A documentation maintenance pass corrected the package resolver chain, documented the lazy resolver registry and published-only App Platform bare-id resolution, and updated the learning-path reference for private-path routing and launch-context propagation. (#1659)

## 2.16.0

### Added

- **Custom guide packages — a private catalogue on the Grafana App Platform**: A stack's own guide packages and journeys now appear as a Custom Guides section in the context panel and feed into My Learning, with milestone resolution and `backend-guide:` launch. The plugin's App Platform reads and writes target `pathfinderbackend.ext.grafana.app/v1alpha1`, gated on the `aggregation.pathfinderbackend-ext-grafana-app.enabled` toggle, and a new on-behalf-of token exchanger lets the plugin backend call its stack's aggregated API as the calling user — which unblocks every App Platform proxy route, not just the catalogue. (#1408)
- **Guides choose their own launch surface**: Content-only guides — prose, images, video — open full screen where they can use the whole viewport, while interactive guides open in the sidebar so their "show me" and "do it" steps can drive Grafana beside them. The decision is made per guide at launch and does not override a surface the user set themselves. (#1446)
- **My Learning rebuilt as a two-column layout**: My Courses holds paths in progress, Completed holds finished ones, and untouched paths stay eligible for Discover more, which is now restricted to paths. The follow-up pass split the columns 7:5, put badges in a fixed grid behind a bottom fade instead of a "view all" toggle that dragged the sibling column down, gave Discover more a description and disclosure chevron, showed a disabled state on launch buttons during the multi-second prepare step, and made the path cards keyboard-operable. (#1464, #1581)
- **Cloud learning paths land on a cover page with a table of contents**: Launching a not-started URL-based path from My Learning now opens milestone 0 with an "in this path" table of contents showing per-milestone completion, instead of jumping straight to module 1. Milestone-completion storage keys were aligned in the same change so those checkmarks are accurate. (#1473)
- **Private paths get their own section in My Learning**: A stack's own App Platform paths were merged into the same flat list as the curated bundled and CDN ones, so an org's private path was indistinguishable from a Grafana-authored one. They now sit in a dedicated Private paths section above the My paths and Badges row, shown only when the namespace actually has one, and provenance is carried on the path type instead of inferred from the presence of a manifest. (#1593)
- **Masked Faro session replay**: A guide that goes wrong can now be watched back rather than reconstructed from events. Recording masks every text node and input type, with canvas, fonts, inline images, inline stylesheets, and cross-origin iframes all off, and a dedicated scrubber strips the content rrweb leaves exposed in attributes and URLs — panel titles in `data-testid`, `aria-label`, `title`, `alt`, `placeholder`, and `var-*` template variables. (#1482)
- **`targetState` for interactive steps that toggle**: Steps used to click unconditionally, so any target with toggle semantics landed wherever the user happened to leave the UI. `highlight` and `button` steps can now declare the desired end state, read the control, click only when it differs, and confirm afterwards — so re-running is a no-op and the step converges from either starting state. When the state is unreadable the step clicks anyway and warns, so no existing guide regresses. (#1493)
- **Data checks on the datasource picker**: A guide can teach "build a panel showing container CPU", the reader can follow every step against an instance holding no container metrics, and the guide ends with an empty panel and no explanation. A datasource input block can now carry `dataCheckQuery` — five optional fields on the picker that already exists, rather than a step type of its own — so the guide confirms up front that the data is really there, with an author-written failure message and an optional blocking mode. (#1612)
- **Kiosk, guide editor, and Dev tools moved into the overflow menu**: Recommendations is now the only rail tab; the rest live in the docs-panel overflow menu, with their existing gates relocated rather than loosened. (#1445)
- **Dev tools opens as a normal closable tab**: Leaving Dev tools no longer feels like leaving the panel or flipping Dev mode off, and the tab bar stacks above panel chrome so the overflow menu stays usable while the editor header is open. (#1509)
- **Block editor header redesign**: A two-row header with a labeled Edit/Preview/JSON rocker on its own line, a labeled Save, and a measured responsive collapse. Preview hides the whole title row — the rendered guide supplies its own heading — and relocates the save or publish status to the toolbar row, with recoloured draft and published badges and a gradient underline under the title input. (#1429, #1435)
- **Pathfinder wordmark in the docs panel tab bar**: Adds the "Interactive Learning" wordmark and a divider, which hide below a 360px container width so branding yields first when the bar is narrow. (#1447)
- **E2E CLI runs path and journey packages**: `pathfinder-cli e2e --package` expands path packages recursively into ordered leaf-guide chains, and repository-wide runs keep independent guides runnable when another root has an unavailable or structurally invalid prerequisite. (#1474)
- **Learning paths can be uploaded through the backend API**: `scripts/upsert-learning-path.sh` is the authoring counterpart to the private catalogue above. It walks an interactive-tutorials package directory, resolves each id in `milestones` to the subdirectory that declares it, and uploads the milestones before the path's cover page so a path never references a guide that isn't there. Re-running updates in place; the tool refuses any run that would overwrite a resource it did not write, and warns when the CRD would prune an undeclared block field. (#1504)

### Changed

- **Sandbox terminals now come from the `grafana-coda-app` plugin**: Pathfinder's Coda backend — roughly 5,300 lines of Go covering the REST client, JWT refresh, the WebSocket-relay SSH transport, the PTY session, VM resolution, and quota and rate limiting — is deleted, and the terminal is rewired onto the versioned `v1` API of the separate [`grafana-coda-app`](https://github.com/grafana/grafana-coda-app) plugin through its published `@grafana/coda-client` SDK. Pathfinder keeps the terminal UI and gives up only the backend, so the sandbox is available to any Grafana plugin instead of sitting behind Pathfinder's release cadence. Coda stays optional: availability is probed at runtime rather than declared as a plugin dependency, and an absent plugin means a hidden terminal, not an error. **Operators running Coda must re-enter their enrollment key at `/plugins/grafana-coda-app`** — plugin settings are per-plugin and `secureJsonData` is write-only, so the refresh token cannot be migrated. (#1468)

### Fixed

- **Token-mint failures are no longer shared between callers**: On the completion-records proxy, a failure to mint an on-behalf-of token was written into the namespace-global negative cache and replayed to other callers on the same namespace, breaking the per-caller isolation the handler documents. The failure now carries its own sentinel error and is never cached across callers. (#1570)
- **Concurrent guides no longer read each other's stored answers**: `var-*` requirement checks took guide identity from a window global with a shared `'default'` fallback, so whichever guide last wrote that global owned every check on the page — two guides mounted at once could unlock each other's steps from the wrong stored responses. Identity now comes from a registration stack that each content renderer publishes for its own subtree, so a step's requirement and postcondition checks resolve the guide that actually owns it. (#1578)
- **Guide-response lookups gate on own keys**: Guide-response records are keyed by an author-supplied guide id and author-supplied input-block variable names, so a name matching an inherited `Object.prototype` member resolved through the prototype chain instead of missing. All four keyed lookups now gate on `Object.hasOwn`. (#1596)
- **Draft guides no longer resolve as if published**: URL-only App Platform resolution — deep links and bare-id milestone navigation — returned an unconditional success with no publish-status check anywhere in the stack, because every existing gate was client-side and ran only on the content-loading path. That path now probes publish status, a 403 maps to the same not-found result as a 404 so the response code cannot be used as an existence oracle for a resource the caller cannot read, and a failed probe evicts its cache entry so a guide published later re-resolves. (#1610)
- **Prototype-chain lookups hardened across the learning-path metadata chain**: A milestone id like `constructor` or `toString` could test as a published member with no guide behind it, and the bundled-metadata fallback resolved such an id to a function and rendered it untitled. The lookup maps are now null-prototype and gated with `Object.hasOwn`, the composite resolver registers cache eviction on the resolution's first-hop reaction, and `CustomGuideManifest.type` no longer claims a narrowed type the wire has not been validated against. (#1594)
- **Malformed guides fail cleanly at launch, and launch diagnostics stay out of telemetry**: `prepareGuideLaunch` now runs fetched content through the same validation gate the parser applies, so a malformed guide returns a failure result instead of throwing into an uncaught rejection mid-launch. Launch-failure telemetry carries only stable low-cardinality values — the content URL normalized to drop query and fragment, plus an error code and deduped schema-error codes in place of formatted messages that could echo guide-authored strings. The user-visible alert is unchanged. (#1576)
- **Resetting a course clears its own completion record**: `resetPath` never cleared the path's own completion keys for paths carrying no `url` — the branch App Platform courses always take — so a reset cleared the visible state but left the "all milestones done" checklist behind, and the next single guide completion re-crossed the threshold and re-declared the course complete, with nothing in the product able to clear that record. Reset now clears the path-level milestone checklist, journey percentage and interactive progress, batches every bounded-record delete so concurrent deletes cannot restore each other, and backfills users already stuck in that state. (#1588)
- **Custom-guide catalogue failures are observable instead of silent**: A hard request failure — a 503, a network drop, a timeout — ended in a bare `.catch(() => [])` that discarded the error, and a present-but-non-array `guides` fell back to an empty list that was then cached for the full TTL, making a schema mismatch indistinguishable from "this stack has authored no guides". Both paths now log and emit the same telemetry pair as the soft-200 path, split by a bounded cause token, and the malformed case is deliberately not cached so a corrected backend recovers on the next fetch rather than after the TTL. A `null` `guides` is still treated as absent, not malformed — the Go proxy marshals an empty slice that way. (#1587, #1595)
- **E2E runner artifacts and reporting hardened**: Concurrent runs shared Playwright output paths, bearer-authenticated traces persisted credentials to disk, broad timeout matching misclassified guide failures as infrastructure failures, and skip-only or zero-pass runs could report a misleading summary. Output is now isolated per invocation, tracing is disabled when bearer authentication is active, and report outcomes reflect verified execution. (#1443)
- **Unrecognized experiment variants no longer enroll users**: A remote `pathfinder.highlighted-guide-experiment` payload with a typo'd or renamed `variant` was cast straight through and enrolled the user into an arm that does not exist, auto-opening the sidebar and writing a once-per-browser marker for the bogus arm. The variant is now membership-checked like the rest of the payload. (#1529)
- **Malformed `pages` arrays no longer crash the auto-open orchestrator**: `HighlightedGuideConfig` checked that `pages` was an array but not that its elements were strings, so a payload like `{ pages: [1, 2] }` validated and then threw downstream on `pattern.trim()`. (#1551)
- **Plugin settings save preserves provisioned fields**: Saving from any configuration tab dropped provisioned `jsonData` fields such as `stackId`, because Grafana's settings API fully overwrites `jsonData` and the frontend only sent the fields it knew about. (#1514)
- **Plugin settings read from one authoritative source**: Pathfinder read its settings from Grafana's `meta.jsonData` snapshot, which can lag a recent save, and four separate places wrote the `window.__pathfinderPluginConfig` global that non-React callers and the E2E runner depend on. A single hook now owns that global and refreshes it from the settings API, with the first publish kept synchronous so the deep-link and link-interception listeners exist before first paint. (#1611)
- **Grafana overlays render above the popped-out panel**: With the guide editor popped out, opening the header kebab — or any Grafana dropdown, menu, tooltip, or modal — drew it behind the floating panel. The panel now sits below Grafana's overlay band while staying above app chrome. (#1481)
- **Highlights no longer auto-open the navigation sidebar**: A `highlight` step whose target sat anywhere under a `<nav>` element opened and docked the Grafana mega menu, even when the target had nothing to do with navigation. (#1466)
- **Browser Back from a content-only guide exits quietly**: Going back from a transient full-screen prose launch no longer reopens a closed sidebar with the prose squeezed into it. Only history pops take the quiet path; every push path keeps today's dock behavior. (#1471)
- **Docs links work from every launch surface**: The auto-open docs listener was mounted only on the sidebar renderer, so an intercepted docs-link click did nothing at all while the floating panel or full-screen page owned the surface. (#1461)
- **Floating dock-to-sidebar persists consistently across sessions**: The dock-to-sidebar pill saved the sidebar preference in a fresh session but silently skipped the save if a guide had been auto-launched earlier in the same session. (#1458)
- **The challenge block is reachable from the block palette**: It had a schema, metadata, and a working form but was missing from the palette's block-type list. The block-type registries are now exhaustive, so a future block type cannot go missing the same way. (#1531)
- **Guided steps no longer leave an orphaned overlay when they complete early**: Completion was persisted before the guided handler installed its listeners, which could auto-collapse and unmount the section before the overlay existed, leaving a stale callback to create an overlay with no owner until the step timed out. The guided loop now starts first, and for a final button or highlight action completion persists from the click listener during document capture, before the click changes routes. Cancellation, timeout, and error outcomes still persist nothing. (#1616)
- **Switching a step block's type keeps its text**: The type dropdown used the generic block converter, which copied steps without translating the type-specific text field, so a multistep `tooltip` never reached the guided `description` and the reverse conversion had the same hole. That pair now routes through the field-aware conversion owner, keeping the target-incompatible confirmation dialog and shared block metadata intact. (#1606)
- **Converting an image, video, or empty block to a challenge succeeds**: The conversion failed schema validation because it produced an empty brief. A placeholder brief is now supplied only when the source carries no usable text; content-bearing sources still map their content into the brief. (#1632)
- **An absent Coda plugin is no longer reported as a fault**: On a Grafana without `grafana-coda-app`, every Pathfinder panel render logged a 404 plus two failure lines for an optional plugin whose absence is the ordinary case — and the probe ran even with the terminal feature switched off, because the docs panel called the availability hook unconditionally. The probe now takes the caller's own gate, and a missing plugin resolves quietly. (#1645)
- **The welcome tour's Home step works on Grafana 13.2**: Grafana 13.2 removed Home from the mega-menu, so the step's nav-menu-item target resolved to zero elements and "Do it" never completed. No single selector spans the supported range — 12.3 has Home as a nav menu item, 13.2 has it as a breadcrumb inside the menu — so the step accepts either, and every nav selector in both welcome guides moves from a hardcoded `data-testid` literal to a `{grafana:...}` token that resolves against the running Grafana's own selector set, so a future rename in core is picked up instead of silently matching nothing. (#1646)
- **Two source files hidden from grep**: Each carried a literal NUL byte as a string delimiter, which made `grep -r` and `rg` skip them silently. Both are now written as `\x00` escapes, and a guard fails CI and pre-commit if any tracked file grows a raw control byte again. (#1537)
- **Backend CI resolves its Go version from `go.mod`**: The build failed intermittently when a runner's cached Go was older than the version `go.mod` requires and `GOTOOLCHAIN=local` blocked a self-upgrade. (#1507)
- **JSONC parsing no longer eats comment syntax inside strings**: The comment stripper behind the import-graph loader used two regexes with no notion of string boundaries, so a tsconfig `include` of `"src/cli/**/*"` came back as `"src/cli*"` — the `/**/` matched as an empty block comment — silently narrowing the glob to a path that matches nothing. Replaced with a string-aware scan that tracks quoting and escapes. (#1602)
- **E2E runner reliability**: Markdown-only guides — 53% of the interactive-tutorials population — now pass with zero steps instead of timing out and cascading skipped prerequisites through the rest of a path. The runner also executes whichever control is actually rendered rather than assuming "do it", fails unmet mandatory requirements instead of skipping them, carries the manifest's `startingLocation` into Playwright so guides do not run from `/`, keeps guided execution observable until subactions settle, and retries panel bootstrap when Grafana's Help menu wins the race. (#1477, #1441, #1440, #1442, #1426)
- **E2E runner lifecycle and overlay handling**: Four lifecycle gaps that produced false guide failures are closed — skipped steps now advance plugin state before the skip is recorded, guided readiness uses the step's timeout budget instead of a fixed five seconds, locators are re-resolved after navigation, and scroll and late-completion checks use bounded waits so a detached step cannot consume the whole guide timeout. A requirement fix is also given a bounded settle window before the runner declares "No Fix button available", Pathfinder's own badge celebrations are dismissed before actions instead of swallowing clicks, and the dev-mode and expand-terminal controls that Pathfinder's own tutorials target gained stable `data-testid`s. (#1614, #1615, #1617, #1619, #1641)

### Security

- **npm vulnerabilities patched**: Bumps `dompurify` and `js-yaml` as direct dependencies and overrides, plus safe transitive fixes across `websocket-driver`, `brace-expansion`, `postcss`, `immutable`, `fast-uri`, `tar`, `body-parser`, and `golang.org/x/crypto`. The `react-router` 8.3.0 bump is deliberately deferred — it would downgrade `@grafana/ui`, and the advisory only affects unstable APIs this plugin never uses. (#1476)

### Chore

- **App Platform contract pinned by tests**: Golden fixtures couple the four App Platform envelopes to their Zod schemas, catalogue-manifest normalization is pinned by its own tests, and the second-round review's coverage gaps are closed — the completion-records nil-exchanger gate, the untagged pre-network declines that keep negative caching alive, `buildManifest`'s repository forcing, and a Go-to-TypeScript group-version pin that could previously drift apart while staying green. A test fake that outlived its own describe and leaked into the four following blocks is also put back. (#1580, #1571, #1589, #1584)
- **Block-conversion eligibility made total over `BlockType`**: The container and convertible type lists are replaced by source and target exclusion registries that `satisfies Record<BlockType, string | null>`, so a new block type fails to compile until it has an explicit verdict, and a rejected conversion names the offending type and its reason instead of blaming "container blocks". No functional change to any UI-reachable conversion. (#1577)
- **Review skill detects inter-PR contract accretion**: A contract-evolution scan for the failure mode a per-PR review cannot see by construction — each PR extends a capability against a contract that was never made explicit, so every diff is locally correct and the defect lives in the sequence rather than in any single change. (#1337)
- **German translations reworked for natural UI copy**. (#1550)
- **Docs**: Documented the challenge and snippet-ref guide block types (#1538), fixed the stale references left behind by #1408 (#1569), stopped recommending visible-text targets over stable selectors — true of English copy, false across the 21 locales Pathfinder ships (#1598), and corrected the cross-tab controller protocol, the overstated JSON-guide schema coupling, the release reference, and the learning-path reference across two maintenance runs (#1532, #1605).
- **Agent context refreshed**: Split the react-antipatterns rules into themed files, deduped `interactiveRequirements` guidance, aligned the context files with current context-engineering practice, and refreshed the assistant and utils guidance. (#1454, #1452, #1457)
- **Dependencies**: Grafana bumped to 13.1.3, `grafana-plugin-sdk-go` to v0.296.2, `authlib` to its 2026-08-14 digest, `@grafana/faro-instrumentation-replay` to ~2.9.0, Node.js to 24.19, and npm to 12.0.2, alongside routine CI action and base-image digest updates.

## 2.15.0

### Added

- **Interactive guides API moved to the new Grafana App Platform group**: The plugin now reads and writes custom `InteractiveGuide` resources against the `pathfinderbackend.ext.grafana.app` group, gated by its aggregation feature toggle, ahead of the old Cloud App Platform group being retired. (#1430)
- **Collapsible blocks for gating solutions in guides**: Guide authors can add a collapsible block that hides a solution or answer until the reader chooses to reveal it. (#1396)
- **Self-hosted video assets and a first-class Vimeo provider**: Guides can embed self-hosted videos and Vimeo content directly. (#1355)
- **Block editor consolidates pop out, full screen, and selection into a kebab menu**: The block editor header groups these actions under a single overflow menu for a cleaner toolbar. (#1428)
- **Custom guide repository catalogue proxy**: A backend proxy that serves a slim, per-namespace catalogue of a stack's private guide packages, following the App Platform proxy pattern. (#1400)
- **"My completions" read proxy**: A backend proxy that exposes a caller's own guide-completion records from the App Platform. (#1398)
- **New E2E runner image with a schema-backed report contract and capacity retries**: Reworks the end-to-end runner for more reliable guide-chain testing. (#1372)

### Fixed

- **Content type labels removed from the docs panel meta bar**: The meta bar no longer shows redundant content-type labels. (#1405)
- **Input block form validates its pattern field**: The block editor's input block now validates the `pattern` field, with unit tests. (#1302)
- **Recommendation summary expansion simplified**: The recommendations list summary expands more predictably. (#1395)
- **E2E headless runs use full Chromium in containers**: Fixes headless browser failures in the containerized E2E runner. (#1413)
- **E2E selector resolution isolated from the browser runtime**: Selector resolution no longer depends on browser globals. (#1377)

### Chore

- **Completion recording routed through a single recorder boundary**: Consolidates guide and journey completion behind one recorder seam (behavior-neutral) ahead of the completion-records backend work. (#1386)
- **Import-cycle clusters dissolved and ratcheted**: Breaks three import-cycle clusters via leaf extractions, and adds a file-level circular-dependency ratchet plus a Node-context environment-reachability check. (#1391, #1358, #1378)
- **Block editor header extracted into focused components**: Pure refactor of the header into smaller pieces. (#1406)
- **Translations completed across all 20 locales**: Full localization coverage refreshed. (#1277)
- **Cross-tab test flake fixed**: Closes a controller-binding race in the `pairOverBus` cross-tab test. (#1410)
- **CI alerts on main-branch failures**: Routes main-branch CI failures to #grafana-pathfinder-alerts. (#1367)
- **Docs**: Documented the backend App Platform proxy pattern (#1401) and the telemetry instrumentation policy + facade-boundary ratchet (#1412), added agent context for the Graft dev workflow (#1384), refreshed E2E CLI guidance (#1375), and documented pool-manager integration in E2E testing (#1371).

## 2.14.2

### Fixed

- **"My learning" header button opens the My Learning page again**: #1286 rewired the docs panel's header "My learning" icon to switch to the in-panel recommendations tab, leaving no way to reach the actual My Learning page from the sidebar. The header button navigates there again; the guide footer's "Return to my learning" button is unchanged. (#1368)
- **Block editor preserves view mode and JSON drafts across remounts**: Switching to Preview or JSON mode and popping the panel out or docking it back no longer resets to Edit mode or drops an unapplied JSON draft. (#1314)
- **Secondary step buttons size to their label**: The "Show me" and "Do it" buttons on interactive steps no longer render inside an oversized fixed-width button. (#1323)
- **Resume/do section button uses correct singular and plural step counts**: The catch-all section action button and its tooltip no longer read "(1 steps)" when exactly one step remains. (#1325)
- **Analytics `content_type` no longer diverges for the same interactive guide**: Standardizes `content_type`/`link_type` into shared enums so the same guide kind always reports the same value regardless of which button opened it, and fixes a `source_page` property that held a UI-location string instead of a URL, plus four dead `blockType` comparisons that could never match. The interactive-guide `content_type` value also moves from `interactive_guide` to `interactive-guide` to match the separator convention used elsewhere — update any saved RudderStack dashboard/query filtering on the old value. (#1363)

### Chore

- **Telemetry payloads trimmed and normalized**: Sequence action-error telemetry now reports a bounded error name plus a coarse category instead of the full error message, the content fetcher's log messages and the Faro view-name adapter route through the shared URL normalizer instead of deriving URLs independently, and Faro exception/log messages trim embedded URL query strings to `hostname/path` — consistent telemetry hygiene across the interactive-step retry path and every other exception/log producer. (#1347, #1349, #1350)
- **Selector generation anchors on stable structure and composes via a token grammar**: The element picker now emits version-stable `grafana:` selector paths and anchors identity-less wrapper elements on stable ancestors or `:has()`-scoped descendants instead of brittle positional selectors, fixes a multi-colon parameter-splitting bug and unescaped CSS attribute-value interpolation surfaced by that work, and makes the two mechanisms compose through an embeddable `{grafana:path:param}` token so scoped/anchored candidates keep their version-stable identity instead of degrading to raw testid literals. (#1156, #1157, #1360, #1361)
- **E2E cloud stack isolation moved to the pool manager**: Cloud guide-chain isolation for unsafe or unauthenticated chains now leases stacks from an independently deployed pool manager instead of CLI-owned provisioning, and guides that declare required plugins now get them installed on the leased stack. (#1230, #1346)
- **Telemetry facade and outcome-classification refactors**: Consolidates telemetry behind a typed facade and a single owner for user-action-outcome classification, latches the closed-panel surface read to avoid a per-event DOM/localStorage cost, and derives panel-ready readiness from scene state instead of a one-shot event. (#1338, #1357, #1348, #1356)
- **Faro event/action names now match the analytics.ts convention**: Faro-only telemetry naming no longer diverges from RudderStack — a missing `pathfinder_` prefix on four Faro-only funnel events is added, and five call sites that invented their own duplicate event name instead of reusing the real interaction name now share it, so the same click is discoverable under one name in both pipelines. (#1362)
- **Block editor backend save flow extracted into a dedicated hook**: Pure refactor with no behavior change. (#1331)
- **Internal code-quality fixes**: Resolves CodeQL findings for dead error-boundary state, an import ordered after its first use, a duplicated character in a regex character class, and a test mock that dropped `IntersectionObserver` options. (#1317, #1318, #1319, #1320)
- **E2E CLI no longer crashes on Node-side logger imports**: The shared logger lazy-loads the Faro bridge behind a browser-global guard instead of importing it eagerly. (#1321)
- **Docs**: Refreshed the selector-authoring and custom-guide-lifecycle reference docs to match current behavior (#1340), and corrected `SCORM.md`'s core assumption from a multi-SCO manifest-driven model to the single-SCO, per-vendor-adapter reality found in real SCORM exports (#1354).

## 2.14.0

### Added

- **Faro frontend telemetry re-enabled**: Re-enables Grafana Faro frontend telemetry for Pathfinder in Grafana Cloud — disabled since #389 pending a collector CORS fix — covering errors, sessions, logs, user actions, and sourcemaps. Cloud-only, gated behind a remote kill-switch (`pathfinder.frontend-telemetry`), and filtered so only telemetry attributable to Pathfinder leaves the page. (#1275)
- **Document outline navigation in the guide reader**: Adds a GitHub-style jump-to-heading rail to the two-tab guide reader, with scroll-spy highlighting of the current section and keyboard/a11y support. (#1226)
- **Two-tab controller admin toggle**: Replaces the compile-time flag gating the two-tab interactive controller with an admin-controlled plugin-config setting, `enableTwoTabController` (default off), mirroring the existing `enableAiAutoHeal` opt-in. The feature still ships dark by default. (#1174)

### Fixed

- **Floating panel coexists with native modals**: Renders the floating panel into `getPortalContainer()` instead of `document.body`, so on Grafana >=13.1 (which ships the upstream fix) clicking or scrolling the popped-out panel next to an open native modal no longer dismisses it. (#1283)
- **"My learning" navigation stays in the sidebar**: The guide footer's "Return to my learning" button and the tab-bar icon previously did a full-page navigation that tore down the sidebar, dropping users out of the Grafana page they were on. Both now switch to the in-panel recommendations tab instead. (#1286)
- **Recommendations list keeps its scroll position**: Selecting a guide from the Recommended list and returning to it no longer resets the list to the top. (#1296)
- **Floating panel keeps its scroll position through highlight-dodge**: Compacting or restoring the floating panel to dodge a highlighted element no longer resets the guide's scroll position to the top. (#1297)
- **Selector generator no longer picks unstable ids**: Record mode now rejects React `useId()`-generated ids (which are render-position-dependent) and prefers a nearby `data-testid`-scoped bare tag when one is available, closing two root causes of unstable recorded selectors. (#1295)
- **Datasource health requirement checks the real endpoint**: `datasource-configured:` checks now call `GET /api/datasources/uid/{uid}/health` instead of a `/test` endpoint that has never existed in Grafana's route table — every check previously 404ed and failed even for healthy data sources. (#1293)
- **OSS boot no longer blocked by the online package index**: OSS users who haven't accepted the recommender T&C no longer wait 12-15s (or longer on slow networks) for the recommendations skeleton — the disabled branch no longer waits on a cold-cache manifest fan-out across all published packages. (#1285)
- **Cloud home guide recommendations restored**: Guide targeting now gates on `targetPlatform` instead of the retired setupguide path, so Cloud users see the Cloud-specific first-dashboard and welcome guides again now that Cloud's landing page moved to `/`. (#1282)
- **Bundled guides no longer render their title twice**: Removes a redundant leading heading from six bundled guides and adds a `validateGuide()` warning (surfaced in the CLI and MCP authoring tool) so future guides get flagged before shipping. (#1235)
- **Block editor "Library" action hidden until a guide is saved**: The more-actions menu no longer surfaces the Library item (which lists, opens, and deletes backend guides) for users who have never saved one. (#1287)
- **Docs panel overflow-tab chevron**: The "Show N more tabs" control now puts the count before the chevron and flips the chevron to reflect whether the dropdown is open. (#1288)
- **Redo control matches the shared secondary button style**: The completed-step Redo control now uses the same `Button` component as "Show me" / "Skip" instead of a bespoke styled `<button>`. (#1289)
- **Dock-to-sidebar action uses the columns icon**: Swaps the popout header's dock-to-sidebar icon from `angle-double-right` (read as navigate-forward) to `columns`, matching the layout the action produces. (#1303)
- **Removed the redundant guide-toolbar "More options" menu**: The docs panel showed two "More options" menus at once; the toolbar's (which only duplicated "Give feedback") is gone, and its dev-only "Refresh" action moved into the tab-bar menu. (#1238)
- **Two-tab controller formfill lands on backgrounded live tabs**: Formfill steps targeting the Monaco query editor now write through Monaco's model API instead of the hidden textarea, so they take effect on the live tab when driven from the two-tab controller. (#1181)
- **"Full screen" button opens full screen instead of the home page**: The `panelMode=fullscreen` deep-link handoff no longer bounces back to home, and the full-screen route checks now work when Grafana is served under an `appSubUrl` sub-path — both the deep-link handler and the panel-mode self-heal compare against Grafana's basename-normalized router path instead of the raw browser pathname. (#1353)

### Security

- **Authenticated pairing-accept in the two-tab controller**: The two-tab controller no longer binds its pairing slot on a bare `sessionId` match, closing a forged-accept availability DoS where a same-origin script could dead-lock the controller, and tightens the signed-message timestamp window against future-dated `sigTs`. Both are pre-launch hardening for the still-disabled `enableTwoTabController` toggle. (#1170)

### Chore

- **Dependency cleanup unblocks faro-react**: Forward/backward-compat pass for Grafana Cloud's move to React 19 in prod (self-hosted OSS stays on React 18; `react`/`react-dom` remain pinned at 18.3.1), plus ~28 safe patch/minor bumps and a `js-yaml` override fix. (#1241, #1242)
- **`@grafana/scenes` refreshed within declared ranges**: 8.2.6 → 8.9.5 in the lockfile; `@grafana/assistant` held back by the `.npmrc` min-release-age supply-chain guard. (#1294)
- **`grafana-plugin-sdk-go` bumped to v0.292.2** (#1243)
- **Compact JSON for agent-facing MCP and CLI output**: Drops the two-space `JSON.stringify` indentation from MCP tool results and the CLI `--format json` path — pure token overhead for LLM/agent consumers, saving 22-48% of bytes. (#1240)
- **Floating panel dodge-session state machine**: Models the highlight-dodge compact/restore lifecycle as an explicit pure reducer instead of an implicit combination of refs and event ordering. (#1300)
- **Two-tab controller pre-launch hardening**: Adds real-browser adversarial Playwright specs (registered but skipped until the flag flips) and a dedicated `cross-tab-controller` subsystem concern entry so security-relevant changes route to focused review before the feature ships enabled. (#1173, #1165)
- **Cold Grafana Cloud stack E2E lifecycle**: Adds a standalone disposable-stack lifecycle (provisioning, short-lived runner tokens, best-effort teardown) and routes unsafe/unauthenticated non-instance Cloud E2E chains through it. (#1212, #1213)
- **Renovate noise reduction**: Adds a 14-day stability filter before PRs are created, switches rebasing to only fire on conflict, and disables indirect Go module updates. (#1267)
- **Fixed a flaky cross-tab reconnect acceptance test**: The signing and reconnect HMAC chains were competing for Node's UV thread pool under CI load, pushing latency past the test's timeout. (#1270)
- **Docs**: Corrected `steps`/`milestones` terminology in the package format docs (#1268) and reformatted `standards-alignment.md` with Prettier (#1269).

## 2.13.1

### Added

- **PR tester assembles full learning paths from the CDN catalog**: Learning-path mode now overlays a PR onto the published CDN catalog instead of requiring every milestone's `content.json` and `manifest.json` to be present in the diff, so a PR that edits only a subset of a path's milestones can still be tested end to end. (#1214)

### Fixed

- **Sidebar no longer re-opens on unrelated page navigation**: An explicit close now clears the persisted docked-sidebar state, so Grafana's `browser_restore` stops re-opening the Pathfinder panel on later page loads (`/alerting`, `/dashboards`, `/explore`, and others). (#1217)
- **Auto-launched guides always render**: Guide delivery now flows through a reusable latched broadcast channel, closing a race where the one-shot auto-launch event could fire before the lazy-loaded panel's listener attached — leaving the experiment open recorded but the guide never shown. Covers both the highlighted-guide experiment and the `?doc=` deep-link path. (#1218)
- **No spurious guide opens after the sidebar unmounts**: Delayed auto-launch emits are now guarded on the sidebar being mounted at fire time, so a latched post-unmount emit can no longer replay on a later manual open (which also raised a spurious `auto_launch_tutorial` analytics event). Follow-up to #1218. (#1219)

### Chore

- **Retired unused A/B experiments**: Removed dormant A/B experiment scaffolding, keeping the active highlighted-guide experiment. (#1215)
- **Shared cloud-stack E2E targeting clarified**: Renamed the shared cloud-stack environment module and tightened how E2E runs target it. (#1211)
- **Docs**: Trimmed and centralized per-session agent context. (#1216)

## 2.13.0

### Added

- **AI auto-heal ("Fix this") for failing interactive steps**: when a step's selector can't be matched and no deterministic recovery applies, an opt-in "Fix this ✨" button asks the Grafana Assistant to propose a patch to the guide, which is validated against the live DOM before it is applied. Gated behind a new `enableAiAutoHeal` admin setting (default off) **and** Grafana Assistant availability — fully inert until a tenant opts in. See `docs/developer/AI_FIX.md`. (#980, #983, #984, #993, #995, #996, #997)
- **Reusable snippet references in interactive guides**: Authors can reference a shared set of steps by name instead of copy-pasting them. Pathfinder resolves the reference against the CDN when the guide loads, so improving a snippet upstream updates every guide that uses it. The block editor gains a "Reusable" palette group with a snippet picker, and an unresolvable snippet renders an inline placeholder rather than breaking the guide. Ships with a snippet schema and a `build-snippets` CLI command. This first version consumes upstream-authored snippets only — no nesting and no version pinning. (#907, #981)
- **Full-screen guide-reader overlay**: New `GuideReaderOverlay` renders a guide full-screen as a portal over the page (the kiosk pattern) behind theme and feature providers, and an `InteractiveModeContext` distinguishes interactive from controller tabs. Anonymous step IDs are now assigned from a module-level counter so they stay stable across re-renders. Foundation for the two-tab controller. (#1045)
- **camelCase field aliases accepted in JSON guides**: Hand-written guides using `targetAction` / `refTarget` / `targetValue` now pass validation. A pure pre-schema normalizer rewrites them to the canonical lowercase forms (canonical wins on conflict) at the single `validateGuide` chokepoint, closing the long-standing gap between the runtime parser — which already tolerated the aliases — and the schema. (#987)
- **MCP authoring sessions**: The TypeScript MCP authoring server gains a session mode — an in-memory session store with sliding TTL and optimistic-concurrency generations, opaque Crockford base32 session tokens with log-safe hashing, session-aware authoring tools, finalize plus guidance handoff, and observability and hardening tests. Lands as a four-part stack. (#1024, #1025, #1026, #1027)
- **Dependency-aware E2E guide chaining**: The `pathfinder-cli e2e` runner now plans guide execution from a `repository.json` index, grouping guides linked by a `depends` prerequisite into ordered chains and running prerequisites first. Under `--clean` the isolated docker stack resets once per chain instead of between every guide, so a prerequisite's state survives for its dependents. Missing prerequisites are auto-included, `depends` cycles are rejected, and dependents of a failed prerequisite are reported as skipped. Adds a `--repository` flag and a `--clean` flag for isolated docker-compose runs. (#994, #1016, #1017)
- **Package-aware and remote E2E runs**: The E2E command can resolve published guides by bare package id (`--package <id>`) or run the entire published CDN repository (`--remote`), reusing the same plan, run, and report path as local guides. A CLI-local recommender client and remote package resolver fetch each target's transitive prerequisites from the CDN index, with a base-URL override and a package-aware test-target resolver. Network, validation, tier, and unsupported-type failures degrade to structured skips rather than aborting the batch. (#1086, #1087, #1103, #1104, #1089)
- **Cloud-tier E2E authentication**: Cloud-tier guide runs can authenticate against real Grafana Cloud stacks by provisioning short-lived service-account tokens from explicit per-origin admin-token mappings (`--cloud-instance-admin-token host=ENV_VAR`). Admin tokens and minted runner tokens stay out of package metadata and JSON reports, and each dependency chain gets its own ephemeral identity. (#1154)

### Fixed

- **Two-tab controller gating** (epic #1133): The controller overlay and live-tab executor now mount on the same `shouldMountSidebar()` policy as the rest of Pathfinder rather than bare `pathfinderEnabled`, so they never appear in sessions where the sidebar is suppressed by experiment variant or 24h conditions. Per-run IDs added to the `step-command` / `step-complete` / `step-progress` wire messages let the controller discard replies from cancelled runs, preventing a stale `step-complete` from settling a subsequent retry. (#1145, #1146)
- **React Compiler compliance**: Resolved the globals plus immutability, set-state-in-effect, and refs rules across the codebase and removed the lint disable block. (#1041, #1042, #1043)
- **E2E step-completion reliability**: The guided substep loop and the post-interaction flow now treat a step unmount as completion, and step-locator attribute reads are bounded to prevent test-timeout hangs. (#982, #985, #1014)
- **Analytics enrichment includes all enrolled experiments**: Event enrichment now includes every enrolled experiment rather than a subset. (#964)
- **Image block URLs are validated**: Image block URLs are now validated before use. (#960)
- **PR tester clamps stale persisted test mode**: A persisted test mode the current PR doesn't support is clamped to a supported mode instead of leaving the tester in an invalid state. (#1137)
- **No redundant `dispatchEvents` after combobox fill**: Removes a redundant `dispatchEvents` call after a combobox fill in `handleDoMode`. (#966)
- **E2E results posted as a PR comment**: CI posts E2E results as a PR comment instead of pushing them to `gh-pages`. (#1112)

### Security

- **Dependency overrides hardened and `dompurify` bumped**: Bumps `dompurify` to `^3.4.11` and pulls security-relevant transitive dependencies (`js-cookie`, `js-yaml`, `brace-expansion`) up to patched versions via targeted `overrides`, while deduping the OpenTelemetry and `uuid` trees. (#1203)
- **Supply-chain and CI hardening (Node 24 + npm lockdown)**: Moves the toolchain to Node.js 24 and adds `.npmrc` lockdown — `allow-git=none` blocks git-protocol dependency installs and `min-release-age=3` refuses package versions younger than three days, mitigating fast-yanked malicious releases. Bumps `@grafana/*` to 13.0.2 to remove git-protocol usage inside `@grafana/ui`, and tightens `bundle-stats.yml` workflow permissions to `contents: read`. (#1101)
- **Enforce F5 DOM sinks mechanically**: Adds mechanical enforcement of the F5 frontend-security rule for dangerous DOM sinks. (#1050)
- **`js-yaml` to v4.2.0**: Security advisory update. (#1037)
- **`golang.org/x/net` to v0.55.0**: Go module security advisory update. (#958)
- **`golang.org/x/crypto` to v0.53.0**: Routine Go module security bump. (#1022)

### Chore

- **Storage subsystem refactor**: Phase 0-1 groundwork (characterization tests plus key inventory), extraction of `experimentAutoOpenStorage` and a bounded-record factory, promotion of `interactive-progress-cleared` into `StorageEvents`, three shared storage utilities, and added characterization tests for previously untested storage modules. Behaviour preserved. (#968, #1030, #1055, #1057, #1058, #1059)
- **E2E command modularization**: The CLI `e2e` command is broken into named step functions and dedicated modules (clean-environment, grafana-health, playwright-runner, exit-codes, and the CLI↔Playwright env-var protocol) and finally relocated into `src/cli/e2e`. Duplicate file readers and guide-status counts are collapsed, requirement-ID comment tags dropped, and five earlier tech-debt findings in validate and build-graph addressed. (#1015, #1076, #1077, #1078, #1079, #1080, #1081, #1152)
- **docs-retrieval and security-helper extractions**: Extracts `url-utils` and `metadata-extract` from `content-fetcher` and an `isTrustedFinalUrl` trust-gate helper. (#1105, #1106, #1109)
- **docs-panel `loadTab` extraction**: Extracts shared `loadTab` helpers and routes `openDocsPage` through `loadTab`. (#986)
- **Block-editor extractions**: Extracts a step-field-mapping utility and dedupes merge logic in `useBlockEditor`, with added tests. (#935, #1031)
- **Context-engine event bus**: Extracts the context event bus out of `ContextService`. (#1046)
- **Requirements check-dispatch lookup table**: Replaces the requirements check-dispatch if/else chain with a lookup table. (#989)
- **Test tripwires**: A tripwire that the section step-type map matches the registry, and a skill/rule reference-graph test. (#988, #1028)
- **`@grafana/*` core packages to 13.1.0** (#1150)
- **Docs**: AI auto-heal flow plus admin opt-in (#998), dependency-aware E2E chaining and `--repository` (#1018), the `build-snippets` CLI command and `/coda/exec` endpoint (#1049), and a new `CONTRIBUTING.md` plus PR template with PR-scope guidance (#1122).
- **Skills**: Rewrote the `pr-summary` skill for higher PR-process fidelity (#953) and increased `/review` depth and aggression (#1032).
- **CI**: Cache `node_modules` by package-lock hash and drop the run-id handoff. (#992)

## 2.12.0

### Added

- **Section-level requirements "Fix this" button**: Section requirement banners now expose the same "Fix this" affordance individual steps already provide. When a section's location requirement fails, the banner shows a user-friendly explanation and a button that dispatches the existing fix infrastructure (`NavigationManager`, `getRequirementExplanation`) — no new patterns, no new recovery paths. Closes #476. (#884)
- **Highlighted-guide experiment auto-launches the guide tab**: The `pathfinder.highlighted-guide-experiment` flag now opens the configured guide directly as a sidebar tab on matched pages (parity with `?doc=`), instead of only opening the sidebar and pinning the recommendations tab. Featured-slot injection still runs in parallel as a fallback re-entry point. (#897)
- **Centralised deep-linking with SPA navigation listener**: The `?doc=` / `?panelMode=` / `?kiosk_session=` deep-link flow now re-runs on subsequent SPA navigations, not just at plugin module load. Users can deep-link to Pathfinder from another page in Grafana — useful when downstream plugins (e.g. setup-guide) hand users off mid-session. (#904)

### Fixed

- **Floating panel preserved milestone on dock-back**: Floating mode snapshotted localStorage at pop-out and restored it verbatim on dock-back, overwriting milestone progress made in the floating panel. All surfaces now share `tabStorage` and the latest `currentUrl` wins on mount; the snapshot mechanism is removed and the pop-out handoff awaits `saveTabsToStorage()` before flipping mode. (#928)
- **Starting-location prompt is one-shot per guide launch**: The implied-0th-step alignment prompt grew a reactive re-evaluation loop that fired on every Grafana history change, pausing guides mid-flow when they stepped the user across pages. The prompt now evaluates once at guide launch and never re-surfaces. Net -643 lines. (#926)
- **Popout panel milestone navigation + theme conformance**: The floating panel now mounts the shared milestone toolbar (prev/next arrows, "Milestone X of Y", Open, Reset, keyboard shortcuts) and wraps its standalone React root in `ThemeContext.Provider`, so it matches Grafana's light/dark theme and live-updates on theme toggle. (#925)
- **"Fix this" docks the nav from overlay state**: `openAndDockNavigation()` previously bailed without docking whenever nav items were visible in the DOM, conflating "already docked" and "overlay mode." A new aria-label discriminator (`#dock-menu-button` reads "Dock menu" in overlay, "Undock menu" when docked) clicks the button only in the overlay case. Closes #910. (#921)
- **Completion store persists additive merge from hydration resolve**: A race between an in-flight section hydration read and a synchronous `markStepCompleted` write could overwrite the on-disk snapshot, then silently leave storage out of sync with the in-memory merge. The hydration `.then` resolver now persists when it adds new IDs, not only when it clears. F-5 follow-up to #909. (#919)
- **All-passive guide reports 100% when acknowledged**: Guides with entirely passive sections stayed at 0% in the progress chip and My Learning row even after every section was acknowledged, because the ack writer routed through `sectionAcknowledgementStorage` while the completion store read from `interactiveStepStorage`. The completion store now reads ack counts directly. F-1 follow-up to #909. (#917)
- **Browser storage quota toast**: All four `QuotaExceededError` catch blocks in `user-storage.ts` previously swallowed the error into a `console.warn`, so users never learned their progress had silently stopped persisting. A single `alertWarning` toast now fires the first time any catch block trips: "Browser storage full. Your progress may not be saved. Try resetting old guide progress via My Learning to free up space." N-3 follow-up to #909. (#913)
- **Cross-tab completion-store sync**: With the same guide open in two tabs, each tab had its own module-scope completion-store cache while sharing localStorage. Tab B's stale cache could silently write back over tab A's authoritative reset. A new module-scope `storage` event listener plus a hydration-generation counter close the race. N-2 follow-up to #909. (#912)
- **Feature-flag exposure fires on override + documented `/packages` URL form**: The `pathfinder_feature_flag_evaluated` event only fired on real OpenFeature evaluations, so `clearExposures()` / `showExposures()` were no-ops for any override-driven QA run. Exposure reporting is now shared between the hook and the override branches. The required `guideId` URL form for `interactive-learning.grafana.net` guides is now documented up front in `EXPERIMENT_TESTING.md`. (#906)
- **Refreshed Prometheus + Loki 101 bundled guides**: Rebuilt against the current Grafana dashboard editor UX (edit sidebar instead of the legacy Add → Visualization menu). Headings and narrative copy switched to sentence case; leftover `guided` wrappers flattened to plain interactive steps. The Prometheus guide adds a new "Create a dashboard from Explore" section. (#905)
- **Section header swaps to "Steps" when no interactive steps**: Sections with no author-set title and only passive or noop children no longer show the misleading "Interactive section" header. Author-supplied titles are preserved verbatim. Closes #843. (#902)
- **Floating panel resize constraints removed**: The 600×700 popout panel max-width and max-height limits are gone — the panel can now be resized up to the full viewport. Default size and minimum bounds are unchanged. (#901)
- **First-dashboard guides repaired against the new editor flow**: OSS and Cloud `first-dashboard` guides now work end-to-end without page refreshes. Switched brittle raw selectors to Grafana's canonical e2e ids and fixed the underlying engine bug where `InteractiveConditional` did not re-render branches when `exists-reftarget` flipped after an action (added a debounced `MutationObserver` for portal-injected elements). (#900)
- **Toast surfaces when guide reset fails**: Replaces the TODO in `useContentReset`'s catch block with an `alertError` toast published via `getAppEvents`. Completes #824. (#899)
- **Block editor type-switch to `terminal-connect`**: Adds `terminal-connect` to `REQUIRED_DEFAULTS` so converting from `image`, `video`, or content-less `code-block` no longer fails Zod validation and silently leaves the block type unchanged. (#892)
- **Requirement buttons gain title + aria-describedby**: Accessibility fix — interactive requirement buttons now expose a `title` tooltip and `aria-describedby` context for screen readers. (#908)

### Security

- **`uuid` and `brace-expansion` patches via scoped npm overrides**: Patches CVE-2026-41907 (uuid out-of-bounds write in `@grafana/ui` via the `v3`/`v5`/`v6` APIs; CVSS 7.5) by bumping `uuid` 11.1.0 → 11.1.1, and CVE-2026-33750 (brace-expansion DoS via zero-step patterns in `minimatch@9`; CVSS 6.5) by bumping `brace-expansion` 2.0.2 → 2.0.3. Both overrides are scoped to avoid touching already-patched siblings elsewhere in the tree. (#943)
- **`golang.org/x/crypto` to v0.52.0**: Resolves CVE-2026-39833 (the in-memory keyring silently accepting unsupported `ConfirmBeforeUse` constraints) and rides a routine 0.50 → 0.52 Go security advisory bump. (#937)
- **`lodash` 4.17.23 → 4.18.1**: Resolves CVE-2026-4800 (`_.template` code injection via untrusted `options.imports` key names; CVSS 8.1). Lock-file-only change; lodash is purely transitive via the `@grafana/*` packages and `slate`/`slate-react`. `npm audit fix` rode along a batch of unrelated transitive bumps (`dompurify` 3.3.2 → 3.4.7, `fast-uri` 3.0.6 → 3.1.2, `flatted` 3.3.3 → 3.4.2, `hono` 4.12.16 → 4.12.23, `ip-address` 10.1.0 → 10.2.0, `terser-webpack-plugin` 5.3.16 → 5.6.0, `@grafana/scenes` 8.2.5 → 8.2.6). Vulnerability count 22 → 11. (#936)
- **Drop `protobufjs` to resolve CVE-2026-41242**: Removes the vulnerable `@protobufjs/utf8` transitive dependency entirely by bumping `@grafana/faro-web-tracing` 2.2.3 → 2.7.0 (whose `@opentelemetry/otlp-transformer` no longer requires protobufjs). `@grafana/faro-react` is pinned exact at 2.0.2 because newer versions add an incompatible `react-router@7` peer; `faro-web-sdk` dedups across both packages. (#933)

### Chore

- **Default-to-no-comments rule + QC8 review check**: New repo-wide policy in `AGENTS.md` defaulting to no comments, with a catalog of bad shapes (narrating obvious code, defending non-actions, dead process artefacts, stale-in-waiting renames) and a keep-list (counterintuitive code, hidden invariants, external-bug workarounds, security warnings). `/review` now checks QC8. (#932)
- **Refactor: collapse state ownership in the interactive renderer**: Whole-pipeline cleanup of the interactive-guide rendering layer. Completion state moves out of component lifetime into a module-scope canonical store at `src/global-state/completion-store.ts` (Tier 1); four legacy progress events collapse into one unified `pathfinder:progress` discriminated event; three architecture-test ratchet exceptions are removed. (#909)
- **Migrate Go MCP tools to TypeScript and retire the Go MCP server**: The architecture pivoted to a single centrally hosted TS MCP on Cloud Run plus Grafana Assistant's web-surface tools, so the per-tenant Go MCP is unused on the new path. Deletes `pkg/plugin/mcp.go`, the three `/mcp*` routes, the static guides directory, and the `scripts/copy-static.js` build step. (#888)
- **`@grafana/*` to v13 majors + `@grafana/scenes` v8**: Bumps `@grafana/{data,schema,i18n}` 12.4.3 → 13.0.1, `@grafana/ui` 12.4.2 → 13.0.1, `@grafana/scenes` 7.4.2 → 8.2.6, and adds `@grafana/runtime ^13.0.0` (resolves to 13.0.1) as an explicit dep so the 65+ files that already import from it stop relying on the transitive peer. Also bumps `@grafana/assistant` 0.1.19 → 0.1.24 and `@grafana/plugin-e2e` 3.6.1 → 3.8.0. `@grafana/faro-react` is pinned at 2.0.2 because 2.1+ requires `react-router@7`. `grafanaDependency` stays at `>=12.3.0-0`. Supersedes #799. (#898)
- **Refactor: extract docs-panel renderer into components + hooks**: Following the High-Risk Refactor Guidelines, the docs-panel renderer drops from 2,681 → 1,555 LoC (-42%); the `CombinedLearningJourneyPanel` SceneObject is untouched. Renderer logic moved into 17 new files plus 18 new test files pinning behaviour. Deferred to a future slice: async state-machine decomposition of `loadTabContent`, the `_hasRestoredTabs` / `_pendingLaunchSource` registry rework, singleton-to-injectable migrations, and any contract-surface renames. (#894)
- **Refactor: interactive-section Tier A + Tier B extractions**: `interactive-section.tsx` drops 2,118 → 1,418 lines (-33%). Tier A landed four atomic extractions (section registry, numbering helpers, step-type schema table, single table-driven loop replacing two parallel switch chains); Tier B landed five hooks (auto-collapse, scroll, document-step-progress, requirements, persistence). Tier C (the 430-line `handleDoSection` async orchestrator) is deliberately deferred — one of the four gate criteria failed. (#885)
- **Refactor: `youtube-video` typed content-key accessors (F-3 follow-up)**: Replaces three `window.*` globals with typed content-key accessors. F-3 follow-up to #909. (#918)
- **Refactor: `multi-step` data parameter tightening (F-6 follow-up)**: Narrows the `multi-step` data parameter to `InteractiveElementData`. F-6 follow-up to #909. (#916)
- **Refactor: extract `toResourceName` and `applyAuthorNote` helpers**: Block editor helper extractions, no behaviour change. (#924)
- **Test: pin sibling re-render on completion-store flip (F-2 follow-up)**: Regression tripwire that re-renders sibling sections when the completion store flips on another section. F-2 follow-up to #909. (#920)
- **Remove unused custom event listeners**: Drops the dead `grafana:location-changed` listeners that the new SPA-navigation listener supersedes. (#922)
- **Docs: promote `/review` to a real skill and re-home `pr-review.md`**: `.cursor/skills/review/SKILL.md` becomes the orchestration entry point; `docs/design/PR_REVIEW.md` holds the pattern catalog. (#911)
- **Docs: document step-model type-change orphan caveat (N-4 follow-up)**: `STEP_MODEL.md` now documents the orphan caveat for stable step IDs across type changes. N-4 follow-up to #909. (#915)
- **Docs: document `evictContentCache` subscriber locality (N-5 follow-up)**: Documents the load-bearing invariant that every storage-clear path must also evict the in-memory cache. N-5 follow-up to #909. (#914)
- **Docs: trim `AGENTS.md` baseline by ~70%**: Compression pass on `AGENTS.md` to remove duplicated subsystem detail that lives in `.cursor/rules/systemPatterns.mdc`. Adds a routing table for on-demand context. (#891)
- **`plugin-ci-workflows` CD v7.3.1 → v8.0.1 (GATB)** (#931)
- **`grafana/plugin-actions` digest update** (#890)

## 2.11.0

### Added

- **Full-screen mode + real PR-tester learning journeys**: Adds a third presentation surface alongside the sidebar and floating panel, and overhauls the PR tester so it opens path/journey packages as real learning journeys (cover page, milestone toolbar, Alt+←/→ navigation) instead of fabricating a single mega-guide. (#846)
- **CTF-style challenge blocks running in Coda VMs**: New `challenge` block type lets authors deliberately break a Coda VM environment server-side; learners use the existing terminal panel to diagnose and fix it, and "Check my work" evaluates a success requirement against the VM with progressive hints on failure. (#875)
- **Pathfinder MCP Server**: TypeScript MCP server (`pathfinder-cli mcp`) for AI-assisted guide authoring. Supports stdio and HTTP transports, structured `clientGuidance` handoff per client capability (Grafana App Platform / OSS / non-Grafana), and read-only CDN repository tools so MCP clients (Cursor, Claude Desktop, Grafana Assistant) can discover and deep-link to published packages without per-instance plugin involvement. (#831, #844)
- **Pathfinder agent authoring CLI (Phase 1)**: Deterministic, schema-driven `pathfinder-cli` that AI agents and humans can use to author Pathfinder guide packages without holding the full schema in context. Every command's flags are generated from Zod and every mutation validates before it writes. Ships with the AI-authoring design suite under `docs/design/`. (#789)
- **Docker packaging + GHCR continuous publish for `pathfinder-cli`**: CLI ships as `ghcr.io/grafana/pathfinder-cli`, rebuilt and pushed on every merge to main as `:latest` and `:main-<short-sha>`. Includes routing for the `mcp` subcommand so the MCP server can be bundled into the same image. (#812)
- **Block editor authoring resilience + sidebar UX overhaul**: Lint primitives for real-time guide validation, convergence on the canonical validation pipeline, new `ConditionChipsField` for requirements and objectives, `HealthStatusBar` with cross-block diagnostics, and per-block `LintBadge` display. (#848)
- **Block editor undo/redo, author notes, searchable palette**: In-session ring-buffer history (20 entries, 1MB cap, 500ms coalescing), an optional editor-only `authorNote` field per block, and a searchable block palette in the editor header. (#862)
- **Quiz answer shuffle (default on, with pin and opt-out)**: Quiz choices are Fisher–Yates shuffled on each view by default. Authors can opt out per block with `shuffle: false` and pin individual choices to their authored index with `pinned: true`. (#867)
- **Highlighted-guide A/B experiment**: New OpenFeature-driven experiment (`pathfinder.highlighted-guide-experiment`) that auto-opens the Pathfinder sidebar on matched Grafana pages and prepends a configured guide to the Featured slot. Both arms keep Pathfinder visible — they differ only in which `guideId` they assign — so analytics attribute click-through to guide content rather than to Pathfinder's presence. (#874)
- **Single-block preview in the block editor**: Preview individual blocks without rendering the whole guide. (#788)
- **Prompted implied 0th step for guide launches**: Auto-recovery now offers a starting-location prompt when a launched guide's implied 0th step is not satisfied at the user's current location. (#810)
- **External guide-import API**: External (CI / Terraform / scripts) flow for upserting guides via the Pathfinder Backend's K8s aggregator. Companion bash helper at `scripts/upsert-guide.sh` accepts any guide JSON. (#829, #830)

### Fixed

- **Mark Section Complete gate + state-machine refactor**: Sections that end with non-interactive content no longer auto-complete the moment the last interactive step finishes — trailing markdown / images / video stay visible behind an explicit "Mark section as complete" acknowledgement. All-passive sections also no longer count as complete on first render. (#877, #842)
- **Section block numbering includes non-interactive blocks**: Sections now number every content block sequentially regardless of whether it's interactive, so a markdown block between two interactive steps no longer breaks the `1. 2. 3.` sequence. (#871, #841)
- **Block editor preserves new guide when leaving JSON mode**: Fixes a stale-closure bug in `useGuideHistory.setState` that caused the block editor to revert to the old guide when pasting a fresh JSON guide and switching to Preview. The same defect also silently corrupted the backend load and persistence paths whenever local state was dirty. (#878)
- **Block editor removes duplicate title in preview mode**: Preview no longer renders the guide title twice (the editable title input is hidden when previewing, matching production rendering which only shows the in-content `<h1>`). (#858, #850)
- **Featured package recommendation metadata**: URL-backed featured recommendations are promoted to matching package-backed recommendations when the same content appears in the main payload, so the featured card gets the package affordance and open behavior. (#803, #746)
- **Recommender banner config button hidden for non-admins**: `EnableRecommenderBanner` no longer shows the "Go to plugin configuration" button to Viewer / Editor users who lack the required permission, matching Grafana's backend enforcement. (#806)
- **Fenced code block indentation in block Markdown editor**: New `normalizeCodeIndentation()` post-processor re-aligns fence markers stripped by TipTap's serializer so code blocks inside nested list items emit valid CommonMark. (#805)
- **Dock-to-sidebar arrow direction**: The arrow on the dock-to-sidebar control now points in the correct direction. (#857)
- **Floating panel popout viewport**: The floating panel popout stays in view across viewport size changes. (#854)

### Security

- **Disable npm install scripts**: Added `.npmrc` with `ignore-scripts=true` to mitigate supply-chain attacks that ship malicious lifecycle scripts (reference: the `lightning` npm package compromise). Husky hooks must now be installed explicitly via `npm run prepare` after a fresh clone; CI installs Playwright browsers explicitly via `npx playwright install --with-deps`. (#865)
- **`golang.org/x/net` to v0.53.0**: Go module security advisory update. (#853)

### Chore

- **MCP authoring server hardening**: Closes five of eight issues in `docs/design/MCP-AGENT-UX-HARDENING.md` and lands three of four cross-cutting mechanisms (M1, M2, M3) for the TS MCP authoring server, including telemetry-validated routing fixes. (#869)
- **Requirements-manager refactor before auto-recovery**: Six-phase structural refactor of `src/requirements-manager/` to reduce debt before Phase 1 of auto-recovery. All consumer-facing behaviour preserved. (#809)
- **Split `interactive.styles.ts` into three files**: Pure mechanical split of the 2,237-line `src/styles/interactive.styles.ts` along its three pre-existing semantic layers; every consumer import continues to resolve unchanged via a thin barrel. (#879)
- **Remove dead CSS rules from `interactive.styles.ts`**: Strict dead-code removal of CSS classes that exist in `src/styles/interactive.styles.ts` but are not applied anywhere in the codebase. Zero functional effect. (#876)
- **Agent guidance audit + six new skills**: Fixes documentation drift accumulated across recent feature work and adds six new `.cursor/skills/` entries that automate manual workflows the team does today. (#863)
- **Standardise CLI examples under `pathfinder-cli@...`**: Documentation-only update so all `npx` examples invoke `pathfinder-cli` to avoid namesquatting. (#873)
- **`lint-staged` to v17** (#859)
- **`npm` to v11.14.0** (#860)
- **`actions/cache` to v5** (#814)
- **GitHub Actions pinned-digest updates**: `sigstore/cosign-installer` to v4 (#839), `docker/setup-buildx-action` to v4 (#838), `docker/login-action` to v4 (#837), and `docker/build-push-action` to v7 (#836).

## 2.10.0

> **⚠️ Terms and conditions updated (TERMS_VERSION 1.1.0)**
>
> The data-usage notice in plugin settings was revised to disclose a new behaviour introduced by online package recommendations (see below). When context-aware recommendations are **disabled**, an online browser may now fetch a public guide catalog from `interactive-learning.grafana.net`. These fetches are limited to public catalog and guide files and don't include user identifiers, dashboard data, or any other contextual information beyond standard HTTP request metadata (IP address, User-Agent). Air-gapped installs and browsers reporting offline status make no such fetches. The terms text in `src/components/AppConfig/terms-content.ts` is now the single source of truth and is mirrored to `docs/sources/terms-and-conditions/_index.md` via `npm run docs:sync-terms`. Existing users will be re-prompted to review and accept the updated terms (#802).

### Added

- **Online package recommendations for OSS recommender-disabled mode**: When the online recommender is off (OSS default) and the browser is online, Pathfinder now surfaces packages from the public CDN catalog alongside bundled guides (#802)
  - New Go backend endpoint proxies the public package index and inlines per-package manifests (bounded concurrency, per-fetch timeouts, single-flight cache refresh)
  - Frontend filters with the existing low-weight URL + platform matchers; entries with unsupported predicates fail closed
  - Auto-disabled when the recommender is enabled, when `navigator.onLine === false`, and sticky-disabled for the page session after the first failed fetch so air-gapped installs never re-probe
  - New `OnlineCdnPackageResolver` registered as the third tier of the composite resolver so milestone / recommends / suggests IDs from CDN learning paths resolve correctly
- **Popout step type and editor popout mode**: New interactive step type and corresponding editor mode that pops the editor out into its own surface (#791)

### Changed

- **Terms and conditions disclosure**: Reworded the "Your control" section of the in-app data-usage notice to accurately disclose the new public CDN catalog fetch and bumped `TERMS_VERSION` to `1.1.0` so existing users re-acknowledge (#802)
- **Public terms and conditions docs page**: Published `docs/sources/terms-and-conditions/_index.md` generated from `terms-content.ts` via `scripts/sync-terms-and-conditions.js`. `npm run docs:sync-terms` regenerates the page and `npm run docs:sync-terms:check` (wired into `npm run check`) prevents the in-app and docs copy from drifting (#802)
- **New starter docs**: Comprehensive refresh of the new-starter onboarding documentation (#794)

### Fixed

- **Nested nav reveal for guided steps**: Guided steps now correctly reveal nested navigation when targeting deeply-nested menu items (#796)
- **My Learning "Continue" for URL-based paths**: Clicking "Continue" on URL-based learning paths now opens the next module instead of re-opening the current one (#744, #798)
- **Double skip buttons in guided blocks**: Await React flush before guided execution to prevent a second skip button from briefly appearing
- **Off-axis section header spinner**: Removed the off-axis spinner that could appear in section headers
- **Sidebar tabs lost after toggle**: Restore sidebar tabs after toggling the sidebar off and back on (#790)
- **Plural resolution copy**: Pluralize item count copy and use a static default for plural resolution to avoid empty strings during initial render

### Chore

- Partial Grafana 13 baseline plus multi-version e2e fix (#797)
- CI: parallelised backend tests and removed build job overhead
- Pinned dependencies (#761)
- Updated `grafana-plugin-sdk-go` to v0.291.1 (#801)
- Updated `golang.org/x/crypto` to v0.50.0 (#784)
- Updated `grafana/plugin-ci-workflows/ci-cd-workflows` action to v7.1.0 (#785)
- Updated `actions/setup-node` digest to 48b55a0 (#777)
- Updated npm to v11.13.0 (#787)
- Updated `prettier` to v3.8.3

## 2.9.2

### Changed

- **Feature-flag analytics scope**: `pathfinder_feature_flag_evaluated` now fires only on experiment exposures rather than every flag read, reducing analytics noise (#771)

## 2.9.1

### Added

- **Grot guide block type**: New `grot-guide` block type for use in the block editor (#766)

### Changed

- **Selector generator pipeline**: Redesigned the selector generator as a candidate-rank pipeline for more deterministic and explainable selector output (#768)

### Fixed

- **Horizontal overflow oscillation**: Switched overlay elements to `position: fixed` to prevent horizontal overflow oscillation on certain pages (#769)

### Chore

- Added the real `include` for `AGENTS.md` (#765)

## 2.9.0

### Added

- **Floating panel mode**: Pop guides out of the sidebar into a free-floating, resizable panel that can be repositioned anywhere on screen (#764)

## 2.8.0

### Added

- **Block editor available without dev mode**: Moved the block editor out of dev tools into a dedicated editor tab, making it accessible to all users without enabling dev mode (#758)
- **Kiosk session ID tracking**: Added session ID tracking for kiosk mode analytics (#760)

### Fixed

- **Combobox formfill**: Open combobox dropdown before formfill token entry to fix interactive step completion (#756)

### Chore

- Updated dependency sass to v1.99.0 (#735)
- Updated dev-tools (#748)
- Updated actions/upload-artifact digest to 043fb46 (#754)
- Updated magefile/mage-action digest to 07f03e2 (#736)

## 2.7.2

### Added

- **Lazy-load recommendation data**: Recommendation data is now lazily loaded and milestone UI polished for improved performance and visual consistency (#749)

### Security

- Updated `go.opentelemetry.io/otel/sdk` to v1.43.0 (#747)

### Chore

- Phase 8 cleanup: removed dead code and added package pipeline regression tests (#740)

## 2.7.1

### Fixed

- **Package milestone rendering**: Fixed resolution and rendering of milestones for path-type packages (#743)

## 2.7.0

### Added

- **Package engine integration**: Full package engine pipeline with composite resolver, package-aware content fetching, milestone resolution, and integration verification tests (#697)
  - Package completion tracking and navigation links wired into the context panel (#741)
  - Package pill icon distinguishes package-backed recommendations from plain interactive guides (#742)

### Fixed

- **Recommender URL auto-selection**: Automatically select the correct recommender API URL based on the Grafana instance hostname (#737)
- **E2E "What's new" modal**: Dismiss the "What's new in Grafana" modal in E2E tests to prevent test flakiness (#738)

## 2.6.0

### Added

- **Open guide after navigate step**: Navigate steps can now open a guide in the sidebar after SPA navigation completes (#732)
  - New `openGuide` field in block editor for navigate actions (e.g., `bundled:my-guide`)
  - Backward compatible: auto-detects `doc=` param in navigation URLs and dispatches guide opening
  - Uses `auto-launch-tutorial` event pattern with dynamic `findDocPage()` import
- **Kiosk mode available without dev mode**: Kiosk mode now only requires the `enableKioskMode` toggle in plugin settings (#733)

### Fixed

- **Selector picker scoping**: Constrain element picker to the hovered element's domain (#728)
  - Added proximity check to `findNearbyFormControl` — only returns form controls within 100px of clicked element
  - Thread `hoveredElement` from inspector through recorder to selector generator with fallback validation
- **Enhanced selector nested queries**: Use `querySelectorAllEnhanced` for nested queries after `:nth-match()` and in `resolveTrailingSelector` (#730)
  - Fixes `SyntaxError` when `:text()` or `:contains()` appear after `:nth-match()` or chained after `:contains()`
  - Monotonic counter for trailing selector markers prevents collision on recursive re-entry
- **Redundant button selector generation**: Avoid duplicate text matching when parent selector already contains the same `:contains()` or `:text()` clause (#731)
- **Plugin settings data loss on Cloud deployment**: Preserve all plugin settings when saving from any config tab (#734)
  - All config forms now spread `getConfigWithDefaults(jsonData || {})` instead of raw `jsonData`
  - Dev mode toggle now fetches current settings before saving instead of wiping all other fields
  - Fixes kiosk mode and coda settings being cleared after plugin version updates
- **Clear filter pills with @@CLEAR@@**: `@@CLEAR@@` on combobox inputs now removes existing filter pills before filling new values (#727)

## 2.5.2

### Fixed

- **Guided step zombie cleanup**: Eliminate orphaned timers, event listeners, and highlights after guided step cancellation (#725)
  - Capture and clear 120s timeout promises that fired with stale closures after cancel
  - Store comment box button listeners (Close, Cancel, Skip) in cleanup handlers
  - Remove redundant NavigationManager instances in InteractiveGuided unmount
  - Track success animation timeout for proper cancellation
- **?doc= deep link improvements** (#724)
  - Derive readable tab titles from URL path instead of showing "content.json"
  - Intercept interactive-learning links inside content and open as sidebar tabs
  - Use `interactive` type for interactive-learning URLs (not `docs-page`)
  - Route interactive guides to `openDocsPage` (with reset button) instead of `openLearningJourney`
  - Always show reset button for interactive guide tabs regardless of progress state
  - Don't redirect away from current page on `?doc=` — stay on the user's dashboard
  - Strip stale doc/page/source params from URL when doc can't be parsed
  - Support `?source=learning-hub` to explicitly open as learning journey
- **Assistant text selection UX**: Change button text to "Ask Assistant", orange text highlight, no-fill purple box, 400ms debounce (#722)
- **Tooltip readability**: High-contrast text in tooltip popouts — white in dark mode, near-black in light mode

## 2.5.0

### Added

- **Selector resilience engine**: Retry-with-wait, prefix matching, domain selectors, and strategy escalation pipeline for more robust interactive tutorials (#716)
  - `resolveWithRetry()` with exponential backoff (200/600/1800ms) replaces single-pass resolution in all action handlers
  - `:text()` exact match for short button labels (< 20 chars) eliminates false positives
  - `data-testid` prefix matching fallback when exact match fails (uniqueness-guarded)
  - `panel:` domain selector prefix resolves Grafana panels by title
  - Unified `resolveSelectorPipeline()` with confidence scoring
- **Selector Health Badge**: Inline quality indicator (green/yellow/red dot, stability score, method, match count) in the block editor form
- **Test Selector Button**: Evaluates selector against live DOM and flash-highlights matched elements with numbered overlays
- **Shift+Click hover capture**: Hold Shift during recording to capture hover steps without clicking through — prevents accidental navigation
- **Alt+Click form capture**: Hold Alt during recording to force-capture any element as a form fill — element is focused for typing, step recorded on blur with typed value
- **On-demand alternative selectors**: "Show alternatives" in block editor computes alternative selectors on-the-fly with stability scores and "Use this" swap buttons
- **Auto-populate requirements**: Recorded steps auto-populate `exists-reftarget` and `navmenu-open` requirements

## 2.4.2

### Added

- **Kiosk mode**: Full-screen overlay presenting interactive guide tiles over Grafana, gated behind dev mode and configured in the Interactive Features tab (#712)
  - Fetches rules JSON from a configurable CDN URL with bundled fallback defaults
  - HTML banner block at the top of the overlay for custom branding (sanitized via DOMPurify)
  - Each tile opens the guide in a new tab via `?doc=` deep link with per-rule target URL
  - Kiosk button in the sidebar header; overlay closes only via close button or Escape key
  - Default banner themed for GrafanaCON 2026 with official stacked logo
- **Comprehensive test ID audit**: Added ~100 new centralized `data-testid` selectors across all component areas and centralized ~20 hardcoded test ID strings into `testIds` constants (#711)
  - New test ID namespaces: `editorPanel`, `learningPaths`, `liveSession`, `prTester`, `urlTester`, `codaTerminal`, `homePage`, `controlGroupPopup`, `feedbackButton`, `helpFooter`, `app`, `enableRecommender`, `kioskMode`

### Fixed

- **Sidebar dock toggle**: Prevent dock button from undocking an already-docked sidebar (#710)

## 2.4.1

### Added

- **Custom guide deep links**: Support `?doc=api:<resourceName>` deep links for custom guides stored as App Platform CRDs (#696, #701)

### Security

- **Navigate handler path validation**: Internal navigation paths are now validated against denied routes (`/logout`, `/profile/password`, `/admin/*`, `/api/*`), closing a carry-forward from ASE25039 that becomes higher-impact under default enablement in Grafana 13 (#702)
  - Role-aware validation: admin users can navigate to admin-only paths since guides legitimately steer admins there and Grafana RBAC enforces server-side access control

## 2.4.0

### Added

- **Alloy scenario VM support**: New `alloy-scenario` VM template for Coda terminal, enabling guide authors to deploy Alloy-based sandbox environments (#688)
  - Animated progress bar during VM provisioning with SSH connection status
  - Quota cleanup with polling to auto-destroy stale VMs before creating new ones
  - Persistent VM options in sessionStorage for auto-reconnect across page refresh
- **Package recommender groundwork** (dormant): Frontend infrastructure for the v1 recommender API including response types, allowlist-based sanitizer, deduplication, and composite package resolver — production endpoint unchanged (#693)

### Changed

- **Agent context centralisation**: Concern-routed PR review and centralised agent context for improved review routing and impact analysis (#699)
- **Documentation maintenance**: Updated Coda, workshop, CLI tools, and interactive requirements docs; indexed `CUSTOM_GUIDES.md` (#690, #691, #692)

### Fixed

- **Coda terminal UX**: Fixed VM replacement messages, error/disconnect retry loop, terminal panel not opening from guide connect blocks, connect button state during provisioning, and disconnect as a proper kill switch (#688)

### Chore

- Deduplicated `useSampleApps`/`useAlloyScenarios` into generic `useCodaOptions` hook (#688)

## 2.3.7

### Fixed

- **Section requirement**: Fixed issue with section requirement checking not evaluating correctly
- **Workshop PeerJS config**: Read PeerJS config from Grafana runtime instead of `PluginPropsContext`, which was always null when rendered via `plugin.addComponent()` outside the provider tree (#687)
  - Made PeerJS TLS toggle explicitly configurable

## 2.3.6

### Added

- **`pathfinder.enabled` feature flag**: Global kill-switch for cloud-wide rollout control, separate from A/B experiments. When disabled, the plugin dismounts and the native Grafana help menu takes over (#685)
- **Workshop ECDSA presenter authentication**: Challenge-response authentication using ECDSA P-256 key pairs to prevent peer ID impersonation on the PeerJS signalling layer (#680)
  - Public key embedded in join code; private key never leaves the presenter's browser
  - Removed legacy unauthenticated join path entirely
  - Follow mode gated behind feature flag pending security review
- **CLI manifest pre-flight checks**: New `--package` and `--tier` flags for the e2e command with tier check, minVersion check, and plugin checks before spawning Playwright (#681)

### Security

- Updated `google.golang.org/grpc` to v1.79.3 (#683)

### Chore

- Updated npm to v11.11.1 (#675)
- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v6.1.1 (#676)
- Updated magefile/mage-action digest to 96c659d (#684)

## 2.3.5

### Fixed

- **Pathfinder-suggest event buffering**: Early `pathfinder-suggest` events from faster-loading apps were lost because the handler was only registered after async experiment init. Added a synchronous buffer that replays events once the real handler is ready (#679)
- **Auto-opened flag deferral**: Deferred the auto-opened localStorage flag write until the sidebar actually mounts, so the flag is never burned if the sidebar fails to open (#679)

## 2.3.4

_Patch release — version bump only._

## 2.3.3

### Added

- **VM template selection**: Guide authors can now specify a custom VM template and sample app name when provisioning sandbox VMs through the `terminal-connect` block (#672)
  - Backend: new sample-apps endpoint, `CreateVM` accepts config map, `resolveVMForUser` respects template/app when reusing or replacing VMs
  - Frontend: `TerminalConnectBlock` form with VM template selector and dynamic sample-app dropdown
  - Block palette hides Coda block types when Coda terminal is disabled

## 2.3.2

_Patch release — version bump only._

## 2.3.1

### Fixed

- **Coda VM lifecycle**: Fixed VM lifecycle issues in the Coda terminal integration (#667)

### Chore

- Updated actions/upload-artifact action to v7 (#660)
- Updated grafana/plugin-actions digest to 4698961 (#661)

## 2.3.0

### Added

- **Terminal connect block type**: New `terminal-connect` block type for interactive guides, enabling embedded terminal session setup within tutorials (#666)
  - Block editor support with terminal connect form
  - Guided handler support for terminal connect actions
  - Global interaction blocker integration for terminal steps
- **Block editor inline title editing**: Guide title is now editable inline in the header; guide ID is auto-derived from the title on first commit (slug + random suffix), locked after first set (#662)

### Changed

- **Block editor lifecycle redesign**: Replaced two-button publish flow with a single smart primary action button that follows the guide lifecycle: Save as draft → Update draft → Publish → Update. Context-sensitive menu for Publish shortcut, Unpublish, New guide, and Import (#662)
- **Terminal panel improvements**: Enhanced Coda terminal panel with improved storage and connection handling (#666)

### Fixed

- **Title rendering**: Docs pages now render only one title extracted from the content's first heading; learning path milestones with content JSON use the title from the JSON itself (#663)
- **Request timeouts**: Each content fetch request now uses its own timeout instead of sharing a single timeout across multiple requests, fixing intermittent "signal timed out" errors (#664)
- **Relative URL resolution**: Relative URLs in unstyled.html learning path content (e.g., `/sign-up/`) now resolve against `https://grafana.com` instead of the Grafana instance origin (#665)
- **Block editor race condition**: Fixed backend link lost after page refresh due to undefined sentinel value (#662)
- **Block editor stale closures**: Fixed stale closure bugs causing incorrect toast messages and breaking change detection after unpublish (#662)
- **Empty guide loading**: Fixed empty guide failing to load from library; blocked saving guides with no blocks (#662)

## 2.2.2

### Added

- **Control group popup**: Added a popup notification for users in the control group who cannot access Pathfinder

### Fixed

- **Image rendering**: Fixed image rendering in docs and markdown image parsing in the JSON parser
- **Feature flag protection**: Added safeguards around new feature flag evaluation in experiment utilities

### Changed

- **Reduced module size**: Further optimizations to plugin bundle size

## 2.2.1

### Added

- **Draft/publish lifecycle**: Introduced draft and publish workflow for library guides in the block editor, allowing content creators to iterate on guides before making them available (#657)

### Fixed

- **Guided popup themes**: Guided popup now correctly respects light/dark mode settings (#656)

### Changed

- **Reduced module size**: Optimized plugin bundle size for improved initial load performance (#659)

### Chore

- Updated grafana/plugin-actions digest to b82357e (#658)

## 2.2.0

### Added

- **Code block type**: New `code-block` block type for interactive guides with syntax highlighting, copy-to-clipboard, and step completion tracking (#650)
  - Block editor support with language selector, filename, and code content fields
  - Action handler for code block interactions in the interactive engine
- **Auto-collapse section toggle**: Added `autoCollapse` option for interactive sections, configurable in both the block editor and app config (#649)

### Fixed

- **Quiz reset**: Fixed quiz block not resetting answers properly when restarting a guide (#649)
- **Admin access**: Fixed interactive features configuration page not loading correctly for admin users (#649)

### Security

- **DOMPurify v3.3.2**: Updated DOMPurify to v3.3.2 to address CVE-2026-0540; iframes with `data:` URLs are now fully removed instead of sandboxed (#651)

## 2.1.1

### Fixed

- MCP `tools/call` responses now correctly wrap results in the `content` array as required by the MCP 2025-03-26 spec, fixing compatibility with Grafana Assistant

## 2.1.0

### Added

- **MCP server**: HTTP Model Context Protocol server at `/api/plugins/grafana-pathfinder-app/resources/mcp`, enabling AI assistants (e.g. Grafana Assistant) to discover and launch Pathfinder guides
  - `list_guides` — returns the bundled guide catalog with id, title, description, category, and type
  - `get_guide` — returns the full content JSON for a specific guide by ID
  - `get_guide_schema` — returns JSON Schema for guide content, manifest, and repository formats
  - `launch_guide` — queues a guide launch for the current user; Pathfinder opens it automatically within 5 seconds if the sidebar is active
  - `validate_guide_json` — validates a guide content.json string and returns structured errors and warnings
  - `create_guide_template` — generates a valid guide skeleton (content.json + manifest.json) ready for editing
- **Frontend polling hook** (`usePendingGuideLaunch`): polls the backend every 5 seconds and opens the Pathfinder sidebar to the requested guide when a pending launch is found
- **`openWithGuide` method** on `GlobalSidebarState`: opens the sidebar and dispatches the guide, handling the case where the sidebar is not yet mounted

## 2.0.7

### Changed

- **Experiment refactor**: Extracted experiment logic into dedicated `experiments/` module with separate orchestrator, utilities, and debug tooling; simplified `module.tsx` by removing inline experiment wiring
- **OpenFeature integration**: Added OpenFeature client wrapper for standardized feature flag evaluation
- **Analytics**: Added RudderStack event support and new suggestion state tracking via `global-state/suggestion.ts`

## 2.0.6

### Fixed

- **Terminal streaming**: Fixed terminal streaming issue in the Coda terminal live hook
- **Publish**: Fixed publish issue with terminal live hook import

## 2.0.5

### Fixed

- **Terminal streaming**: Simplified streaming implementation across backend (`stream.go`, `resources.go`) and frontend (`useTerminalLive` hook), removing redundant code paths

## 2.0.4

### Fixed

- **Session key simplification**: Removed `userLogin` from `sessionsByVM` key, using `vmID` alone. Eliminates identity-mismatch bugs across SDK paths and the reconnect race condition where an old RunStream's teardown could delete a newer session's registration
- **Reconnect race condition**: Fixed race where overlapping RunStream teardown for the same VM could delete the active session from the secondary index, causing 410 errors in Grafana Cloud

## 2.0.3

### Security

- **Terminal input auth**: Removed client-controlled user identity from terminal input; user is now derived exclusively from the SDK's `PluginContext` to prevent session impersonation

### Fixed

- **Session lookup**: Fixed 410 (Gone) errors on every terminal input/resize caused by user identity mismatch between `RunStream` (SDK PluginContext) and `handleTerminalInput` (missing HTTP header)
- **Instance lifecycle**: Moved `streamSessions` and `userVMs` from package-level globals into `App` struct fields so they are properly scoped to plugin instance lifecycle and cleaned on `Dispose()`
- **SSH retry logic**: Auth errors (wrong key, permission denied) no longer waste same-VM retry budget; they break immediately to provision a new VM
- **Context-aware retries**: Replaced `time.Sleep` in SSH retry loops with `select`/`time.After` so context cancellation is respected immediately
- **WebSocket write deadline**: Added 30s write deadline on WebSocket writes to prevent indefinite blocking when the relay stops reading
- **Reconnect timer leak**: Stored reconnect `setTimeout` ID in a ref and clear it on unmount to prevent post-unmount state updates
- **PEM validation**: `normalizePrivateKey` now validates the result with `pem.Decode` and returns an error for malformed keys instead of passing them silently to `ssh.ParsePrivateKey`
- **First poll delay**: `waitForVMActive` now polls immediately before entering the 3-second ticker loop, avoiding unnecessary delay for already-active VMs

### Improved

- **Session lookup performance**: Added secondary `sessionsByVM` index for O(1) terminal input routing instead of O(n) scan under mutex
- **Output throughput**: Added output coalescing goroutine that batches SSH output within a 5ms window (up to 32KB) before sending, reducing per-message gRPC overhead
- **Buffer sizes**: Increased SSH read buffers from 4KB to 32KB and PTY baud rates from 14400 to 38400
- **Console log gating**: Terminal connection logs gated behind dev mode per Grafana best practices; `connectionLog` converted to a per-connection factory to eliminate shared mutable state
- **Error logging**: `sendStreamError` and `sendStreamStatusWithVmId` now log marshal and send errors instead of silently discarding them
- **PublishStream comment**: Corrected misleading comment to clarify it is implemented for SDK compliance but never invoked

## 2.0.2

### Fixed

- **Terminal connection**: Fixed an issue with connection timeout

## 2.0.1

### Fixed

- **Terminal reconnection**: Fixed issues with reconnection and timeouts to VMs (#639)

## 2.0.0

### Added

- **Custom guides** (private preview, Grafana Cloud only): Users can create, publish, and manage their own guides with full backend support (#614)
  - New "Custom guides" section in the context panel shows user-published guides
  - Guide library modal for browsing and loading saved guides
  - Publish workflow for sharing guides within an organization
  - Backend API for guide storage and retrieval
- **Go backend**: Added plugin backend using `grafana-plugin-sdk-go` for streaming, resource handling, and API endpoints (#591)
- **Terminal block type** (experimental): New block type for embedding terminal sessions within guides, requires backend configuration (#591)
- **Guide health telemetry design**: Added design document for guide health monitoring and telemetry (#628)
- **Package model Phase 0-1**: Initial implementation of the guide packaging model (#623)
- **Maintain-docs skill**: New AI skill for periodic documentation audits and maintenance (#602)

### Changed

- **Architectural tier model**: Major refactoring to enforce clear architectural boundaries (#607, #608, #609, #613)
  - Added directory-scoped ESLint import boundary rules encoding the tier model
  - Added architectural invariant ratchet tests to prevent regressions
  - Eliminated all barrel bypass violations
  - Moved components to correct architectural tiers
- **Stricter TypeScript**: Enabled `noUncheckedIndexedAccess` for stricter null safety on indexed access (#606)
- **ESLint security rules**: Added `no-restricted-syntax` ESLint rules for security and architecture enforcement (#611)
- **Block editor UX improvements**: Fixed keyboard navigation, modal footer alignment, and responsive header behavior (#617)
- **Block editor availability detection**: Library and Publish controls now hide when backend API is unavailable (#631)
- **Documentation refresh**: Comprehensive documentation updates across all engine subsystems, indexed orphaned docs, and validated stale documentation (#592-#602, #625)

### Fixed

- Fixed deprecated API usage issues

### Chore

- Updated npm to v11.10.1 (#605)
- Security audit (#590)

## 1.8.0

### Added

- **Home page**: New dedicated home page (`/a/grafana-pathfinder-app`) serving as a centralized learning hub with learning paths, badges, and progress tracking. Accessible via a "My learning" button in the sidebar, with automatic redirect when the recommender is empty (#579)
- **User profile bar**: Replaced the "Recommended learning" header in the context panel with a compact profile bar showing badge progress, guide count, streak info, and a CTA to open the next recommended guide (#585)
- **12 new path-completion badges**: New badges with whimsical names and emoji icons, earned badges appear first in the grid sorted by most recent, with legacy badge indicators for badges earned in previous versions (#579)
- **Deep link page redirect**: Added `page` query parameter to deep links so that after the sidebar launches a guide, the center console navigates to a relevant Grafana page (e.g., `?doc=bundled:first-dashboard&page=/explore`) (#574)

### Changed

- **Renamed "learning journey" to "learning path"**: Updated all UI references from "learning journey" to "learning path" for consistency (#586)
- **Template variable passthrough**: Grafana template variables (`${variable}`) are now preserved and rendered in markdown content instead of being stripped by sanitization (#573)
- **Content fetching improvements**: Now renders `content.json` first if available for all docs, with `null` value handling to avoid fetch errors (#569, #571)

### Fixed

- **Learning path progress**: Fixed completion percentage display and added "Restart" button for completed learning paths with confirmation UI. Improved handling for URL-based paths and milestone auto-completion (#587)
- **Reset progress**: The "Reset progress" button now clears per-guide interactive step completion data, preventing guides from instantly re-completing when reopened (#585)
- **User storage performance**: Introduced envelope-based storage format replacing separate timestamp companion keys, with automatic migration of old-format data. Improves reliability and performance of cross-device syncing (#570)

### Chore

- Updated npm to v11.10.0 (#577)

## 1.7.1

### Fixed

- **Context panel progress stuck at 0%**: Fixed completion percentage display for learning journeys and interactive guides on the context/recommendations panel. Learning journeys now correctly read from `journeyCompletionStorage` (async), and interactive guides now correctly read from `interactiveCompletionStorage` instead of the wrong storage type.

## 1.7.0

### Breaking changes

- **Learning journeys**: The plugin must be updated to this version for all learning journeys to render correctly again due to the migration from unstyled HTML to JSON.

## 1.6.0

### Added

- **Interactive learning journeys**: Learning journeys now support interactive content, allowing guided, hands-on steps within structured learning paths. Expect more learning journeys to become interactive over time.

## 1.5.2

### Fixed

- **Empty `response.url` in content fetcher**: Fixed "Redirect target is not in trusted domain list" errors on Grafana Cloud environments where platform-level fetch interception produces synthetic responses with empty `response.url`; now falls back to the validated original URL (#564)
- **GitHub CDN redirect allowlist**: Expanded `isGitHubRawUrl()` to accept `objects.githubusercontent.com` URLs that GitHub redirects to for blob storage, fixing PR Tester failures in dev mode (#562)

### Changed

- **PR Tester file limit**: Increased maximum content files from 5 to 100 to match GitHub API's default page size, preventing silent truncation of large PRs (#565)
- **PR Tester pagination warning**: Added user-facing warning when a PR may contain more content files than the API returns in a single page (#567)

## 1.5.1

### Fixed

- **Dev-mode selector generation**: Fixed `findNearbyFormControl()` incorrectly selecting unrelated form controls when clicking elements inside buttons or links; added structural scoping for `data-testid` selectors to improve stability (#557)

### Changed

- **Developer documentation refresh**: Updated developer docs to align with current implementation, including feature flag documentation, interactive types, requirements reference, and selector guidance; removed obsolete HTML-era docs (#560)

## 1.5.0

### Removed

- **Legacy interactive HTML parsing**: Removed ~800 lines of HTML-based interactive parsing from `html-parser.ts` (#550). Interactive guides are now exclusively produced via the JSON parser path. General HTML parsing (headings, code blocks, images, tables, etc.) remains intact. Golden-path regression tests added.

### Changed

- **Docs panel modularization**: Phased refactor extracting hooks and utilities from `docs-panel.tsx` for better maintainability (#545)
  - Extracted `useTabOverflow`, `useScrollPositionPreservation`, and `useContentReset` hooks
  - Extracted `url-validation`, `tab-storage-restore` utilities and `DocsPanelModelOperations` interface
  - Added 28+ new unit tests across extracted modules
- **Design documentation**: Flattened package metadata, added AND/OR dependency syntax, deferred fields, and renamed `package.json` → `manifest.json` in design docs (#556)
- **Agent context optimization**: Reduced always-injected agent context by ~460 lines (#555)
- **Tiered PR review rules**: Reorganized PR review into compact orchestrator with unified detection table (#554)
- **Design docs refresh**: Updated reference URLs and removed outdated content (#553)

### Fixed

- **Single steps vs section steps**: Fixed issues with single interactive steps not behaving correctly relative to section steps, including user storage fixes (#549)

### Chore

- Updated npm to v11.9.0 (security) (#548)

## 1.4.13

### Added

- **E2E testing contract**: Added `data-test-*` attributes for step state, action type, and substep progress to enable stable E2E testing of interactive and guided blocks (#540)
- **E2E CLI guided block support**: Expanded E2E CLI runner with guided block discovery tests, timeout calculations, and `data-reftarget` attributes (#544)
- **E2E guide test runner documentation**: Added developer documentation for the CLI-based E2E test runner (#533)
- **Default requirements suggester**: Block editor now auto-suggests default requirements when creating interactive steps (#537)

### Fixed

- **Datasource type matching**: `has-datasource` checks now match plugin types with `grafana-` prefix and `-datasource` suffix (e.g., `has-datasource:testdata` matches `grafana-testdata-datasource`), fixing section auto-completion in the cloud first-dashboard tutorial
- **Collapsed options group expansion**: Interactive steps targeting elements inside collapsed Grafana panel editor options groups now detect the collapsed state and offer a "Fix this" action to expand them

### Changed

- **Improved validation error messages**: Better error messages for nested union fields in guide validation with custom error map (#542)
- **StorageKeys refactor**: Extracted storage keys into a standalone module to remove browser dependency, improving testability (#538)
- **Comprehensive documentation refresh**: Major rewrite of developer documentation with strategic context, integration maps, security context, and developer workflows (#543)
- **Lint deprecation cleanup**: Resolved lint warnings by updating deprecated APIs across 30 files (#547)

### Chore

- Updated dependency webpack to v5.104.1 (security) (#541)
- Updated dependency sass-loader to v16.0.7 (#546)
- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v6.1.0 (#539)
- Updated grafana/plugin-actions digest to 09d9424 (#536)
- Updated packages and added jest-dom type declarations
- Updated agent configuration to use `test:ci` script (#535)

## 1.4.11

### Fixed

- Fixed infinite loop in interactive step completion that caused steps to remain locked after previous step was completed

## 1.4.10

### Fixed

- Issue with learning journeys showing duplicate headers for index pages

## 1.4.9

### Changed

- Updated bundled guide to reflect changes in the Grafana UI

## 1.4.8

### Added

- **JSON editor mode**: New JSON editing mode in block editor with full undo/redo support and line-numbered validation errors (#521)
  - Switch between visual block editor and raw JSON editing
  - Validation errors show exact line numbers for quick debugging
  - Maintains roundtrip fidelity when switching between modes
- **Step state machine tests**: Added comprehensive unit tests for step state machine and check phases (#526)
- **PR review guidelines**: Added documentation for PR review workflow in dev tools (#522)

### Changed

- **Conditional block improvements**: Quality of life improvements for editing conditional blocks (#530)
  - New branch blocks editor for nested conditional content
  - Collapsible UI sections for better organization
  - Improved branch titles and visual hierarchy
- **Block editor snap scrolling**: Improved scroll behavior in block editor for smoother navigation
- **Docs panel refactoring**: Extracted components and utilities from docs-panel for better maintainability (#508)
- **My learning refactoring**: Extracted utilities and styles from my-learning tab for maintainability (#507)
- **Block editor refactoring**: Major code organization improvements to block editor (#504)
- **CI optimization**: Parallelized quality checks for faster E2E feedback (#505)
- **PR review workflow**: Improved PR review workflow in dev tools (#520)

### Fixed

- Fixed form validation errors in block builder
- Fixed objectives recalculation in step state machine (#501)
- Fixed parent section notification when step objectives are satisfied (#525)

### Removed

- Removed unused `showTarget` property from interactive schema (#506)

### Chore

- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v6.0.0 (#519)
- Updated GitHub artifact actions (#517)
- Updated actions/checkout to v4.3.1 (#435)
- Updated dependencies: npm v11.8.0, @openfeature/react-sdk v1, commander v14, sass v1.97.3, glob v13

## 1.4.7

### Added

- **Section analytics completion tracking**: Move DoSectionButtonClick analytics to fire after section execution completes (success or cancel), with accurate step position tracking and a canceled boolean. (Grafana Cloud)

## 1.4.6

### Added

- **Datasource input block type**: New block type for collecting datasource selections within interactive guides (#499)
- **Terminal mock UI**: Added terminal mock interface for Coda integration (dev mode only) (#498)

### Changed

- **Improved element highlighting**: Highlights meaningful parent elements for better visibility during interactive steps (#497)
- **Disabled auto-grouping**: Stopped automatic grouping in multistep and record mode to give content creators more control (#502)

### Fixed

- Fixed drag and drop issues in dev mode block editor (#500)
- Fixed screen highlighting for hidden or responsive elements that weren't visible on screen (#496)

## 1.4.5

### Added

- **Renderer requirement**: New `renderer` requirement type for conditional rendering based on presentation context (in-Grafana vs website) (#493)
- **PR review tool**: New dev tools feature to review PRs from interactive-tutorials repository, allowing quick testing of content.json files (#494)
- **Collapsible sections**: Section and conditional blocks in the block editor now support collapse/expand with smooth animations (#488)
- **Block type switching**: Users can now convert blocks between types (e.g., markdown → interactive) while preserving compatible data (#486)

### Changed

- **Recommendation sorting**: Recommendations are now sorted by content type priority (interactive > learning-journey > docs-page), then by match accuracy within each type
- **Drag and drop improvements**: Migrated block editor drag-and-drop from custom HTML5 implementation to @dnd-kit library for improved reliability and cross-section moves (#495)
- **Datasource API migration**: Switched requirements checker to use datasource UIDs instead of numeric IDs for compatibility with recent Grafana APIs (#487)

### Fixed

- Fixed scroll tracking issues

## 1.4.4

### Added

- **Enhanced block selection**: Block selection logic now includes multistep and guided blocks with improved merging consistency (#485)

### Changed

- **DOM selector logic**: Updated DOM selector logic in dev tools for improved element targeting (#482)

### Fixed

- Fixed defocus behavior in form-fill handler to prevent modal closure during multi-step actions (#484)
  - Dispatches non-bubbling Escape events to avoid closing parent modals
  - Relies on blur for dropdown closure instead

## 1.4.3

### Added

- **Video block timestamps**: Added `start` and `end` timestamp support for video blocks to play specific segments (#477)

### Fixed

- Fixed issues with "Go there" navigation action in interactive steps (#481)

## 1.4.2

### Changed

- **Simplified website export**: Removed separate copy for website button since block editor now uses the same JSON format (#478)

### Fixed

- Fixed issue with block editor record mode failing to initialize properly (#480)

### Chore

- Added GitHub issue templates for bugs and feature requests (#479)

## 1.4.1

### Added

- **Interactive content type support**: Added 'interactive' as a first-class content type alongside 'docs-page' and 'learning-journey' (#472)
  - Context panel now handles interactive recommendations with appropriate icons and button text
  - Improved type definitions and analytics tracking for interactive content
- **Interactive progress tracking**: Shows completion percentage for interactive guides in recommendation buttons (#474)
  - Added dropdown menu for feedback and settings in context panel
  - Improved state management for interactive progress with reset functionality
- **Category labels**: Added visual category labels and styles for recommendation types in the context panel (#475)

### Changed

- **Unified Markdown rendering**: Replaced custom Markdown parsers with `renderMarkdown` from `@grafana/data` using the Marked library (#473)
  - Configured Tiptap rich text editor to use Marked for consistent Markdown support
  - Simplified and standardized Markdown handling across the codebase
- **Improved recommendation UX**: Refactored recommendation button text and icons for better clarity (#475)
  - Added dropdown menu for feedback and settings in the docs panel

### Fixed

- Improved localization support for new UI elements across all supported languages (#474, #475)

## 1.4.0

### Added

- **Block editor tour**: New interactive tour for the block editor with improved guided UX (#467)
- **Inner list element support**: Added support for inner list elements in interactive steps (#461)
- **Noop shortcode export**: Noop actions now export as `{{< interactive/noop >}}` shortcode for website documentation (#464)
  - Made `reftarget` optional for noop actions in interactive, multistep, and guided blocks

### Changed

- **Centralized experiment auto-open state**: Replaced sessionStorage-based tracking with persistent Grafana user storage for auto-open states (#470)
  - Enhanced functions for marking and syncing auto-open states across sessions and devices
  - Updated sidebar state management to reflect new action types for analytics
  - Improved reset functionality to clear both session and user storage states
- **React 19 compatibility**: Fixed compatibility issues with React 19 (#468)

### Fixed

- Fixed various block editor UI/UX issues (#469)
- Added aria label to block form modal for accessibility (#469)
- Fixed bug with lazy scroll in React 19 (#468)
- Fixed block editor record mode persistence issues (#465)
- Fixed noop completion eligibility logic (#464)

## 1.3.7

### Fixed

- Fixed scroll highlight being cleared immediately after "Show me" action due to leftover scroll events (#463)
- Fixed lazy-loaded interactive steps not enabling buttons when element wasn't visible yet (#462)
- Fixed continuous requirement checking loop for lazy-render steps preventing button interaction (#462)

## 1.3.6

### Fixed

- Fixed issue with OpenFeature experiment tracking

### Chore

- Removed debug logging from analytics module

## 1.3.5

### Fixed

- Fixed sidebar not opening correctly on initial load
- Added analytics tracking for sidebar open/close events

## 1.3.4

### Added

- **Conditional block type**: New `conditional` block type for JSON guides that shows/hides content based on requirements (#450)
  - Supports conditional sections with requirement-based visibility
  - Block editor integration for creating and editing conditional blocks
- **Quiz block editor**: Full block editor support for creating quiz blocks with visual editing (#454)
- **Input block type**: New `input` block type for collecting user responses within guides (#454)
  - Stores responses in user storage for use in conditional logic
  - Integrates with requirements system for dynamic content

### Fixed

- Fixed scroll behavior and requirements checking issues discovered during testing (#459)
- Fixed requirements not rechecking properly in certain step sequences

### Chore

- Removed extraneous debug tooling and simplified selector debug panel (#458)
- Documentation updates to keep interactive system in sync (#456)

## 1.3.3

### Added

- **Import by paste**: Added ability to paste JSON directly into the block editor import modal (#453)

### Fixed

- Fixed external links in side journey and related journey sections now correctly open in a new browser tab instead of being blocked (#452)

### Chore

- Updated grafana/plugin-actions digest to b33da83 (#434)

## 1.3.1

### Fixed

- Fixed issue with OpenFeature experiment tracking (#444)

## 1.3.0

### Added

- **My Learning tab**: New gamified learning experience with structured learning paths and achievement badges (#443)
  - **Learning paths**: Curated sequences of guides that teach specific skills (e.g., "Getting started with Grafana", "Observability basics")
  - **Progress tracking**: Visual progress rings show completion percentage for each learning path
  - **Achievement badges**: Earn badges like "Grafana Fundamentals" and "Observability Pioneer" upon completing learning paths
  - **Streak tracking**: Daily learning streaks to encourage consistent engagement
  - **Badge unlocked toasts**: Celebratory notifications when you earn a new badge
  - **Badges display**: View all earned badges and progress toward locked ones
  - **Legacy support**: Existing guide completions are migrated to the new learning paths system
- **Experiment tools**: Added experiment management tools to dev tools panel (#442)
- **Formfill validation toggle**: Added `validateInput` option for formfill actions in guided blocks
  - When `validateInput: false` (default): Any non-empty input completes the step - ensures backward compatibility
  - When `validateInput: true`: Requires input to match `targetvalue` (supports regex patterns)
  - Block editor updated with checkbox to enable/disable strict validation

### Changed

- **Improved tab bar UX**: Enhanced tab navigation with better visual design and interaction patterns

### Fixed

- Fixed security issue with unsanitized HTML in guided handler comment display (defense-in-depth)

## 1.2.2

### Changed

- **Improved OpenFeature implementation**: Enhanced feature flag integration for better experiment control (#441)

## 1.2.1

### Added

- **Navigate action type**: Handle `navigate` action type in InteractiveStep for URL navigation within guides (#429)
- **Zod schema validation**: Runtime strict validation of interactive JSON guides with comprehensive schema checking (#417)
  - Validates all guide loads on the frontend
  - Added DOMPurify to markdown sanitization for security
  - Defined schema version 1.0.0 for bundled guides
  - CLI tool for validating guides
- **OpenFeature experiment**: Added OpenFeature experiment integration with RudderStack (#421)
- **Auto-detection**: Enabled auto-detection feature for interactive guides

### Changed

- **License update**: Updated license to AGPL-3.0 (#418)
- **Improved follow mode**: Enhanced follow mode functionality for live sessions (#425)
- **Interactive development experience**: Multiple improvements for content creators (#424)
  - Updated shortcode names with namespacing
  - Display steps as ordered list
  - Option to export combined steps as guided action instead of multistep
  - Persist recording mode state with option to return to start

### Fixed

- Fixed dashboard text styling to follow sentence case per Grafana Writers' Toolkit (#423)
- Fixed RudderStack type issues (#432)
- Fixed RudderStack and auto-detection initialization

### Chore

- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v4.3.0 (#415)
- Updated grafana/plugin-actions digest to 428421c (#400)
- Bump glob from 10.4.5 to 10.5.0 (#431)
- Automated loading of BigQuery tables for analytics (#419)
- Updated release workflow (#427)

## 1.1.85

### Added

- **Hugo shortcodes export**: Added option to export Hugo shortcodes from debug tools (#326)

### Changed

- **Block editor replaces WYSIWYG**: Replaced WYSIWYG editor with new block editor for improved content creation experience (#414)
- Improved UX of URL tester in dev tools (#392)

### Fixed

- Fixed infinite loop that blocked renders (#413)

### Chore

- Updated actions/checkout action to v6 (#407)
- Updated actions/setup-node digest to 395ad32 (#395)
- Updated dependency sass to v1.94.2 (#375)
- Updated dependency prettier to v3.7.4 (#377)
- Updated npm to v11.6.4 (#376)

## 1.1.84

### Added

- **Assistant wrapper blocks**: New `assistant` block type for JSON guides that wraps child blocks with AI-powered customization
  - Each child block gets its own "Customize" button that adapts content to the user's actual datasources
  - Supports wrapping `markdown`, `interactive`, `multistep`, and `guided` blocks
  - Customizations are persisted in localStorage per block
- **Unified datasource metadata tool**: New `fetch_datasource_metadata` tool for Grafana Assistant integration
  - Auto-detects datasource type (Prometheus, Loki, Tempo, Pyroscope)
  - Fetches labels, metrics, services, tags, and profile types from user's datasources
  - Enables AI to generate queries using actual data from user's environment
- **Grafana context tool**: New `get_grafana_context` tool providing environment information to the assistant

### Changed

- Updated datasource picker selectors in bundled tutorials for improved reliability
  - Uses `data-testid="data-source-card"` with `:has()` selector for robust element targeting
- Upgraded `@grafana/assistant` SDK to v0.1.7

## 1.1.83

> ⚠️ **BREAKING CHANGE: New content delivery infrastructure**
>
> Interactive guides are now served from a dedicated CDN (`interactive-learning.grafana.net`)
> instead of GitHub raw URLs. **You must update to this version or later to load interactive guides.**
>
> **What changed:**
>
> - Content is now delivered from `interactive-learning.grafana.net` (production) and `interactive-learning.grafana-dev.net` (development)
> - GitHub raw URLs (`raw.githubusercontent.com`) are only supported in dev mode for testing
> - The backend proxy route for GitHub content has been removed
>
> **For content creators:**
>
> - No changes required to your content - the CDN serves the same JSON format
> - Dev mode still supports GitHub raw URLs for testing before publishing

### Changed

- **BREAKING**: Migrated content delivery from GitHub raw URLs to dedicated interactive learning CDN
- Removed backend proxy route for GitHub content (no longer needed with direct CDN access)
- Updated security validation to use new `interactive-learning.grafana.net` domains
- Simplified URL tester in dev mode to accept all supported URL types in single input

### Added

- Added `interactive-learning.grafana-ops.net` to allowed domains

### Removed

- Removed `data-proxy.ts` and GitHub proxy configuration from `plugin.json`
- Removed `validateGitHubUrl` and related GitHub-specific URL validation functions

## 1.1.78 (2025-12-01)

### Changed

- Added improvements to interaction engine

### Fixed

- Fixed EnableRecommenderBanner not showing when recommendations are disabled (variable name bug)

## 1.1.77 (2025-12-01)

### Fixed

- Fixed regression in WYSIWYG editor caused by recent updates
- Improved requirements system

### Chore

- Updated actions/setup-go digest to 4dc6199
- Updated actions/checkout action to v5.0.1

## 1.1.76 (2025-12-01)

### Fixed

- Fixed issues with RudderStack analytics

## 1.1.75 (2025-12-01)

### Fixed

- fixed issue with bundled getting started guide step

## 1.1.74 (2025-12-01)

> ⚠️ **BREAKING CHANGE FOR CONTENT CREATORS**
>
> The content format for interactive guides has migrated from HTML/TypeScript to **JSON**.
> Existing HTML-based guides will continue to work but are deprecated.
> All new content should use the JSON format. See the migration guide at
> `docs/developer/interactive-examples/html-to-json-migration.md` and the format documentation
> at `docs/developer/interactive-examples/json-guide-format.md`.

### Added

- Added JSON-based interactive guide format with full migration of bundled interactives
- Added quiz block for interactive knowledge checks
- Added JSON export support in dev mode
- Added fullscreen mode for WYSIWYG editor
- Added bubble toolbar for WYSIWYG editor
- Added `verify` property for interactive step validation
- Added `completeEarly` support at interactive block level
- Added `noop` interactive action type
- Added auto-extract selector from step format in Simple Selector Tester

### Changed

- **BREAKING**: Content format migrated from HTML/TypeScript to JSON
- Moved dev tools to dedicated tab for better organization
- Updated interactive UI styling
- Improved edit experience in dev mode

### Fixed

- Fixed `showMe`/`doIt` property handling in interactive steps
- Fixed step sequencing issues
- Fixed URL generation strategy for both new `content.json` and legacy `unstyled.html`

### Chore

- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v4.1.0

## 1.1.73 (2025-11-25)

### Added

- Added assistant RudderStack analytics integration
- Added cancel button and cleanup for guided components

### Fixed

- Applied React anti-pattern validator fixes

## 1.1.72 (2025-11-25)

### Added

- Added support for bundled and GitHub links

### Changed

- Improved WYSIWYG editor based on RichiH feedback
- Refreshed documentation to align with current architecture

### Fixed

- Fixed issues with sections not rechecking requirements
- Fixed DOM selector logic in interactive engine
- Fixed formfill selectors to descend into input elements

## 1.1.71 (2025-11-21)

### Fixed

- Hotfix for requirements in guided step
- Fixed documentation issues

## 1.1.70 (2025-11-21)

### Added

- Added new inline assistant feature
- Added ability to open learning journeys and docs on load
- Implemented featured recommendations

### Changed

- WYSIWYG cosmetic improvements

## 1.1.69 (2025-11-19)

### Changed

- Changed requirements to be event driven rather than poll-based

## 1.1.68 (2025-11-18)

### Added

- Added highlight feature to dev tools
- Added skip button for steps in guided mode

### Changed

- Renamed "Pathfinder Tutorials" to "Pathfinder Guides" throughout
- Allows buttons to also use CSS selectors

### Fixed

- Fixed issue with auto loading
- Fixed multistep validation for reftargets in WYSIWYG editor

### Removed

- Removed old interactive code
- Removed dead requirements code

### Chore

- Updated grafana/plugin-actions
- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v4.0.0
- Updated actions/checkout
- Updated dependency glob to v11.1.0 (security)
- Added new e2e test and updated test IDs to best practices

## 1.1.67 (2025-11-17)

### Added

- Added WYSIWYG interactive HTML editor (initial implementation)

### Fixed

- Prevent opening sidebar on onboarding

## 1.1.66 (2025-11-13)

### Added

- Added Grafana e2e selectors
- Added collapse on complete feature

### Fixed

- Fixed interactive styles
- Fixed UI theme and tab appearance

## 1.1.65 (2025-11-12)

### Changed

- Centralized types to reduce duplication
- Refactored devtools

### Fixed

- Fixed regression for guided handler

### Chore

- Updated grafana/plugin-actions
- Added changelog and documentation links

## 1.1.64 (2025-11-11)

### Added

- Added offline cloud suggestions for improved user guidance when recommendations are not available
- Implemented hand raise functionality for live sessions

### Changed

- Refactored global link interception and sidebar state management
- Moved workshop and assistant into integration folder
- Moved docs rendering into separate module
- Moved DOM helpers into lib for better organization
- Updated plugin and runtime dependencies

### Fixed

- Fixed deprecated lint issues

### Chore

- Updated GitHub artifact actions
- Spring cleaning of Agents information

## 1.1.63 (2025-11-07)

### Added

- Added function for quick complete for DOM changes

### Changed

- Cleaned up interactive guides implementation
- Grouped requirements manager files for better organization
- Grouped security related files

### Removed

- Removed plans feature

## 1.1.62 (2025-11-05)

### Added

- Implemented live sessions functionality

### Fixed

- Fixed browser storage issues

## 1.1.61 (2025-11-04)

### Fixed

- Fixed rendering issues

## 1.1.60 (2025-11-04)

### Fixed

- Fixed rendering issues

## 1.1.59 (2025-11-04)

### Fixed

- Fixed rerendering issues

## 1.1.58 (2025-11-03)

### Changed

- Improved sequence manager functionality

## 1.1.57 (2025-11-03)

### Changed

- Updated dependencies and workflows

### Fixed

- Fixed plugin update issues

## 1.1.56 (2025-10-31)

### Added

- Added backend proxy for context engine
- Added "open sidebar by default" feature flag

### Fixed

- Fixed scroll behavior
- Fixed auto launch tutorial

### Changed

- Updated multiple GitHub Actions (download-artifact to v5, setup-go to v6, setup-node to v6)
- Updated Grafana plugin actions and CI/CD workflows

## 1.1.55 (2025-10-31)

Previous stable release
