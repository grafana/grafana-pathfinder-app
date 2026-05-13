---
name: i18n-sync
description: Detect translation gaps across the 21 locales under `src/locales/`. For keys present in `en-US` but missing from another locale, add the key with an empty string value (matching the runtime fallback to the en-US default). Emit a gap report (filled / empty / stale counts per locale + the list of newly stubbed keys). Never invents translations; translators fill the empty stubs later.
---

# i18n sync

Closes the translation gap between `en-US` (canonical) and the 20 other locales under `src/locales/`. The skill is **plumbing, not a translation engine** — it adds the missing keys with empty values so the JSON shape matches `en-US` and translators can fill them in later. Runtime behavior is unchanged: empty values fall back to the en-US default at render time.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **`en-US` is the canonical source.** Other locales must contain the same key set; values may be empty strings (intentional fallback) or filled with real translations. Never modify `en-US`.
2. **Only edit `src/locales/*/grafana-pathfinder-app.json`.** Never touch source code.
3. **Preserve existing translations exactly.** Do not retranslate, "improve", or normalize values — translators own them.
4. **Match the `i18next-parser` config** (`src/locales/i18next-parser.config.js`):
   - Keys sorted alphabetically within each nested object
   - No `createOldCatalogs` artifacts
   - `failOnWarnings: true` — extraction must remain clean after edits
5. **Never fabricate values.** Missing keys get empty strings (`""`), not English text, not placeholder text, not auto-translated content.
6. **Run `npm run prettier` after edits.** Run `npm run i18n-extract` to confirm extraction still passes.

## Workflow

### Phase 0 — Setup

1. Read `src/locales/i18next-parser.config.js` and capture the `locales` array. Treat the parser config as the source of truth for which languages are supported. At time of writing this includes `en-US, de-DE, es-ES, fr-FR, it-IT, hu-HU, id-ID, ja-JP, ko-KR, nl-NL, pl-PL, pt-PT, pt-BR, ru-RU, sv-SE, tr-TR, zh-CN, zh-TW, zh-Hans, zh-Hant, cs-CZ` — but read the file, do not hardcode.

2. Read `src/locales/en-US/grafana-pathfinder-app.json` as the canonical key tree.

3. Confirm working tree is clean for `src/locales/`. If not, abort (translators may have in-progress work).

### Phase 1 — Audit each non-English locale

For each locale in the parser config (excluding `en-US`):

1. Read `src/locales/<locale>/grafana-pathfinder-app.json`. If the file does not exist, treat as "all keys missing" (and create the file in Phase 2).

2. Recursively walk the en-US key tree. For each leaf key in en-US:
   - **Present + non-empty in locale** → filled
   - **Present + empty string in locale** → empty stub (intentional, fine)
   - **Absent from locale** → missing (will be stubbed in Phase 2)

3. Walk the locale's tree. For each leaf key:
   - **Absent from en-US** → stale (flag for human review; never auto-delete)

4. Record counts per locale:

   ```
   { filled, empty_existing, missing, stale, total_canonical }
   ```

### Phase 2 — Stub missing keys

For each locale with `missing > 0`:

1. Read the current file (or start with an empty object if absent).

2. For each missing key path (e.g., `contextPanel.userProfileBar.nameCardRole`):
   - Navigate to the parent object, creating intermediate objects as needed.
   - Add the key with value `""` (empty string).

3. **Sort all keys alphabetically** within each nested object. This matches `i18next-parser`'s output. Do not change the structure beyond inserting the new keys and sorting.

4. Preserve existing values byte-for-byte (apart from the alphabetical reordering, which is non-destructive).

5. Write the file back.

### Phase 3 — Stale-key handling

Stale keys (in locale but not in en-US) are **not auto-deleted**. They may be:

- Genuinely stale (translation for a feature that was removed) → human should delete
- Pending an upstream merge that adds the key back → human should keep

Flag stale keys in the gap report (Phase 5). Do not modify the file.

### Phase 4 — Validate

After all locale edits:

1. **Prettier**:

   ```
   npm run prettier
   ```

   Confirm only `src/locales/*/grafana-pathfinder-app.json` files were touched:

   ```
   git diff --name-only
   ```

   If anything else changed, abort and revert.

2. **i18n-extract**:

   ```
   npm run i18n-extract
   ```

   The parser config has `failOnWarnings: true`. If the run fails, surface the warning and abort.

3. **JSON sanity**:

   ```
   for f in src/locales/*/grafana-pathfinder-app.json; do
     jq empty "$f" || echo "BROKEN: $f"
   done
   ```

   Each file must parse. If any fail, abort.

### Phase 5 — Report

Emit a gap report and commit:

```
## i18n gap report — <date>

Canonical (en-US): N keys

| Locale | Filled | Empty stubs | Missing → stubbed | Stale (flagged) |
| ------ | ------ | ----------- | ----------------- | --------------- |
| de-DE  | 86     | 0           | 5                 | 0               |
| fr-FR  | 91     | 0           | 0                 | 0               |
| ...    |        |             |                   |                 |

### Newly stubbed keys per locale

- de-DE:
  - contextPanel.userProfileBar.nameCardRole
  - contextPanel.userProfileBar.notificationToastPrompt
  - ...

### Stale keys (review for removal)

- it-IT:
  - oldFeature.deprecatedButton
- ...

### Locales unchanged

- fr-FR, es-ES, pt-PT, pt-BR, ja-JP (no missing keys)
```

Then commit:

```
git add src/locales/*/grafana-pathfinder-app.json
git commit -m "chore(i18n): stub missing keys across locales"
```

**Do not push.** The user reviews and pushes.

## Reuses

- `src/locales/i18next-parser.config.js` — canonical locale list + extraction config.
- `npm run i18n-extract` — validates the result.
- `npm run prettier` — formatting.

## Integration

- **Standalone**: maintainer runs `/i18n-sync` periodically (e.g., after a release that added new English strings).
- **From `/release-prep`** (optional): can be invoked as a pre-release step to ensure non-English locales aren't shipping with new keys silently fall-back-only.
- **CI augmentation**: a future CI gate could check that every locale has the same key set as en-US. This skill produces the artifact that would satisfy that gate.

## When to exit cleanly without making changes

- All locales already have the en-US key set in full and no stale keys exist — exit with "All 21 locales in sync with en-US. Nothing to do."
- `src/locales/en-US/grafana-pathfinder-app.json` does not exist — exit with an error; canonical source missing.
- The parser config file is missing — exit with an error.

## Context window management

- Phase 0: read 2 small files (parser config, en-US JSON).
- Phase 1: read each locale file (~50-200 lines each, 20 locales) — bounded to ~4-5k tokens total.
- Phase 2: in-memory edits.
- Phase 3: in-memory flag.
- Phase 4: stream prettier + extract output.
- Phase 5: render report + commit.

Total context per run: well under 20k tokens.

## Expected invocation patterns

- **Post-feature**: after a feature lands that added new `t('...', 'default')` calls and `i18n-extract` populated en-US, run `/i18n-sync` to propagate the keys (as empty stubs) into the other locales.
- **Pre-release**: maintainer runs `/i18n-sync` as part of release prep to ensure the shipping snapshot is in sync.
- **Translator handoff**: maintainer runs `/i18n-sync` before sending the translation files to translators so they have the canonical key set.

## What this skill does NOT do

- Translate English text into other languages (use a translation service, not this skill).
- Delete stale keys (humans review and remove).
- Modify `en-US/grafana-pathfinder-app.json` (canonical source — only changes via `npm run i18n-extract`).
- Change `i18next-parser.config.js` (config is owned elsewhere).
- Validate translations for accuracy (out of scope).

## Behavior of empty stub values at runtime

The repo uses `@grafana/i18n` which is built on i18next. When a key is requested via:

```typescript
t('contextPanel.start', 'Start');
```

and the active locale has `contextPanel.start: ""`, i18next falls through to either the next fallback locale or — if no fallback resolves — the second argument to `t()` (the en-US default). The empty-string sentinel is intentional and matches the runtime expectation. No user sees "" — they see the en-US default if their translation is missing.

This is **why the skill stubs with `""` rather than copying the English text**: copying English would prevent the fallback from finding the up-to-date default if the English source ever changed (e.g., a typo fix). Empty stubs keep the locale's intent ("not yet translated") explicit.

## Worked example

Initial state (de-DE missing 3 keys present in en-US):

```json
// src/locales/de-DE/grafana-pathfinder-app.json
{
  "contextPanel": {
    "categoryDocsPage": "Docs-Seite",
    "categoryLearningJourney": "Lernpfad"
  }
}
```

```json
// src/locales/en-US/grafana-pathfinder-app.json (canonical)
{
  "contextPanel": {
    "categoryDocsPage": "Docs page",
    "categoryInteractiveGuide": "Interactive guide",
    "categoryLearningJourney": "Learning path",
    "resume": "Resume",
    "start": "Start"
  }
}
```

After `/i18n-sync`:

```json
// src/locales/de-DE/grafana-pathfinder-app.json
{
  "contextPanel": {
    "categoryDocsPage": "Docs-Seite",
    "categoryInteractiveGuide": "",
    "categoryLearningJourney": "Lernpfad",
    "resume": "",
    "start": ""
  }
}
```

Report:

```
## i18n gap report — 2026-05-11

Canonical (en-US): 5 keys

| Locale | Filled | Empty stubs | Missing → stubbed | Stale |
| ------ | ------ | ----------- | ----------------- | ----- |
| de-DE  | 2      | 0           | 3                 | 0     |

### Newly stubbed keys per locale

- de-DE:
  - contextPanel.categoryInteractiveGuide
  - contextPanel.resume
  - contextPanel.start

Committed: chore(i18n): stub missing keys across locales
```
