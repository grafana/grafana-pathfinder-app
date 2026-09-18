# Fix sibling path progress wipe on reset

## What does this PR do?

Fixes a critical data loss bug where resetting a learning path incorrectly clears progress for any sibling path whose URL shares its prefix.

**Root cause:** The `resetPath` function uses `startsWith()` to discover completion keys when clearing progress. This causes false positives: resetting `/alerting` also clears `/alerting-advanced` because "alerting-advanced" starts with "alerting".

**The fix:** Replace raw `startsWith` checks with a delimiter-bounded helper `isKeyUnderPrefix(key, prefix)` that requires keys to either exactly match the prefix or be children under `prefix/`. This prevents `/alerting` from matching `/alerting-advanced` while still correctly matching `/alerting` itself and descendants like `/alerting/milestone-1`.

## Linked issue(s)

Closes #1928

## Changes

### New helper function (`src/lib/storage/key-utils.ts`)

Added `isKeyUnderPrefix(key: string, prefix: string)` that returns `true` when:

- `prefix === ''` (empty prefix matches everything, for clear-all operations)
- `key === prefix` (exact match)
- `key.startsWith(prefix + '/')` (child in hierarchy)

This uses `/` as the hierarchy delimiter and prevents sibling collisions.

### Fixed vulnerable call sites

**`src/learning-paths/learning-paths.hook.ts` (lines 539-542)**  
Replaced `startsWith(normalizedUrl)` with `isKeyUnderPrefix(key, normalizedUrl)` in the filters that discover milestone and journey keys for reset.

**`src/lib/user-storage.ts` (line 1500)**  
Replaced `parsed.contentKey.startsWith(contentKeyPrefix)` with `isKeyUnderPrefix(parsed.contentKey, contentKeyPrefix)` in `guideCompletionMarkStorage.clearAllWithPrefix()`.

### Test coverage

**Unit tests (`src/lib/storage/key-utils.test.ts`)**  
Added 9 test cases covering:

- Empty prefix (clear-all semantics)
- Exact match
- Child paths under slash-delimited hierarchy
- **Sibling rejection** — `/alerting` must NOT match `/alerting-advanced` or `/path` match `/pathology` (the bug case)
- Prefix already ending with `/`
- Bundled scheme keys (`bundled:welcome` vs `bundled:welcome-cloud`)
- Full URL keys

**Regression test (`src/learning-paths/reset-path-completion.test.ts`)**  
Added integration test "does NOT clear sibling paths that share a URL prefix (regression test for #1928)" that:

- Seeds progress for both `/alerting` and `/alerting-advanced` paths
- Resets the `/alerting` path
- Verifies `/alerting` and its milestones are cleared
- Verifies `/alerting-advanced` and its milestones remain untouched
- Tests all three vulnerable storage namespaces: `interactiveCompletionStorage`, `journeyCompletionStorage`, `guideCompletionMarkStorage`

## Verification

- ✅ TypeScript compilation passes (`npx tsc --noEmit`)
- ✅ All tests pass (30 tests in affected suites)
- ✅ ESLint passes
- ✅ No migration required — existing storage keys unchanged
- ✅ Fully backward compatible — only changes key matching logic

## Risks and deferred follow-ups

### Known constraints

The helper uses `/` as the hierarchy delimiter. Keys with query strings or fragments don't use `/` as a boundary, but:

- Tests and production code use path-style URLs without query/hash
- No explicit invariant forbids them
- **Deferred:** Document the constraint or add validation (not urgent unless there's evidence of query/hash URLs in production data)

### Related issues

- **#1653, #1586:** No codebase references found. Verify whether these are duplicates of #1928 or separate issues.
- **#1863, #1864:** Collision-safe storage (already merged) — this fix is additive and non-conflicting.

### Future hardening

- **Architecture test or lint rule:** Consider adding an architecture test that fails if `startsWith` is used on completion store keys without the helper, to prevent future regressions. (Or rely on code review.)

## Checklist

- [x] This PR addresses a **single concern** (the sibling path collision bug).
- [x] All commits are signed.
- [x] I've added or updated tests for the change.
- [x] UI text and docs use sentence case (N/A — no UI changes).
- [ ] `npm run check` passes locally — **needs human verification before marking ready-for-review**.
