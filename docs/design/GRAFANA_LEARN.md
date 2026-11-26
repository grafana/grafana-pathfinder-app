# Grafana Learn in Pathfinder

Design authority for the epic [#2518](https://github.com/grafana/grafana-pathfinder-app/issues/2518). It extends the existing docs-embedding pattern (fetch trusted Grafana docs through the `content.json` to `unstyled.html` ladder, parse the semantic HTML, route learning paths through the journey reader). It is not a new design and needs no RFC. Each implementation issue updates this note when reality changes.

Status: the classifier ([#2511](https://github.com/grafana/grafana-pathfinder-app/issues/2511)) and completion identity ([#2513](https://github.com/grafana/grafana-pathfinder-app/issues/2513)) are implemented. Everything else here is design intent and may not match the code yet; verify against the code before acting on it.

## 1. Scope

Grafana Learn pages under `/docs/learning-hub/` open in Pathfinder as learning journeys: a cover with a table of contents, ordered steps, previous and next navigation, correct completion records, and deep links to a journey, section or step. Pathfinder consumes what the Grafana website already publishes.

Non-goals: a markdown transport, any website change, section-level completion, alias resolution, recommender changes, versioned docs, and in-tab navigation between steps of the same journey (a later add-on).

## 2. Terminology

Four words collide. Keep them apart in code, docs and analytics.

| Term                                 | Means                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learn journey, section, module, step | The website's four levels below the Learn home. A module is a section by another name; a journey holds sections or modules, never both.                                                                                                                                                                                     |
| Learning journey (code)              | Pathfinder's flat list of milestones: `LearningJourneyMetadata`, `Milestone`, the `learning-journey` content type. It is what COMPLETION-MODEL calls a path.                                                                                                                                                                |
| Journey (COMPLETION-MODEL)           | A path of paths, from decision 5 of `docs/design/COMPLETION-MODEL.md`. Not built, and Learn does not build it.                                                                                                                                                                                                              |
| `learn` family                       | The URL family of Learn pages, in `src/lib/docs-url-family.ts`. Distinct from the existing launch source `learning-hub` (`src/recovery/launch-sources.ts`), which means "opened by the website's learning-hub recommender" and forces journey mode. Use `learn` in code and analytics; never `learning-hub` for the family. |

## 3. URL families and the classifier

`classifyDocsUrl` in `src/lib/docs-url-family.ts` is the one place that decides which family a URL belongs to. Before it, at least eight hand-copied predicates answered "is this a journey URL" and disagreed on `startsWith` versus `includes`, on query strings, and on whether `/tutorials/` counted. None of them knew Learn.

| Family                    | A URL belongs to it when                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `learn`                   | On a Grafana docs host over https, under `/docs/learning-hub/`, at most three segments deep, and not under `/search/` |
| `learning-path`           | Its path starts with `/docs/learning-paths/` or `/learning-paths/`                                                    |
| `legacy-learning-journey` | Its path starts with `/docs/learning-journeys/` or `/learning-journeys/`                                              |
| `tutorial`                | Its path starts with `/tutorials/` or `/docs/tutorials/`                                                              |
| `interactive-learning`    | An https URL on an interactive-learning host                                                                          |
| `docs`                    | Any other Grafana docs URL (the trust gate's `isGrafanaDocsUrl`)                                                      |
| `other`                   | Everything else, including URLs that do not parse                                                                     |

`family` is the primary classification. The old predicates did not agree on one rule, so the classifier also reports the facts they read, and each call site keeps its own rule through a named predicate.

Rules the classifier follows:

- It reads the parsed pathname through `parseUrlSafely`, so a journey-looking path in a query string or fragment never counts.
- It strips `unstyled.html` and a `content[.<locale>].json` file first, and keeps the slash before the file, so a page and its published files classify alike.
- Learn is checked first. A Learn result carries no legacy facts, so a Learn slug named like a legacy family never leaks into a legacy predicate.
- Learn depth below `/docs/learning-hub/` gives the kind: 0 home, 1 journey, 2 section or module, 3 step. `/docs/learning-hub/search/` is `other`: the home index lists a `search` entry that is a page, not content. A path deeper than a step is `docs`.
- A Learn result carries `journeyBaseUrl` and `sectionUrl` without a trailing slash, built from the parsed origin and never from caller input. Below the home it also carries `journeySlug` and `relativePath`, the path below `/docs/learning-hub/` without slashes at either end. Completion identity reads these, so every spelling of a step URL gets one identity.
- For every other URL, `legacy` lists each `learning-journeys`, `learning-paths` and `tutorials` segment anywhere in the path, with whether it follows a `docs` segment, whether it is rooted (first, or right after a leading `/docs`), and whether it is bare (last, with no slash after it). It also records a `milestone-N` segment: `exact` for a whole segment, `prefix` for a segment that only starts with it. The legacy `family` is the first rooted, non-bare segment.
- Learn is host-gated; the legacy facts are not. The predicates they replace matched on the path alone, and private-guide eligibility relies on that. Classification is structural. It is never a trust decision, and every caller keeps its trust gate. Learn stays a flat document.

The predicates beside the classifier, one per old rule:

| Predicate                   | True when                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `isLegacyJourneyFamily`     | A non-bare `learning-journeys` or `learning-paths` segment anywhere: opens as a journey tab and publishes a `content.json`    |
| `isDocsRootedLegacyJourney` | The path starts with `/docs/learning-journeys/` or `/docs/learning-paths/` (the link handler)                                 |
| `isJourneyContent`          | A non-bare `learning-journeys` or `learning-paths` segment after `docs`, a non-bare `tutorials` segment, or any `milestone-N` |
| `hasJourneyFamilySegment`   | Any `learning-journeys`, `learning-paths` or `tutorials` segment, bare or not, or an exact `milestone-N` segment              |

Learn is in none of them until journey mode lands.

`src/validation/docs-url-family-literal.test.ts` fails on a new hand-written family literal outside the classifier. Its allowlist lists the literals that are not family decisions: the trust gate, URL builders, sample data, and two sites that move onto the classifier in [#2512](https://github.com/grafana/grafana-pathfinder-app/issues/2512).

### Behavior preserved, site by site

Issue #2511 promises no behavior change. Every site keeps its old rule, now read from the parsed path. The only deltas are:

1. A journey-looking path in a query string or fragment no longer counts.
2. The journey base is built from the parsed origin: it drops a query or fragment, lowercases the host, strips userinfo, drops a default port and collapses `..` segments.
3. Under `/docs/learning-hub/` on a Grafana docs host, Learn wins and carries no legacy facts. A Learn URL with a `learning-paths`, `learning-journeys`, `tutorials` or `milestone-N` segment, for example `/docs/learning-hub/x/learning-paths/y`, used to be journey content, take the `content.json` rung, route as a journey and stay ineligible as a private guide. It now does none of these. No real Learn slug hits this, and `docs-url-family.test.ts` pins it so a future slug named like a legacy family changes routing on purpose.

Rows below that say "None" describe every URL except those Learn URLs; delta 3 is the exception.

| Site                                                                                | Old matching                                                                                              | New matching                                  | Real-world effect                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content type (`determineContentType`)                                               | Pathname contains `/docs/learning-journeys/`, `/docs/learning-paths/` or `/tutorials/`, or `/milestone-N` | `isJourneyContent`                            | None.                                                                                                                                                                                                                                                         |
| `content.json` rung (`tryGrafanaDocsContentLadder`)                                 | Pathname contains `/learning-journeys/` or `/learning-paths/`, or an interactive-learning host            | `isLegacyJourneyFamily`; host check unchanged | None.                                                                                                                                                                                                                                                         |
| Routing (`isLearningJourneyUrl`: auto-open, `prepareGuideLaunch`, deep-link typing) | Pathname contains `/learning-journeys/` or `/learning-paths/`                                             | `isLegacyJourneyFamily`                       | None.                                                                                                                                                                                                                                                         |
| Link handler                                                                        | Pathname starts with `/docs/learning-journeys/` or `/docs/learning-paths/`                                | `isDocsRootedLegacyJourney`                   | None.                                                                                                                                                                                                                                                         |
| Live-session auto-open                                                              | The whole URL string contains either segment, query included                                              | `isLearningJourneyUrl`                        | A journey path echoed only in a query string or fragment stops matching.                                                                                                                                                                                      |
| URL tester (dev tool)                                                               | The whole string contains either segment, query included                                                  | `isLegacyJourneyFamily`                       | Same.                                                                                                                                                                                                                                                         |
| Private-guide eligibility                                                           | http(s) pathname with any `learning-journeys`, `learning-paths`, `tutorials` or `milestone-N` segment     | `hasJourneyFamilySegment`                     | None.                                                                                                                                                                                                                                                         |
| Journey base (`getLearningJourneyBaseUrl`)                                          | Three regexes on the string, then a text fallback for `/milestone-N`                                      | Parsed path root, then the unchanged fallback | Same base for every journey root. A query or fragment attached to the slug is dropped and the host is lowercased; userinfo, a default port and `..` segments also go, none reachable in normal use. The fallback still serves milestone and non-http(s) URLs. |

Known inconsistency: nested `/tutorials/` docs pages, such as the Alloy, Agent, k6 and alerting tutorials under `/docs/alloy/latest/tutorials/…`, are typed as journey content only because the old predicate matched the segment anywhere. Their `family` is `docs`, and they open as docs tabs. Narrowing that is a possible separate follow-up, not part of this change.

## 4. The website contract Pathfinder consumes

Observed in November 2026 and treated as a de facto contract, not a guarantee. Pathfinder adapts to it and asks the website for nothing.

- Every Learn page, from the home to a step, publishes a bare `unstyled.html`: no page shell or scripts, with Learn's own components as plain semantic markup. All 581 pages were available when checked.
- Journey and section pages publish an `index.json` whose entries carry `permalink`, `params.title`, optional `params.menutitle`, `params.layout` (`journey`, `section`, `module`, `step`), `params.weight`, `params.description` and `params.grafana.skip`. The home index lists the journeys and one `search` entry that must be ignored.
- The tree has fixed depth: home, journey, section or module, step. Every step URL has exactly three segments below the Learn root.
- Learn publishes no `content.json`, so the ladder's JSON rung does not apply.
- Markup shapes that Pathfinder adapts to are listed in section 9. Pin them with committed fixtures, never with a live-network test in CI.

## 5. Navigation model

The numbered rules below are design intent for [#2512](https://github.com/grafana/grafana-pathfinder-app/issues/2512).

1. A Learn journey becomes a code-level learning journey. Steps flatten into milestones numbered 1 to N. Sections become display groups only; there is no section-level completion, which avoids building COMPLETION-MODEL decision 5.
2. Order follows the website's own navigation: stable-sort children by numeric `params.weight` ascending, with a missing weight last and array order kept for ties. The array order in `index.json` is not the journey order: in ten of the twenty-four journeys the weight-0 introduction section is listed last. Sort at both levels.
3. The cover is the journey URL and has position 0. A step URL has its milestone number. A section or module URL opens the journey at the section's first step, matching the website. A URL missing from the tree renders as a single document with no toolbar and logs a diagnostic.
4. The tab title comes from `params.title`, or the page title without its site suffix, never from the slug.
5. Learn links keep today's behavior and open a new tab, which becomes a journey tab once Learn is classified. Navigating inside the active tab for same-journey links is a later add-on.

## 6. Cache and partial failure

A journey needs one `index.json` request plus one per section: up to nine. The table of contents and every step load need the result.

- Cache the resolved journey in a module-level map keyed by journey base URL, with in-flight deduplication and a ten-minute lifetime. It holds anonymous public data only, so it respects the rule that per-user data never enters a shared cache. Persist nothing.
- Cache a failure for at most thirty seconds.
- If the journey index fails, there are no milestones and the page renders as a single document, which is today's behavior.
- If one section fails, its steps are missing, so the journey sets `hasUnavailableMilestones` and completion is not granted from a partial tree.
- Fetch every index through the same trust and HTTPS gates as content, with the content timeout, so guide-load telemetry sees them.
- Hugo alias pages are meta-refresh documents, not redirects, so an old Learn URL does not resolve. That matches how docs behave today and is out of scope.

## 7. Completion identity

This is the one-way door, and it lands before the flag can be turned on ([#2513](https://github.com/grafana/grafana-pathfinder-app/issues/2513)).

Today a milestone's progress is keyed by the last URL segment, and its durable record is written as `guideSource: 'bundled'`. Twenty-nine Learn step slugs repeat across journeys (`01-course-overview` alone appears in twelve), so classifying Learn as a journey on today's keying would credit a step in one journey as done in another and write misattributed durable records. The per-URL progress key is unique per URL, so progress rings would be right while durable records and badges would not.

Decision: Learn records use a new `guideSource: 'grafana-learn'`. The completion record's `guideSource` is documented as free-form, so no schema bump is needed. Implemented in `src/completion-records/completion-identity.ts` and `completeLearnMilestone` in `src/docs-retrieval/learning-journey-helpers.ts`.

- A step's `guideId` is its path below `/docs/learning-hub/`: `<journey>/<section>/<step>`, with `guideCategory: 'learning-journey'` and `pathId` set to the journey slug. Both come from the classifier's `relativePath` and `journeySlug`, never from a hand-parsed path.
- Journey completion has its own record, with `guideId` set to the journey slug. It is written once every step of the resolved tree is complete, and never when the tree has `hasUnavailableMilestones` set.
- Learn never writes a bare slug into the shared completed-guides list, so it stays clear of curated paths and badges until product asks for Learn badges.
- Progress stays on the per-URL key, and a step matches its milestone by path, so two steps with one slug in the same journey stay apart.
- A renamed or moved step loses its completion, because the permalink is the only stable identifier the index offers. That is the same as legacy docs paths.

Decision 11 of `docs/design/COMPLETION-MODEL.md` and section 3 of `docs/developer/COMPLETION_RECORDING.md` describe the identity and its trade-off.

## 8. Security boundaries

- No allowlist change. Learn is under `/docs/` on an allowed host, so `isAllowedContentUrl`, `isGrafanaDocsUrl` and `isTrustedFinalUrl` already cover it. They stay authoritative; the classifier sits beside them and replaces none of them.
- `index.json` is network input. Fetch it through the existing gates, re-validate every `permalink` with `isGrafanaDocsUrl` before it becomes a milestone URL, and build absolute URLs against `https://grafana.com`, never a caller-supplied base.
- Parse URLs, never match them as strings (frontend-security F3). That is why the classifier uses the parsed pathname and why the literal ratchet exists.
- The new family is host-gated, so a look-alike host such as `grafana.com.evil.com` never classifies as `learn`.
- Mermaid turns remote text into SVG and needs its own security review (section 9).

## 9. Rendering adaptations

Most Learn markup already renders. All adaptations are tolerant: when a shape is not recognized the content renders plain.

| Shape in the published markup                                                          | Adaptation                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blockquote whose first paragraph holds only a bold label (Note, Tip, Caution, Warning) | Wrap as a typed callout with the existing admonition styles. Detect by structure, not by English text, except to choose the color. Other blockquotes, such as prompt examples and bold lead-ins, stay plain.    |
| Journey cover `<dl>` with duration and level                                           | Style as a compact metadata row. Drop the duplicate title once the cover shows the table of contents.                                                                                                           |
| Section, module and home pages that hold only a heading                                | Open at the first step (section); show a journey directory built from the home index (home).                                                                                                                    |
| `pre` with `language-mermaid`                                                          | Render a diagram through a lazy-loaded Mermaid library only on pages that contain one, with strict security level, sanitized output, collapsed source, and a code-block fallback if loading or rendering fails. |
| Learning-path and interactive-guide links, tables, code, images                        | Already work through the existing link handler and parser.                                                                                                                                                      |

## 10. Rollout and deferred work

The issues, in order:

1. [#2511](https://github.com/grafana/grafana-pathfinder-app/issues/2511): the classifier, its ratchet, and this note. No behavior change beyond the two deltas in section 3.
2. [#2512](https://github.com/grafana/grafana-pathfinder-app/issues/2512): journey resolution behind a feature flag that defaults to off, per `docs/developer/FEATURE_FLAGS.md`.
3. [#2513](https://github.com/grafana/grafana-pathfinder-app/issues/2513): completion identity. The flag stays off until this merges.
4. [#2514](https://github.com/grafana/grafana-pathfinder-app/issues/2514) and [#2515](https://github.com/grafana/grafana-pathfinder-app/issues/2515): presentation and Mermaid. Neither gates journey correctness.
5. After the main line, [#2516](https://github.com/grafana/grafana-pathfinder-app/issues/2516) fetches Learn's `unstyled.html` directly, skipping the canonical page download (about 136 KB per step), with a fallback to the canonical-first path on a 404. [#2517](https://github.com/grafana/grafana-pathfinder-app/issues/2517) adds same-journey navigation in the active tab.

Turning the flag on is the launch. It needs the completion work merged and a manual pass over every journey. Today's ladder fetches the canonical page first for a Learn step, then `unstyled.html`; that costs bytes, not correctness, and waits for #2516.
