import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';
import {
  openBlockEditor,
  createMarkdownBlock,
  createSectionBlock,
  copyGuideJson,
  waitForAutoSave,
  clearBlockEditorState,
  waitForRecordingOverlay,
  stopRecording,
  waitForGrafanaReady,
  clickBlockAction,
  confirmDeleteBlock,
  clickAddBlockInSection,
} from './helpers/block-editor.helpers';
import { TIMEOUTS } from './constants';

/**
 * Block Editor E2E Tests
 *
 * These tests verify the block editor functionality in dev mode.
 * Dev mode must be enabled via plugin settings API before tests run.
 *
 * Tests run serially to prevent race conditions from parallel execution
 * with shared Grafana dev mode state.
 */

test.describe.serial('Block Editor', () => {
  // Enable dev mode before tests run
  test.beforeAll(async ({ request }) => {
    // Enable dev mode via plugin settings API
    // Admin user ID is typically 1 in fresh Grafana instances
    await request.post('/api/plugins/grafana-pathfinder-app/settings', {
      data: {
        enabled: true,
        jsonData: {
          devMode: true,
          devModeUserIds: [1],
        },
      },
    });
  });

  // Clean up after tests
  test.afterAll(async ({ request }) => {
    await request.post('/api/plugins/grafana-pathfinder-app/settings', {
      data: {
        enabled: true,
        jsonData: {
          devMode: false,
          devModeUserIds: [],
        },
      },
    });
  });

  // Clear localStorage before each test to ensure isolation
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearBlockEditorState(page);
  });

  test('should open block editor via dev tools tab', async ({ page }) => {
    // Open dev tools panel using helper function
    await openBlockEditor(page);

    // Wait for dev tools content to load
    const devToolsContent = page.getByTestId('devtools-tab-content');
    await expect(devToolsContent).toBeVisible();

    // Verify the block editor is visible
    const blockEditor = page.getByTestId('block-editor');
    await expect(blockEditor).toBeVisible();

    // The block editor should show the block palette in the footer
    const blockPalette = page.getByTestId('block-palette');
    await expect(blockPalette).toBeVisible();
  });

  test('should toggle between edit and preview modes', async ({ page }) => {
    await openBlockEditor(page);

    // Find the view mode toggle
    const viewModeToggle = page.getByTestId('view-mode-toggle');
    await expect(viewModeToggle).toBeVisible();

    // Click preview mode button (eye icon)
    const previewButton = viewModeToggle.locator('button[aria-label="Preview"]');
    await previewButton.click();

    // Block palette should be hidden in preview mode
    const blockPalette = page.getByTestId('block-palette');
    await expect(blockPalette).not.toBeVisible();

    // Click edit mode button (pen icon) to go back
    const editButton = viewModeToggle.locator('button[aria-label="Edit blocks"]');
    await editButton.click();

    // Block palette should be visible again
    await expect(blockPalette).toBeVisible();
  });

  test('should copy guide JSON to clipboard', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await openBlockEditor(page);

    // Copy JSON and verify structure
    const guide = await copyGuideJson(page);

    // Verify it's a valid guide structure
    expect(guide).toHaveProperty('id');
    expect(guide).toHaveProperty('title');
    expect(guide).toHaveProperty('blocks');
    expect(Array.isArray(guide.blocks)).toBe(true);
  });

  test('should create a markdown block with canary text', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await openBlockEditor(page);

    // Create markdown block using helper
    await createMarkdownBlock(page, 'canary');

    // Copy the guide JSON to clipboard
    const guide = await copyGuideJson(page);

    // Verify the guide has a markdown block with canary content
    const blocks = guide.blocks as Array<{ type: string; content?: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('markdown');
    expect(blocks[0].content).toBe('canary');
  });

  test('should persist blocks across page refresh', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const uniqueContent = `persistence-test-${Date.now()}`;

    await openBlockEditor(page);

    // Create a markdown block with unique content
    await createMarkdownBlock(page, uniqueContent);

    // Wait for auto-save using polling assertion (replaces waitForTimeout)
    await waitForAutoSave(page, uniqueContent);

    // Verify the block was saved to localStorage
    const savedStateBefore = await page.evaluate(() => {
      return localStorage.getItem('pathfinder-block-editor-state');
    });
    expect(savedStateBefore).not.toBeNull();
    expect(savedStateBefore).toContain(uniqueContent);

    // Navigate to a different page to test persistence survives navigation
    await page.goto('/dashboards');
    await waitForGrafanaReady(page);

    // Verify localStorage persisted across navigation
    const savedStateAfter = await page.evaluate(() => {
      return localStorage.getItem('pathfinder-block-editor-state');
    });
    expect(savedStateAfter).not.toBeNull();
    expect(savedStateAfter).toContain(uniqueContent);

    // Parse and verify the persisted block structure
    // Storage format: { guide: JsonGuide, blockIds?: string[], savedAt, version }
    // JsonGuide.blocks contains direct JsonBlock objects (not wrapped in EditorBlock)
    const persistedState = JSON.parse(savedStateAfter!);
    expect(persistedState.guide).toBeDefined();
    expect(persistedState.guide.blocks).toBeDefined();
    expect(persistedState.guide.blocks.length).toBeGreaterThan(0);

    const persistedBlock = persistedState.guide.blocks.find(
      (b: { type: string; content?: string }) => b.type === 'markdown' && b.content === uniqueContent
    );
    expect(persistedBlock).toBeDefined();
  });

  test('should record interactions into a section block', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await openBlockEditor(page);

    // Create a section block with recording
    await createSectionBlock(page, 'Recording Test Section', { startRecording: true });

    // Wait for the recording overlay to appear
    await waitForRecordingOverlay(page);

    // Get reference to recording overlay for later verification
    const recordingOverlay = page.locator('[data-record-overlay="banner"]');

    // Click on a stable Grafana UI element (the Grafana logo/home link)
    // Recording uses capture-phase listeners that may not receive
    // coordinate-based clicks. dispatchEvent ensures the event
    // reaches the capture listener regardless of overlapping elements.
    // Note: This tests the recording system's event handling, not
    // pixel-perfect user interaction.
    const homeLink = page.locator('a[href="/"]').first();
    await homeLink.dispatchEvent('click');

    // Wait for the step to be recorded (polling assertion instead of fixed timeout)
    // The recording overlay shows step count like "1 block" or "2 blocks"
    await expect(recordingOverlay).toContainText(/[1-9]\d* block/);

    // Stop recording
    await stopRecording(page);

    // Copy JSON to clipboard
    const guide = await copyGuideJson(page);

    const blocks = guide.blocks as Array<{
      type: string;
      title?: string;
      blocks?: Array<{ type: string }>;
    }>;

    const sectionBlock = blocks.find((b) => b.type === 'section' && b.title === 'Recording Test Section');
    expect(sectionBlock).toBeDefined();
    expect(sectionBlock!.blocks!.length).toBeGreaterThan(0);

    // Recorded blocks should be interactive or multistep type
    const nestedBlock = sectionBlock!.blocks![0];
    expect(['interactive', 'multistep']).toContain(nestedBlock.type);
  });

  test('should create nested blocks inside a section via UI', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await openBlockEditor(page);

    // Create a section block (without recording)
    await createSectionBlock(page, 'Nested Test Section');

    // Click add block button within the section using helper (uses testIds)
    await clickAddBlockInSection(page);

    // Wait for block type modal
    const nestedBlockTypeModal = page.getByTestId(testIds.blockEditor.addBlockModal);
    await expect(nestedBlockTypeModal).toBeVisible();

    // Select Markdown block type
    await page.getByTestId(testIds.blockEditor.blockTypeButton('markdown')).click();

    // Fill in the markdown form
    const formModal = page.getByTestId(testIds.blockEditor.blockFormModal);
    await expect(formModal).toBeVisible();

    await page.getByTestId(testIds.blockEditor.rawMarkdownTab).click();
    await page.getByTestId(testIds.blockEditor.markdownTextarea).fill('nested-canary');
    await page.getByTestId(testIds.blockEditor.submitButton).click();

    await expect(formModal).not.toBeVisible();

    // Copy JSON to clipboard
    const guide = await copyGuideJson(page);

    const blocks = guide.blocks as Array<{
      type: string;
      title?: string;
      blocks?: Array<{ type: string; content?: string }>;
    }>;

    // Root should have 1 section block
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('section');
    expect(blocks[0].title).toBe('Nested Test Section');

    // Section's blocks array should contain 1 markdown block
    expect(blocks[0].blocks).toHaveLength(1);
    expect(blocks[0].blocks![0].type).toBe('markdown');
    expect(blocks[0].blocks![0].content).toBe('nested-canary');
  });

  test('should edit an existing block', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await openBlockEditor(page);

    // Create initial block with original content
    await createMarkdownBlock(page, 'original-content');

    // Wait for the block to be fully rendered
    const blockContent = page.getByTestId('block-editor-content');
    await expect(blockContent.locator('text=original-content')).toBeVisible();

    // Click edit button using helper (handles scroll/hover for dnd-kit overlays)
    await clickBlockAction(page, 'block-edit-button');

    // Wait for edit modal to appear
    const editModal = page.getByTestId(testIds.blockEditor.blockFormModal);
    await expect(editModal).toBeVisible({ timeout: TIMEOUTS.MODAL_VISIBLE });

    // Switch to Raw Markdown mode and modify content
    await page.getByTestId(testIds.blockEditor.rawMarkdownTab).click();
    const textarea = page.getByTestId(testIds.blockEditor.markdownTextarea);
    await textarea.clear();
    await textarea.fill('modified-content');

    // Submit the edit (button says "Update block" when editing)
    await page.getByTestId(testIds.blockEditor.submitButton).click();
    await expect(editModal).not.toBeVisible();

    // Verify JSON reflects the edit
    const guide = await copyGuideJson(page);
    const blocks = guide.blocks as Array<{ type: string; content?: string }>;

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('markdown');
    expect(blocks[0].content).toBe('modified-content');
  });

  test('should delete a block', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await openBlockEditor(page);

    // Create two blocks to verify correct one is deleted
    for (const content of ['block-one', 'block-two']) {
      await createMarkdownBlock(page, content);
    }

    // Verify two blocks exist
    let guide = await copyGuideJson(page);
    let blocks = guide.blocks as Array<{ type: string; content?: string }>;
    expect(blocks).toHaveLength(2);

    // Click delete button on the first block using helper (handles scroll/hover for dnd-kit overlays)
    await clickBlockAction(page, 'block-delete-button');

    // Confirm deletion using helper (locates modal by role and text)
    await confirmDeleteBlock(page);

    // Verify only one block remains with correct content
    guide = await copyGuideJson(page);
    blocks = guide.blocks as Array<{ type: string; content?: string }>;

    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('block-two');
  });
});
