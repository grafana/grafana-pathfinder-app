# Manual Verification Guide: JSON Loading Infrastructure (Milestone L3-1B)

This guide shows how to manually test the `bundled:e2e-test` JSON loading infrastructure implemented in Phase 1.

---

## Prerequisites

- Grafana instance running (localhost:3000 recommended)
- Pathfinder plugin installed and enabled
- Browser DevTools open

---

## Test 1: Basic JSON Loading

**Goal**: Verify that JSON guides can be loaded from localStorage

### Steps:

1. **Open Grafana in browser**

   ```
   http://localhost:3000
   ```

2. **Open Browser DevTools Console** (F12 or Cmd+Option+I)

3. **Inject a simple test guide into localStorage**:

   ```javascript
   const testGuide = {
     id: 'test-guide-1',
     title: 'Manual Test Guide',
     blocks: [
       {
         type: 'markdown',
         content: '# Test Guide\n\nThis guide was loaded from localStorage!',
       },
       {
         type: 'interactive',
         sectionId: 'test-section',
         title: 'Test Section',
         steps: [
           {
             stepId: 'step-1',
             targetAction: 'noop',
             description: 'This is a test step that auto-completes',
           },
         ],
       },
     ],
   };

   localStorage.setItem('grafana-pathfinder-app-e2e-test-guide', JSON.stringify(testGuide));

   console.log('Test guide injected!');
   ```

4. **Open the test guide**:

   ```javascript
   // Trigger the docs panel to open the E2E test guide
   document.dispatchEvent(
     new CustomEvent('pathfinder-auto-open-docs', {
       detail: {
         url: 'bundled:e2e-test',
         title: 'E2E Test Guide',
       },
     })
   );
   ```

5. **Verify the guide renders**:
   - Docs panel should open
   - Title should be "Manual Test Guide"
   - Markdown content should render
   - Interactive section should display

---

## Test 2: Error Handling (No Content)

**Goal**: Verify clear error message when no test content available

### Steps:

1. **Clear the localStorage key**:

   ```javascript
   localStorage.removeItem('grafana-pathfinder-app-e2e-test-guide');
   ```

2. **Try to open the test guide**:

   ```javascript
   document.dispatchEvent(
     new CustomEvent('pathfinder-auto-open-docs', {
       detail: {
         url: 'bundled:e2e-test',
         title: 'E2E Test Guide',
       },
     })
   );
   ```

3. **Verify error message**:
   - Docs panel should show error state
   - Error message should say: "No E2E test content available. The E2E runner must inject JSON into localStorage first."

---

## Test 3: Complex Interactive Guide

**Goal**: Verify that interactive steps with requirements work

### Steps:

1. **Inject a guide with requirements**:

   ```javascript
   const complexGuide = {
     id: 'complex-test',
     title: 'Complex Test Guide',
     blocks: [
       {
         type: 'interactive',
         sectionId: 'navigation-test',
         title: 'Navigation Test',
         steps: [
           {
             stepId: 'nav-step-1',
             targetAction: 'navigate',
             refTarget: '/dashboards',
             description: 'Navigate to dashboards page',
           },
           {
             stepId: 'nav-step-2',
             targetAction: 'highlight',
             refTarget: "[data-testid='data-testid NavToolbar search-button']",
             description: 'Highlight the search button',
             requirements: 'on-page:/dashboards',
           },
         ],
       },
     ],
   };

   localStorage.setItem('grafana-pathfinder-app-e2e-test-guide', JSON.stringify(complexGuide));

   console.log('Complex guide injected!');
   ```

2. **Open the complex guide**:

   ```javascript
   document.dispatchEvent(
     new CustomEvent('pathfinder-auto-open-docs', {
       detail: {
         url: 'bundled:e2e-test',
         title: 'Complex Test Guide',
       },
     })
   );
   ```

3. **Verify interactive features**:
   - First step should have "Do it" button
   - Clicking "Do it" should navigate to /dashboards
   - Second step should check requirements (on-page:/dashboards)
   - Second step's "Do it" button should be enabled after navigation

---

## Test 4: Pre-Completed Steps (noop)

**Goal**: Verify that noop steps auto-complete (U1 finding)

### Steps:

1. **Inject guide with noop step**:

   ```javascript
   const noopGuide = {
     id: 'noop-test',
     title: 'Noop Test Guide',
     blocks: [
       {
         type: 'interactive',
         sectionId: 'noop-section',
         title: 'Auto-Complete Test',
         steps: [
           {
             stepId: 'noop-1',
             targetAction: 'noop',
             description: 'This step should auto-complete (no button)',
           },
           {
             stepId: 'normal-1',
             targetAction: 'highlight',
             refTarget: 'button',
             description: 'This step has a Do it button',
           },
         ],
       },
     ],
   };

   localStorage.setItem('grafana-pathfinder-app-e2e-test-guide', JSON.stringify(noopGuide));
   ```

2. **Open the guide**:

   ```javascript
   document.dispatchEvent(
     new CustomEvent('pathfinder-auto-open-docs', {
       detail: {
         url: 'bundled:e2e-test',
         title: 'Noop Test Guide',
       },
     })
   );
   ```

3. **Verify behavior**:
   - First step (noop) should NOT have a "Do it" button
   - First step should show completed indicator immediately
   - Second step should become eligible automatically
   - Second step should have a "Do it" button

---

## Test 5: Cleanup

**Goal**: Verify localStorage can be cleared

### Steps:

1. **Clear the test guide**:

   ```javascript
   localStorage.removeItem('grafana-pathfinder-app-e2e-test-guide');
   console.log('Test guide cleared');
   ```

2. **Verify it's gone**:
   ```javascript
   const content = localStorage.getItem('grafana-pathfinder-app-e2e-test-guide');
   console.log('Content after clear:', content); // Should be null
   ```

---

## Expected File Locations

The manual tests above verify code in:

1. **src/lib/user-storage.ts** (line 100)

   ```typescript
   E2E_TEST_GUIDE: 'grafana-pathfinder-app-e2e-test-guide';
   ```

2. **src/docs-retrieval/content-fetcher.ts** (lines 308-346)
   ```typescript
   if (contentId === 'e2e-test') {
     const testContent = localStorage.getItem(StorageKeys.E2E_TEST_GUIDE);
     // ... handler logic
   }
   ```

---

## Troubleshooting

### Issue: "Guide not loading"

**Check**:

1. Is localStorage item set correctly?
   ```javascript
   localStorage.getItem('grafana-pathfinder-app-e2e-test-guide');
   ```
2. Is the JSON valid?
   ```javascript
   JSON.parse(localStorage.getItem('grafana-pathfinder-app-e2e-test-guide'));
   ```
3. Check browser console for errors

### Issue: "Error message shown"

**This is expected** if:

- localStorage key is not set
- JSON is invalid
- Guide structure doesn't match schema

**This is the error handling working correctly** (see Test 2)

### Issue: "Interactive steps not rendering"

**Check**:

- Does the guide have a valid `interactive` block?
- Does the section have a `sectionId`?
- Do steps have `stepId` and `targetAction`?

---

## Success Criteria

✅ Test 1: Guide loads and renders from localStorage
✅ Test 2: Clear error message when no content
✅ Test 3: Interactive steps with requirements work
✅ Test 4: Noop steps auto-complete (no "Do it" button)
✅ Test 5: localStorage can be cleared

**If all tests pass**: JSON loading infrastructure is working correctly ✅

---

## Next Steps

Once manual verification passes:

1. Proceed to **L3 Phase 2: CLI Scaffolding**
2. Create `src/cli/commands/e2e.ts` (Milestone L3-2A)
3. Implement Playwright integration (Milestone L3-2B)

**No blockers from L3 Phase 1** - ready to build! 🚀
