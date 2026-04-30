# P2 — npm + Docker distribution

> Implementation plan for phase 2 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria: [AI authoring implementation index — P2](../AI-AUTHORING-IMPLEMENTATION.md#p2--npm--docker-distribution).
> Tracking issue: _epic issue TBD_.

**Status:** Complete
**Started:** 2026-04-29
**Completed:** 2026-04-29

---

## Plan revision — 2026-04-30: GHCR-only continuous publish

Mid-PR, the scope was narrowed: **the CLI ships only as a GHCR Docker image, rebuilt and pushed on every merge to `main`**. No npm publish, no Docker Hub push, no `cli-v*` tag-driven release. Auth uses the always-present `GITHUB_TOKEN` so no repo secrets are required to operate the pipeline.

The original tag-driven publish-to-three-registries plan is retained below as historical record. It traded freshness for ceremony — every release required a tag, version-assertion, and three sets of credentials. The continuous-publish model fits the actual consumer needs better:

- Cloud Run deploys can pin `:main-<sha7>` for reproducibility, or follow `:latest` for tip-of-trunk.
- Other repos' GitHub Actions can `docker run ghcr.io/grafana/pathfinder-cli` to validate Pathfinder packages — no install step.
- A future `pathfinder-mcp` entrypoint (P3) inherits the same image, same publish flow, no additional CI work.

What's kept from the original plan: cosign keyless signing of the published digest, the `node:22-alpine` digest pinning, image smoke tests.

What's removed: the `cli-v*` tag trigger and version-assertion, the `publish-npm` job, the Docker Hub leg of `publish-docker`, the secret-gating of the GHCR push (now unconditional on main pushes), the `smoke-registry` job (rolled into the publish job).

## Plan revision — 2026-04-30 (second pass): drop the npm-pack codepath

After the GHCR pivot, the `prepublish-cli.js` / `pack:cli` machinery (which rewrote `package.json` and produced an npm tarball that the Dockerfile then `npm install -g`'d) was dead weight: there is no npm-publish path that needs the rewritten manifest. The Dockerfile now uses a direct-copy install instead — copy `dist/cli/` into the runtime stage, install just commander + zod from a slim runtime `package.json`, and symlink the CLI bin entrypoints onto `PATH`.

Removed (~470 LOC): `scripts/prepublish-cli.js`, `scripts/pack-cli.js`, `scripts/__tests__/prepublish-cli.test.js`, `README-cli.md`, the `prepublish-cli` / `prepublish-cli:write` / `pack:cli` npm scripts, the `repository` / `homepage` / `bugs` package.json fields (npm-registry-display only), the `scripts/__tests__/` glob in `jest.config.js`.

Added: `scripts/cli-build-utils.js` (~50 LOC) with two responsibilities — read `CURRENT_SCHEMA_VERSION` from source for the workflow, and generate a slim runtime `package.json` (commander + zod, versions copied verbatim from the main manifest) for the Dockerfile.

Net effect: same image (167 MB on `node:22-alpine`), same `--version`, same bin routing for `mcp`. ~400 fewer lines to maintain.

Sections below preserve the original decision log for context. Where the live system disagrees with the doc, the live system (`.github/workflows/cli-publish.yml`, `Dockerfile.cli`, `scripts/cli-build-utils.js`, `docs/developer/RELEASE_PROCESS.md`) wins.

---

## Preconditions

**Prior-phase exit criteria to re-verify before starting:**

- [ ] An agent following the ~20-line context block in `AGENT-AUTHORING.md` can author a multi-block guide that passes `validatePackage()` (P1 exit).
- [ ] All P1 tests pass; `npm run check` is clean on `main`.
- [ ] CLI version reported by `pathfinder-cli --version` equals `CURRENT_SCHEMA_VERSION` (currently `1.1.0`, sourced from `src/types/json-guide.schema.ts`).
- [ ] `tsconfig.cli.json` builds cleanly to `dist/cli/` and `package.json#bin.pathfinder-cli` resolves to `./dist/cli/cli/index.js`.

**Surface area this phase touches:**

- **Package layout / publishing config**
  - `package.json` — `bin`, `files`, `version`, `publishConfig`, `prepublishOnly` script. The plugin is currently versioned `2.10.0`; this is independent of `CURRENT_SCHEMA_VERSION` (`1.1.0`). See _Open questions_ below — the npm-publish-version source needs to be decided before task 2.
  - `scripts/` — new prepublish helper that pins the published version to `CURRENT_SCHEMA_VERSION` (read from `src/types/json-guide.schema.ts`).
  - `tsconfig.cli.json` — already produces `dist/cli/`; no expected changes unless we add a second entrypoint stub (see task 3).
- **Docker**
  - New top-level `Dockerfile.cli` (or `cli/Dockerfile`) — wraps the published npm package. Distinct from the existing `docker-compose.yaml` (which runs Grafana for plugin dev) and from any plugin Docker image.
  - Convenience entrypoint script that routes `mcp` subcommand to `pathfinder-mcp` (placeholder script in P2; real binary added in P3).
- **CI**
  - New `.github/workflows/cli-publish.yml` (or addition to the existing `release.yml`) — build + smoke-test on every merge to `main`; publish to npm + push Docker on tagged releases.
  - Existing `release.yml` is for the Grafana plugin tarball — must remain untouched in behavior. Decision required: separate tag prefix (e.g., `cli-v*`) vs. shared tag.
- **Plugin tarball**
  - `.config/`, `webpack.config.ts`, `src/plugin.json` — verify the CLI source is no longer copied into the plugin tarball. Per P2 exit criterion 4, plugin tarball contents must be unchanged from `main`.

**Public APIs / exported symbols:**

- `package.json#bin.pathfinder-cli` — already exists, must remain stable.
- `package.json#bin.pathfinder-mcp` — new placeholder, filled in P3. P2 ships either an empty stub or a "not yet available, install in P3" message; the bin slot must exist so P3 is purely additive.

**External contracts:**

- `npx pathfinder-cli@<CURRENT_SCHEMA_VERSION> --version` — must return `CURRENT_SCHEMA_VERSION` exactly.
- `docker run --rm grafana/pathfinder-cli:<CURRENT_SCHEMA_VERSION> --version` — same.
- Plugin tarball SHA / file list — unchanged from `main`.

**Open questions to resolve during execution:**

1. **Single-package vs. split-package publishing.** `package.json` is currently the plugin manifest (`version: 2.10.0`). Options:
   - **(a) Reuse the same `package.json`** with a `prepublishOnly` script that rewrites `version` and a narrow `files` allowlist (`dist/cli/`, `README` snippet) so only CLI artifacts ship to npm. The plugin's `2.10.0` version stays in git; the npm-published version is `CURRENT_SCHEMA_VERSION` synthesized at publish time.
   - **(b) Split into a dedicated package** under e.g. `packages/cli/package.json` and adjust the build to emit there. Cleaner separation but a larger refactor.
   - **Default plan: (a)** — minimum disruption, matches the index's "single `pathfinder-cli` package" wording. Decision-log it before task 2.
2. **Tag scheme for CLI releases.** The plugin uses `v*` tags. CLI needs a parallel scheme (`cli-v*`) so `release.yml` and `cli-publish.yml` don't fight over the same tag. Confirm with maintainers before wiring CI.
3. **npm package name.** `package.json#name` is `grafana-pathfinder-app`. The published package is referred to throughout as `pathfinder-cli` (e.g., `npx pathfinder-cli`). Either rename `name` (breaks the plugin manifest) or use `prepublishOnly` to rewrite `name` alongside `version`. Approach (a) above implies rewriting.
4. **Docker base image and registry.** Confirm `grafana/pathfinder-cli` is the agreed path on Docker Hub / `ghcr.io`; confirm Node base image (alpine vs. distroless) with Grafana's container guidelines.

---

## Tasks

_Atomic-commit-sized. Reference `P2:` in commit messages._

- [x] **1.** Resolve open questions 1–4 above. Append a Decision-log entry per question. No code changes in this commit — design lock-in only. _(Done 2026-04-29 — see Decision log.)_
- [x] **2.** Add `scripts/prepublish-cli.js` and `scripts/pack-cli.js` plus unit tests. _(Done 2026-04-29.)_
  - `prepublish-cli.js` reads `CURRENT_SCHEMA_VERSION` from `src/types/json-guide.schema.ts` and rewrites `name` → `pathfinder-cli`, `version` → `<CURRENT_SCHEMA_VERSION>`, `files` → `["dist/cli/", "README-cli.md"]`. Filters `dependencies` to a CLI-runtime allowlist (`commander`, `zod`); strips `devDependencies`, `lint-staged`, `overrides`, `packageManager`, and repo-only `scripts`.
  - Two modes: default `--check` prints to stdout (no I/O); `--write` overwrites `package.json` in place for ephemeral CI checkouts.
  - `pack-cli.js` does rewrite → `npm pack` → restore in a try/finally so local smoke tests exercise the same shape as a real publish without dirtying the working tree.
  - 16 unit tests in `scripts/__tests__/prepublish-cli.test.js` (rewrite shape, dep filtering, deterministic output, integration against the live manifest, missing-dep error path).
  - Jest `testMatch` extended to pick up `scripts/__tests__/`.
  - npm scripts added: `prepublish-cli`, `prepublish-cli:write`, `pack:cli`. **Note:** `prepublishOnly` was deliberately _not_ wired — see Decision log entry "Defer `prepublishOnly` wiring" — the CI workflow in task 6 invokes `prepublish-cli:write` explicitly to keep accidental local `npm publish` from rewriting the working tree.
- [x] **3.** Add `pathfinder-mcp` placeholder bin. _(Done 2026-04-29.)_
  - `src/cli/mcp-placeholder.ts` — shebang + writes a "not yet available, added in P3" pointer to stderr, exits 1. Compiles to `dist/cli/cli/mcp-placeholder.js` via the existing `tsconfig.cli.json`.
  - `package.json#bin` extended with `"pathfinder-mcp": "./dist/cli/cli/mcp-placeholder.js"`. The prepublish rewrite preserves both bin entries (verified by the existing "preserves the bin map verbatim" test).
  - Verified: `npm run build:cli` compiles cleanly; `node dist/cli/cli/mcp-placeholder.js` prints the pointer and exits non-zero. P3 will replace the file's contents without touching `package.json` — the bin slot is reserved.
- [x] **4.** Add `Dockerfile.cli` + entrypoint + `.dockerignore`. _(Done 2026-04-29.)_
  - Multi-stage build on `node:22-alpine`: builder stage copies the CLI sources (`src/cli`, `src/types`, `src/validation`), runs `npm ci && npm run build:cli && node scripts/prepublish-cli.js --write && npm pack`. Runtime stage installs the resulting tarball globally via `npm install -g`, exercising the same install codepath a real `npm install pathfinder-cli@<version>` would hit.
  - `scripts/docker-entrypoint.sh` does the routing: `mcp` first-arg shifts and execs `pathfinder-mcp`; otherwise execs `pathfinder-cli` with all args.
  - `.dockerignore` keeps the build context tight by excluding the frontend tree, `pkg/`, tests, and unrelated docs/scripts. Doesn't affect any other build (the repo had no Dockerfile before; `docker-compose.yaml` uses prebuilt images, no build context).
  - Runs as the stock `node` user on `/workspace`. Final image ~172MB.
  - Verified: `docker build -f Dockerfile.cli -t pathfinder-cli:local .` succeeds; `docker run --rm pathfinder-cli:local --version` → `1.1.0`; `docker run --rm pathfinder-cli:local mcp` → placeholder pointer, exit 1; `docker run --rm pathfinder-cli:local --help` flows through to CLI.
- [x] **5.** Add `README-cli.md` and the README-swap publish flow. _(Done 2026-04-29.)_
  - `README-cli.md` is the source-of-truth CLI readme — install (`npx`, Docker), usage table, agent-authoring pointer, links back to `AGENT-AUTHORING.md` and `PATHFINDER-AI-AUTHORING.md` via absolute GitHub URLs (relative links break once on npm).
  - `prepublish-cli.js --write` now also copies `README-cli.md` → `README.md` so the npm registry's display convention (always shows `README.md`) shows CLI docs, not the plugin readme.
  - `pack-cli.js` extended to back up + restore both `package.json` and `README.md`. Backups live in `os.tmpdir()` (not next to the originals) so `npm pack` can't pick them up.
  - `PUBLISHED_FILES` simplified to `["dist/cli/"]`. README is auto-included by npm from the package root; explicitly listing it caused a recursive match that pulled `dist/README.md` (a stale plugin-build artifact) into the tarball.
  - `.dockerignore` updated to allow `README-cli.md` (`!README-cli.md` exception to `*.md`).
  - `package.json` gained `repository`, `homepage`, `bugs` so the npm registry page links to GitHub correctly.
  - Verified: `npm run pack:cli` produces a 55-file, 130KB tarball whose only non-`dist/cli/` files are `LICENSE`, `package.json`, `README.md`. README content matches the CLI readme. Working tree is fully restored. Docker image rebuilds + smoke-tests still pass.
- [x] **6.** Add `.github/workflows/cli-publish.yml`. _(Done 2026-04-29.)_
  - 4 jobs: `build` (always — install, version assert, jest, build:cli, pack:cli, local pack smoke, docker buildx, image smoke), `publish-npm` (cli-v* only, secret-skip on absent `NPM_TOKEN`), `publish-docker` (cli-v* only, secret-skip on absent `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`, pushes both Docker Hub and GHCR mirror), `smoke-registry` (cli-v\* only, runs only when both publish jobs succeed).
  - Tag-validation step asserts the `cli-v<X>` suffix matches `CURRENT_SCHEMA_VERSION` exactly. Mismatched tags fail the build.
  - PR triggers use `paths:` filter so the workflow only fires on CLI-relevant changes.
- [x] **7.** Post-publish registry smoke test. _(Done 2026-04-29 — folded into `cli-publish.yml`'s `smoke-registry` job.)_
  - `npx pathfinder-cli@<version> --version` against the registry copy.
  - `docker run --rm grafana/pathfinder-cli:<version> --version` against the registry copy.
  - Auto-skips its inner steps when secrets are absent so the merge path stays green during the credential-provisioning gap.
- [x] **8.** Plugin tarball unchanged from `main`. _(Done 2026-04-29 — empirically verified.)_
  - Built `npm run build` on this branch and on `main`, snapshotted `find dist -type f | sort`. Both produce identical 134-file lists. Confirmed structurally: webpack only enters from `src/module.tsx`, and `src/cli/` is referenced only by test files (excluded from the production build), so adding CLI artifacts cannot affect the plugin bundle.
  - The verification command is documented in `RELEASE_PROCESS.md` ("Plugin tarball is unaffected" subsection) for re-verification by future agents.
- [x] **9.** Docs updated. _(Done 2026-04-29.)_
  - `docs/developer/CLI_TOOLS.md` — added "Distribution: npm and Docker" subsection covering `npx`, Docker, `mcp` routing, and local pack/build commands.
  - `docs/developer/RELEASE_PROCESS.md` — added the `cli-publish.yml` workflow entry, a full "CLI and MCP releases" operator playbook (versioning, tag scheme, dry-run, cutting a release, required secrets, plugin-tarball-unchanged check).
- [x] **10.** Mark P2 complete + Handoff. _(Done 2026-04-29.)_

### Test plan

- **Unit:** prepublish-script test (task 2) — fixture-driven, asserts rewritten `name`, `version`, `files`.
- **Integration:** `npm pack` on the rewritten manifest produces a tarball whose `package.json` reports the correct `name`/`version` and whose contents are scoped to `dist/cli/`. Asserted by a script in `scripts/__tests__/`.
- **CI smoke:** the post-publish job in task 7. On the merge path, an equivalent smoke test runs against the local pack (`npm pack` + `npx ./<tarball>`).
- **Manual verification:**
  - On a clean clone: `npm ci && npm run build:cli && npm pack` → inspect tarball.
  - `docker build -f Dockerfile.cli -t pathfinder-cli:local . && docker run --rm pathfinder-cli:local --version`.
- **Reviewer commands:** `npm run check`, `npm run test:ci`, plus the tarball-diff from task 8.

### Verification (matches index exit criteria)

- [ ] `pathfinder-cli@<CURRENT_SCHEMA_VERSION>` is installable from the npm registry and `npx` runs it.
- [ ] `grafana/pathfinder-cli:<CURRENT_SCHEMA_VERSION>` is in the container registry and runs.
- [ ] Both versions match `CURRENT_SCHEMA_VERSION` exactly (verified by the post-publish smoke job).
- [ ] Plugin tarball contents are unchanged from `main` — the CLI is no longer copied into the tarball (verified by task 8 diff).

---

## Decision log

### 2026-04-29 — Move `commander` to `dependencies` (caught during task 2)

- **Decision:** Move `commander` from `devDependencies` to `dependencies` in `package.json`. Discovered when the prepublish-cli integration test failed: `commander` is the runtime parser for the published `pathfinder-cli` bin, so consumers running `npm install pathfinder-cli` need it installed automatically.
- **Alternatives considered:** Allow the prepublish allowlist to fall back to `devDependencies`. Rejected — that would mask the real bug (truly-runtime deps mis-labeled as dev) and would let unrelated dev tooling silently leak into the published manifest.
- **Rationale:** The CLI was historically built but never published; once it ships to npm, its runtime imports must be declared as `dependencies` so consumers get a working install.
- **Touches:** `package.json` (commander moved); test added in `scripts/__tests__/prepublish-cli.test.js` that fails if any allowlisted CLI-runtime dep is missing from `dependencies`.

### 2026-04-29 — Defer `prepublishOnly` wiring

- **Decision:** Do not wire `prepublishOnly` in `package.json#scripts`. Instead, the CI workflow (task 6) calls `npm run prepublish-cli:write` explicitly before `npm publish`.
- **Alternatives considered:** Wire `prepublishOnly: "node scripts/prepublish-cli.js --write"` so any `npm publish` does the rewrite. Rejected for two reasons: (a) the rewrite mutates the working tree in place, so an accidental local `npm publish` would dirty the dev's repo; (b) explicit invocation in CI is more legible than implicit npm-lifecycle magic.
- **Rationale:** The CI workflow is the only intended publisher. Making the rewrite explicit there makes the publish surface inspectable in `cli-publish.yml` rather than buried in `package.json` lifecycle hooks.
- **Touches:** `package.json#scripts` (added `prepublish-cli`, `prepublish-cli:write`, `pack:cli`); deferred wiring is documented in this entry so a future agent doesn't reflexively add `prepublishOnly`.

### 2026-04-29 — Single-package, rewrite manifest at publish time

- **Decision:** Reuse the existing `package.json` and rewrite `name`/`version`/`files` at publish time via `scripts/prepublish-cli.js` (option (a) from the open questions). The repo manifest keeps `name: grafana-pathfinder-app` and `version: 2.10.0` for the Grafana plugin identity; the npm-published artifact gets `name: pathfinder-cli` and `version: <CURRENT_SCHEMA_VERSION>`.
- **Alternatives considered:** (b) Split into `packages/cli/package.json` with a workspace setup. Rejected: large refactor, touches webpack/jest/eslint roots, expands the diff well past P2's scope.
- **Rationale:** Matches the index's "single `pathfinder-cli` package" wording with minimum disruption. The bin map is name-independent (`npx pathfinder-cli` works regardless of `package.json#name`), so local dev is unaffected. One build pipeline (`tsconfig.cli.json` → `dist/cli/`) feeds both contexts.
- **Risk and mitigation:** `prepublishOnly` only fires on `npm publish`, not `npm pack`. Mitigation: add a `pack:cli` script that runs the rewrite → `npm pack` → restore so smoke tests on the merge path exercise the same artifact shape as a real publish.
- **Touches:** `package.json`, new `scripts/prepublish-cli.js`, new `scripts/__tests__/prepublish-cli.test.js`.

### 2026-04-29 — Tag scheme: `cli-v*` for CLI releases

- **Decision:** CLI releases use `cli-v<CURRENT_SCHEMA_VERSION>` tags (e.g., `cli-v1.1.0`). Plugin releases continue to use `v*` and are owned by `release.yml`. The new `cli-publish.yml` workflow filters on `cli-v*` only.
- **Alternatives considered:** Shared `v*` tags with both workflows discriminating on path filters or commit content. Rejected: brittle, two workflows fighting over one tag is exactly the failure mode this phase needs to avoid.
- **Rationale:** Plugin and CLI cadences are decoupled per the index's cross-cutting concerns. Distinct tag prefixes make the release surface unambiguous from `git tag` alone.
- **Touches:** new `.github/workflows/cli-publish.yml`; documentation update in `docs/developer/RELEASE_PROCESS.md`.

### 2026-04-29 — Published name: `pathfinder-cli` (unscoped)

- **Decision:** Published npm name is `pathfinder-cli`, unscoped. Rewrite is performed by `prepublish-cli.js` alongside the version pin.
- **Alternatives considered:** `@grafana/pathfinder-cli` (scoped). Not rejected on technical grounds — scoping is reasonable and matches `@grafana/*` conventions — but deferred: scope ownership and npm org access need to be confirmed with Grafana's npm admins, and the index doc consistently refers to the unscoped name.
- **Rationale:** Matches every reference in `AI-AUTHORING-IMPLEMENTATION.md` and `AGENT-AUTHORING.md` (`npx pathfinder-cli@<version>`). Scoping can be revisited as a follow-up if npm-org policy requires it; the rewrite script is the single point of change.
- **Open follow-up:** Confirm npm name `pathfinder-cli` is available / claimable by Grafana before the first real publish. This is part of the secret/auth setup the user is working through separately.
- **Touches:** `scripts/prepublish-cli.js`.

### 2026-04-29 — Docker: Docker Hub `grafana/pathfinder-cli`, mirror to `ghcr.io`, base `node:22-alpine`

- **Decision:** Build and tag two refs per release — `grafana/pathfinder-cli:<version>` (Docker Hub) and `ghcr.io/grafana/pathfinder-cli:<version>` (GitHub Container Registry mirror). Base image: `node:22-alpine` (Node 22+ is the project floor per `AGENTS.md`; alpine keeps the image small for an MCP/CLI use case).
- **Alternatives considered:** Distroless (`gcr.io/distroless/nodejs22-debian12`) for a smaller attack surface. Deferred: distroless requires a separate `npm install` stage and complicates the `mcp`-routing entrypoint. Reasonable for a follow-up hardening pass; not in scope for P2.
- **Rationale:** Matches Grafana's existing image-publishing pattern (Docker Hub canonical, ghcr mirror). Alpine is the simplest base that satisfies Node 22 + small image and keeps the entrypoint script straightforward.
- **Open follow-up:** Confirm `grafana/pathfinder-cli` is the agreed Docker Hub path with whoever owns the `grafana` org on Docker Hub. Same as the npm-name follow-up: gated on the user's auth/secrets work.
- **Touches:** new `Dockerfile.cli`; CI workflow.

### 2026-04-29 — Secret-gated publish: build always, push only when tokens are present

- **Decision:** The CI workflow runs the full build + pack + image-build + smoke-test pipeline on every trigger. The terminal `npm publish` and `docker push` steps are gated behind `if: ${{ secrets.NPM_TOKEN != '' }}` and the equivalent for Docker registry credentials. Until the user provisions tokens, the workflow validates everything end-to-end except the final push, and the post-publish registry smoke job is conditional on the publish having run.
- **Alternatives considered:** Wait to wire CI until secrets are available. Rejected: the build/pack/image-build steps are exactly what we want exercised on `main` regardless, and gating only the push keeps the merge-path signal honest.
- **Rationale:** Captures all the packaging value (artifacts validated, manifests verified, image builds, smoke tests pass against the local pack) without blocking on auth setup the user is handling separately. Flipping to "real publish" later is a single secret addition, not a workflow rewrite.
- **Touches:** `.github/workflows/cli-publish.yml`; tasks 6–7 below adjusted accordingly.
- **Implementation note (added during task 6):** the actual gating uses bash `if [ -z "${NPM_TOKEN:-}" ]` inside the publish step rather than a step-level `if:` on `secrets.X != ''`. GitHub Actions doesn't reliably evaluate secret references in step `if:` conditionals, and the bash form is more legible. Behavior is identical: missing secret → `::warning::` log + step exits 0 → workflow stays green.

### 2026-04-29 — CI `paths:` filter on pull_request

- **Decision:** The `cli-publish.yml` workflow's `pull_request` trigger uses a `paths:` filter that includes only CLI-relevant files (`src/cli/**`, `src/types/**`, `src/validation/**`, the prepublish/pack scripts, `tsconfig.cli.json`, `package.json`, `Dockerfile.cli`, `.dockerignore`, `README-cli.md`, the workflow itself). Push to `main` and `cli-v*` tag triggers are unfiltered.
- **Alternatives considered:** No path filter (run on every PR). Rejected: doubles the CI minutes spent on PRs that don't touch the CLI tree, and adds noise to PR status checks.
- **Rationale:** Frontend-only PRs don't need to re-validate the CLI build. The `main` branch trigger is unfiltered so any merge that lands a CLI-relevant change gets a clean signal regardless of whether the PR touched the listed paths.
- **Risk:** A future shared file added outside the listed paths could silently skip the workflow. Mitigation: the path list is short and lives next to the workflow itself, so it's easy to audit and widen.
- **Touches:** `.github/workflows/cli-publish.yml` (`on.pull_request.paths`).

### 2026-04-29 — GHCR mirror authenticates with `GITHUB_TOKEN`

- **Decision:** The Docker publish job pushes to `ghcr.io/grafana/pathfinder-cli` using the auto-provided `secrets.GITHUB_TOKEN` with `packages: write` permission, not a separately-provisioned PAT.
- **Alternatives considered:** A long-lived PAT with `write:packages` scope, stored as a repo secret. Rejected: an extra secret to rotate, with no benefit since `GITHUB_TOKEN` is sufficient for org-owned GHCR pushes from this repo.
- **Rationale:** Standard pattern for `ghcr.io/<github-org>/...` pushes. One fewer secret to manage.
- **Risk:** Org-level token-permission policies could block `packages: write`. If that surfaces, swap in a PAT-based login.
- **Touches:** `.github/workflows/cli-publish.yml` (`publish-docker` job — `permissions.packages: write`, GHCR login uses `secrets.GITHUB_TOKEN`).

### 2026-04-29 — Docker image tags `:latest` alongside `:<version>`

- **Decision:** Each `cli-v*` release pushes both `grafana/pathfinder-cli:<version>` and `grafana/pathfinder-cli:latest` (mirrored to GHCR).
- **Alternatives considered:** Drop `:latest` and require explicit version tags. Rejected: violates the principle of least surprise for `docker run grafana/pathfinder-cli ...`; removes a common usability convention.
- **Rationale:** Matches the de facto Docker-image publishing convention. Strict pinning is preserved via `:<version>` for users who want it.
- **Risk:** A user who runs `:latest` and expected a stable contract gets implicit upgrades on each release. Acceptable — the published artifact's contract is "matches `CURRENT_SCHEMA_VERSION`," which is precisely what `:latest` means here.
- **Touches:** `.github/workflows/cli-publish.yml` (`publish-docker` `tags:` list).

### 2026-04-29 — `pack-cli.js` auto-builds when `dist/cli/` is missing

- **Decision:** `scripts/pack-cli.js` checks for `dist/cli/` at the start and runs `npm run build:cli` if it's missing or empty.
- **Alternatives considered:** Fail loud with an instruction to run `npm run build:cli` first. Rejected: caught a real bug during task-10 verification (silent empty 3-file tarball after `rm -rf dist`); the failure mode was non-obvious because `npm pack` doesn't error on empty `files` matches. Auto-build matches user expectation that `pack:cli` produces a usable tarball.
- **Rationale:** Tighter contract for the local smoke-test path. `pack-cli` is now equivalent to `npm run build:cli && pack:cli` from a clean tree, which is what users want. Slight additional time on a clean tree is acceptable.
- **Touches:** `scripts/pack-cli.js`.

---

## Deviations

_Appended during execution._

---

## Handoff to next phase

**P3 agent: read this section before drafting the P3 plan.**

- **The `pathfinder-mcp` bin slot is reserved.** `package.json#bin.pathfinder-mcp` points at `./dist/cli/cli/mcp-placeholder.js`, which currently is `src/cli/mcp-placeholder.ts` — a 12-line stderr-pointer + `process.exit(1)`. P3 should replace the file's contents (the real MCP server entrypoint) without touching `package.json#bin`. The bin path stays the same so consumers' existing `npx pathfinder-mcp` invocations work unchanged.
- **`scripts/prepublish-cli.js` is the single point of publish-time rewriting.** It rewrites `name`, `version` (pinned to `CURRENT_SCHEMA_VERSION`), `dependencies` (filtered by an allowlist), `files` (currently `["dist/cli/"]`), and copies `README-cli.md` → `README.md`. **P3 will need to extend `CLI_RUNTIME_DEPENDENCIES`** in this script with whatever MCP runtime libs you pull in (e.g., `@modelcontextprotocol/sdk`). The integration test (`scripts/__tests__/prepublish-cli.test.js`) fails-loud if a CLI/MCP source file imports an external module not declared in `dependencies` — keep that contract.
- **Both deps and devDeps must be checked.** `commander` was originally in `devDependencies` (correct for an internal build artifact, broken for a published bin). Discovered when the prepublish integration test failed. Same pattern will apply to MCP deps — make sure they land in `dependencies`.
- **Tag scheme is `cli-v*`.** Plugin uses `v*`; CLI uses `cli-v*`. The CI workflow asserts `cli-v<X>` matches `CURRENT_SCHEMA_VERSION` exactly. P3 follows the same scheme — bump `CURRENT_SCHEMA_VERSION` if MCP additions are a breaking change to the published artifact, then tag.
- **Secret-gated publish.** `cli-publish.yml` validates the full build/pack/image-build/local-smoke path on every PR and `main` push. Real publish (npm + Docker Hub + GHCR) only fires on `cli-v*` tags AND when `NPM_TOKEN` / `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` are configured. Until those secrets land, the workflow stays green and the build path is exercised; only the registry smoke skips. P3 inherits this and does not need to re-design it.
- **Docker entrypoint routing.** `scripts/docker-entrypoint.sh` routes `mcp` first-arg → `pathfinder-mcp`. P3's real MCP entrypoint will be picked up automatically through this; no Dockerfile or entrypoint changes needed.
- **Plugin tarball is provably unaffected.** Verified empirically (`npm run build` on this branch and `main` produce identical `dist/` listings) and structurally (webpack only enters from `src/module.tsx`). P3 maintains this so long as nothing in `src/cli/` is imported from `src/module.tsx` or its frontend reachable graph.
- **Open external follow-ups (gated on user's auth/secrets work):** confirm `pathfinder-cli` is claimable on npm under the Grafana org; confirm `grafana/pathfinder-cli` Docker Hub path with the org owner; provision `NPM_TOKEN` + `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` in repo secrets. None of these block P3 development.
- **Things deferred for a later hardening pass (not P3-blocking):** distroless Docker base; scoped npm name (`@grafana/pathfinder-cli`); excluding `src/validation/import-graph.ts` from `tsconfig.cli.json` (it pulls in `typescript` as a runtime dep but is unreachable from CLI entry points so doesn't actually load).
- **Docs that drifted (none).** `AI-AUTHORING-IMPLEMENTATION.md` was the only design doc that referenced P2 specifics; it's been updated to `Complete`. The cross-cutting concerns ("Schema is owned by the CLI", "One canonical ID", "Stateless artifact model") all hold as written.
