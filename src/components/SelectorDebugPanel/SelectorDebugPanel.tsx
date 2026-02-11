import React, { useState, useCallback, lazy, Suspense, useEffect } from 'react';
import { Button, Badge, Icon, useStyles2, Stack } from '@grafana/ui';
import { getDebugPanelStyles } from './debug-panel.styles';
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
const STORAGE_KEY_BLOCK_EDITOR = 'pathfinder-devtools-block-editor-expanded';
const STORAGE_KEY_PR_TESTER = 'pathfinder-devtools-pr-tester-expanded';
const STORAGE_KEY_URL_TESTER = 'pathfinder-devtools-url-tester-expanded';

/**
 * Get initial expansion state from localStorage with fallback
 */
function getInitialExpanded(storageKey: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
    // Ignore localStorage errors
  }
  return defaultValue;
}

export interface SelectorDebugPanelProps {
  onOpenDocsPage?: (url: string, title: string) => void;
  onOpenLearningJourney?: (url: string, title: string) => void;
}

export function SelectorDebugPanel({ onOpenDocsPage, onOpenLearningJourney }: SelectorDebugPanelProps = {}) {
  const styles = useStyles2(getDebugPanelStyles);

  // Section expansion state - initialize from localStorage
  const [blockEditorExpanded, setBlockEditorExpanded] = useState(() =>
    getInitialExpanded(STORAGE_KEY_BLOCK_EDITOR, true)
  );
  const [prTesterExpanded, setPrTesterExpanded] = useState(() => getInitialExpanded(STORAGE_KEY_PR_TESTER, false));
  const [UrlTesterExpanded, setUrlTesterExpanded] = useState(() => getInitialExpanded(STORAGE_KEY_URL_TESTER, false));

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
      localStorage.setItem(STORAGE_KEY_URL_TESTER, String(UrlTesterExpanded));
    } catch {
      // Ignore localStorage errors
    }
  }, [UrlTesterExpanded]);

  // Handle leaving dev mode
  const handleLeaveDevMode = useCallback(async () => {
    try {
      // Get current user ID and user list from global config
      const globalConfig = (window as any).__pathfinderPluginConfig;
      const currentUserId = (window as any).grafanaBootData?.user?.id;
      const currentUserIds = globalConfig?.devModeUserIds ?? [];

      // Import dynamically to avoid circular dependency
      const { disableDevModeForUser } = await import('../../utils/dev-mode');

      if (currentUserId) {
        await disableDevModeForUser(currentUserId, currentUserIds);
      } else {
        // Fallback: disable for all if can't determine user
        const { disableDevMode } = await import('../../utils/dev-mode');
        await disableDevMode();
      }

      window.location.reload();
    } catch (error) {
      console.error('Failed to disable dev mode:', error);

      // Show user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Failed to disable dev mode. Please try again.';
      alert(errorMessage);
    }
  }, []);

  return (
    <div className={styles.container} data-devtools-panel="true">
      <div className={styles.header}>
        <Stack direction="row" gap={1} alignItems="center">
          <Icon name="bug" size="lg" />
          <Badge text="Dev Mode" color="orange" className={styles.badge} />
        </Stack>
        <Button variant="secondary" size="sm" onClick={handleLeaveDevMode} icon="times" fill="outline">
          Leave dev mode
        </Button>
      </div>

      {/* Block Editor */}
      <div className={styles.section}>
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

      {/* PR tester */}
      <div className={styles.section}>
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

      {/* URL tester */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setUrlTesterExpanded(!UrlTesterExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="external-link-alt" />
            <h4 className={styles.sectionTitle}>URL tester</h4>
          </Stack>
          <Icon name={UrlTesterExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {UrlTesterExpanded && onOpenDocsPage && (
          <div className={styles.sectionContent}>
            <UrlTester onOpenDocsPage={onOpenDocsPage} />
          </div>
        )}
      </div>
    </div>
  );
}
