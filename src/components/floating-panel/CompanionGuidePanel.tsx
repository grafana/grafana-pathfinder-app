import React, { useEffect, useMemo, useState } from 'react';
import { LoadingPlaceholder } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { testIds } from '../../constants/testIds';
import { getConfigWithDefaults } from '../../constants';
import { closeCompanionGuide } from '../../global-state/companion-guide';
import { useGuideProgressState } from '../../hooks';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { useContentReset } from '../docs-panel/hooks';
import { FloatingPanel } from './FloatingPanel';
import { FloatingPanelContent } from './FloatingPanelContent';

export function CompanionGuidePanel({ guide }: { guide: LearningJourneyTab }) {
  const [editorReady, setEditorReady] = useState(() =>
    Boolean(document.querySelector(`[data-testid="${testIds.blockEditor.container}"]`))
  );
  useEffect(() => {
    if (editorReady) {
      return;
    }
    const check = () => {
      if (document.querySelector(`[data-testid="${testIds.blockEditor.container}"]`)) {
        setEditorReady(true);
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, [editorReady]);

  const panel = useMemo(() => {
    const model = new CombinedLearningJourneyPanel(getConfigWithDefaults(window.__pathfinderPluginConfig || {}), {
      persistTabs: false,
    });
    model.setState({ tabs: [{ ...guide }], activeTabId: guide.id });
    return model;
  }, [guide]);
  const { tabs, activeTabId } = panel.useState();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const { hasInteractiveProgress, progressKey } = useGuideProgressState(activeTab);
  const resetGuide = useContentReset({ model: panel });

  return (
    <FloatingPanel title={activeTab?.title ?? guide.title} hasActiveGuide onClose={closeCompanionGuide}>
      {editorReady ? (
        <FloatingPanelContent
          content={activeTab?.content ?? null}
          activeTab={activeTab}
          model={panel}
          pendingAlignment={activeTab?.pendingAlignment}
          onAlignmentConfirm={activeTab ? () => void panel.confirmAlignment(activeTab.id) : undefined}
          onAlignmentCancel={activeTab ? () => panel.dismissAlignment(activeTab.id) : undefined}
          hasInteractiveProgress={hasInteractiveProgress}
          progressKey={progressKey}
          onResetGuide={resetGuide}
        />
      ) : (
        <LoadingPlaceholder text={t('docsPanel.waitingForGuideEditor', 'Waiting for the guide editor')} />
      )}
    </FloatingPanel>
  );
}
