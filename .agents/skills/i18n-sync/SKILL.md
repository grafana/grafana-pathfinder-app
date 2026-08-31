---
name: i18n-sync
description: Detect translation gaps across the 21 locales under `src/locales/`. For keys present in `en-US` but missing from another locale, add the key with an empty string value (matching the runtime fallback to the en-US default). Emit a gap report (filled / empty / stale counts per locale + the list of newly stubbed keys). Never invents translations; translators fill the empty stubs later.
---

Read `.cursor/skills/i18n-sync/SKILL.md` and follow it exactly.
