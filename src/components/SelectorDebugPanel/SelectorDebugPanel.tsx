import React, { useCallback } from 'react';
import { Button, Badge, Icon, useStyles2, Stack } from '@grafana/ui';
import { getDebugPanelStyles } from './debug-panel.styles';
import { UrlTester } from 'components/UrlTester';
import { PrTester } from 'components/PrTester';
import type { PackageOpenInfo } from 'types/content-panel.types';
import { StorageKeys } from 'lib/storage-keys';
import { usePersistedBoolean } from '../../hooks';

export interface SelectorDebugPanelProps {
  /**
   * Open a docs page or package. When `packageInfo` is supplied (e.g. from
   * the PR tester opening a real path/journey package), the docs panel
   * routes through `fetchPackageContent` so the milestone toolbar and
   * Alt+arrow navigation work without any extra plumbing.
   */
  onOpenDocsPage?: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
  onOpenLearningJourney?: (url: string, title: string) => void;
}

export function SelectorDebugPanel({ onOpenDocsPage, onOpenLearningJourney }: SelectorDebugPanelProps = {}) {
  const styles = useStyles2(getDebugPanelStyles);

  const [prTesterExpanded, setPrTesterExpanded] = usePersistedBoolean(
    StorageKeys.DEVTOOLS_PR_TESTER_EXPANDED
  );
  const [UrlTesterExpanded, setUrlTesterExpanded] = usePersistedBoolean(
    StorageKeys.DEVTOOLS_URL_TESTER_EXPANDED
  );

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
            <PrTester onOpenDocsPage={onOpenDocsPage} />
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
            <UrlTester onOpenDocsPage={onOpenDocsPage} onOpenLearningJourney={onOpenLearningJourney} />
          </div>
        )}
      </div>
    </div>
  );
}
