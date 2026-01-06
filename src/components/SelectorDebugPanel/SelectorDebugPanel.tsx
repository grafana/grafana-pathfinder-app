import React, { useState, useCallback, lazy, Suspense } from 'react';
import { Button, Badge, Icon, useStyles2, Stack } from '@grafana/ui';
import { getDebugPanelStyles } from './debug-panel.styles';
import { UrlTester } from 'components/UrlTester';
import { SkeletonLoader } from '../SkeletonLoader';

// Lazy load BlockEditor to keep it out of main bundle when not needed
const BlockEditor = lazy(() =>
  import('../block-editor').then((module) => ({
    default: module.BlockEditor,
  }))
);

export interface SelectorDebugPanelProps {
  onOpenDocsPage?: (url: string, title: string) => void;
}

export function SelectorDebugPanel({ onOpenDocsPage }: SelectorDebugPanelProps = {}) {
  const styles = useStyles2(getDebugPanelStyles);

  // Section expansion state
  const [blockEditorExpanded, setBlockEditorExpanded] = useState(true); // Main authoring tool - expanded by default
  const [UrlTesterExpanded, setUrlTesterExpanded] = useState(false);

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
