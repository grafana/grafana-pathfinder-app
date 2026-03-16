import React, { useState, useCallback, lazy, Suspense, useEffect } from 'react';
import { Button, Badge, Icon, useStyles2, Stack } from '@grafana/ui';
import { getDebugPanelStyles } from './debug-panel.styles';
import { testIds } from '../../constants/testIds';
import { UrlTester } from 'components/UrlTester';
import { PrTester } from 'components/PrTester';
import { SkeletonLoader } from '../SkeletonLoader';

// Lazy load BlockEditor to keep it out of main bundle when not needed
const BlockEditor = lazy(() =>
  import('../block-editor').then((module) => ({
    default: module.BlockEditor,
  }))
);

// localStorage keys for section expansion state
const STORAGE_KEY_BLOCK_EDITOR = 'pathfinder-editor-block-editor-expanded';
const STORAGE_KEY_PR_TESTER = 'pathfinder-editor-pr-tester-expanded';
const STORAGE_KEY_URL_TESTER = 'pathfinder-editor-url-tester-expanded';

// Old keys for backward-compat migration
const OLD_STORAGE_KEY_BLOCK_EDITOR = 'pathfinder-devtools-block-editor-expanded';
const OLD_STORAGE_KEY_PR_TESTER = 'pathfinder-devtools-pr-tester-expanded';
const OLD_STORAGE_KEY_URL_TESTER = 'pathfinder-devtools-url-tester-expanded';

/**
 * Get initial expansion state from localStorage with fallback.
 * Migrates from old devtools-prefixed keys on first read.
 */
function getInitialExpanded(storageKey: string, oldStorageKey: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      return stored === 'true';
    }

    // Migrate from old key if present
    const oldStored = localStorage.getItem(oldStorageKey);
    if (oldStored !== null) {
      localStorage.setItem(storageKey, oldStored);
      localStorage.removeItem(oldStorageKey);
      return oldStored === 'true';
    }
  } catch {
    // Ignore localStorage errors
  }
  return defaultValue;
}

export interface SelectorDebugPanelProps {
  isDevMode?: boolean;
  onOpenDocsPage?: (url: string, title: string) => void;
  onOpenLearningJourney?: (url: string, title: string) => void;
}

export function SelectorDebugPanel({
  isDevMode = false,
  onOpenDocsPage,
  onOpenLearningJourney,
}: SelectorDebugPanelProps = {}) {
  const styles = useStyles2(getDebugPanelStyles);

  // Section expansion state - initialize from localStorage (with migration)
  const [blockEditorExpanded, setBlockEditorExpanded] = useState(() =>
    getInitialExpanded(STORAGE_KEY_BLOCK_EDITOR, OLD_STORAGE_KEY_BLOCK_EDITOR, true)
  );
  const [prTesterExpanded, setPrTesterExpanded] = useState(() =>
    getInitialExpanded(STORAGE_KEY_PR_TESTER, OLD_STORAGE_KEY_PR_TESTER, false)
  );
  const [urlTesterExpanded, setUrlTesterExpanded] = useState(() =>
    getInitialExpanded(STORAGE_KEY_URL_TESTER, OLD_STORAGE_KEY_URL_TESTER, false)
  );

  // Persist block editor expansion state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_BLOCK_EDITOR, String(blockEditorExpanded));
    } catch {
      // Ignore localStorage errors
    }
  }, [blockEditorExpanded]);

  // Persist PR tester expansion state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PR_TESTER, String(prTesterExpanded));
    } catch {
      // Ignore localStorage errors
    }
  }, [prTesterExpanded]);

  // Persist URL tester expansion state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_URL_TESTER, String(urlTesterExpanded));
    } catch {
      // Ignore localStorage errors
    }
  }, [urlTesterExpanded]);

  // Handle leaving dev mode
  const handleLeaveDevMode = useCallback(async () => {
    try {
      const globalConfig = (window as any).__pathfinderPluginConfig;
      const currentUserId = (window as any).grafanaBootData?.user?.id;
      const currentUserIds = globalConfig?.devModeUserIds ?? [];

      const { disableDevModeForUser } = await import('../../utils/dev-mode');

      if (currentUserId) {
        await disableDevModeForUser(currentUserId, currentUserIds);
      } else {
        const { disableDevMode } = await import('../../utils/dev-mode');
        await disableDevMode();
      }

      window.location.reload();
    } catch (error) {
      console.error('Failed to disable dev mode:', error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to disable dev mode. Please try again.';
      alert(errorMessage);
    }
  }, []);

  return (
    <div className={styles.container} data-devtools-panel="true" data-testid={testIds.editorPanel.container}>
      {/* Dev mode header - only shown when dev mode is active */}
      {isDevMode && (
        <div className={styles.header} data-testid={testIds.editorPanel.devModeHeader}>
          <Stack direction="row" gap={1} alignItems="center">
            <Badge text="Dev mode" color="orange" className={styles.badge} />
          </Stack>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleLeaveDevMode}
            icon="times"
            fill="outline"
            data-testid={testIds.editorPanel.leaveDevModeButton}
          >
            Leave dev mode
          </Button>
        </div>
      )}

      {/* Block Editor - always visible */}
      <div className={styles.section} data-testid={testIds.editorPanel.blockEditorSection}>
        <div className={styles.sectionHeader} onClick={() => setBlockEditorExpanded(!blockEditorExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="edit" />
            <h4 className={styles.sectionTitle}>Interactive guide editor</h4>
          </Stack>
          <Icon name={blockEditorExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {blockEditorExpanded && (
          <div className={styles.sectionContent}>
            <Suspense fallback={<SkeletonLoader type="recommendations" />}>
              <BlockEditor />
            </Suspense>
          </div>
        )}
      </div>

      {/* PR tester - dev mode only */}
      {isDevMode && (
        <div className={styles.section} data-testid={testIds.editorPanel.prTesterSection}>
          <div className={styles.sectionHeader} onClick={() => setPrTesterExpanded(!prTesterExpanded)}>
            <Stack direction="row" gap={1} alignItems="center">
              <Icon name="code-branch" />
              <h4 className={styles.sectionTitle}>PR tester</h4>
            </Stack>
            <Icon name={prTesterExpanded ? 'angle-up' : 'angle-down'} />
          </div>
          {prTesterExpanded && onOpenDocsPage && (
            <div className={styles.sectionContent}>
              <PrTester onOpenDocsPage={onOpenDocsPage} onOpenLearningJourney={onOpenLearningJourney} />
            </div>
          )}
        </div>
      )}

      {/* URL tester - dev mode only */}
      {isDevMode && (
        <div className={styles.section} data-testid={testIds.editorPanel.urlTesterSection}>
          <div className={styles.sectionHeader} onClick={() => setUrlTesterExpanded(!urlTesterExpanded)}>
            <Stack direction="row" gap={1} alignItems="center">
              <Icon name="external-link-alt" />
              <h4 className={styles.sectionTitle}>URL tester</h4>
            </Stack>
            <Icon name={urlTesterExpanded ? 'angle-up' : 'angle-down'} />
          </div>
          {urlTesterExpanded && onOpenDocsPage && (
            <div className={styles.sectionContent}>
              <UrlTester onOpenDocsPage={onOpenDocsPage} onOpenLearningJourney={onOpenLearningJourney} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
