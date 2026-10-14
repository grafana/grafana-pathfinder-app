import React, { useSyncExternalStore } from 'react';
import { Icon, IconButton, Badge } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { useBooleanFlag } from '../../../utils/openfeature';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { getStyles as getDocsPanelStyles } from '../../../styles/docs-panel.styles';
import { testIds } from '../../../constants/testIds';

type DocsPanelStyles = ReturnType<typeof getDocsPanelStyles>;
import { BROWSE_TAB_ID, RECOMMENDATIONS_TAB_ID, getGuideStripTabs, getTranslatedTitle } from '../utils';
import { TabBarActions } from './TabBarActions';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  tabTypeToContentType,
} from '../../../lib/analytics';
import { getJourneyProgress } from '../../../docs-retrieval';
import {
  getEditorChromeStatus,
  getEditorChromeStatusVersion,
  subscribeEditorChromeStatus,
  editorTabStatusBadge,
  type EditorChromeStatus,
} from '../../block-editor/editor-chrome-status';

export interface DocsPanelTabBarProps {
  styles: DocsPanelStyles;
  tabs: LearningJourneyTab[];
  activeTabId: string;
  activeTab: LearningJourneyTab | null;
  visibleTabs: LearningJourneyTab[];
  overflowGuideTabs: LearningJourneyTab[];
  isEditorUser: boolean;
  isDevMode: boolean;
  isDropdownOpen: boolean;
  setIsDropdownOpen: (open: boolean) => void;
  tabBarRef: React.RefObject<HTMLDivElement | null>;
  tabListRef: React.RefObject<HTMLDivElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  chevronButtonRef: React.RefObject<HTMLButtonElement | null>;
  dropdownOpenTimeRef: React.RefObject<number>;
  onSetActiveTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  reloadActiveTab: (tab: LearningJourneyTab) => void;
  onOpenEditorTab: () => void;
  onOpenDevToolsTab: () => void;
}

/** Italics alone can't carry meaning, so the native tooltip spells it out. */
function editorTabTooltip(title: string, status: EditorChromeStatus): string {
  return status.hasUnsyncedChanges ? t('docsPanel.editorTabModified', '{{title}} — modified', { title }) : title;
}

export function DocsPanelTabBar({
  styles,
  activeTabId,
  activeTab,
  visibleTabs,
  overflowGuideTabs,
  isEditorUser,
  isDevMode,
  isDropdownOpen,
  setIsDropdownOpen,
  tabBarRef,
  tabListRef,
  dropdownRef,
  chevronButtonRef,
  dropdownOpenTimeRef,
  onSetActiveTab,
  onCloseTab,
  reloadActiveTab,
  onOpenEditorTab,
  onOpenDevToolsTab,
}: DocsPanelTabBarProps): React.ReactElement {
  const guideTabs = getGuideStripTabs(visibleTabs);
  const browseEnabled = useBooleanFlag('pathfinder.package-browser', true);

  // One subscription keeps overflowed editor tabs current too.
  useSyncExternalStore(subscribeEditorChromeStatus, getEditorChromeStatusVersion);

  return (
    <div className={styles.tabBar} ref={tabBarRef} data-testid={testIds.docsPanel.tabBar}>
      <div className={styles.recommendationsTab}>
        <button
          className={`${styles.iconTab} ${activeTab?.type === 'recommendations' ? styles.iconTabActive : ''}`}
          onClick={() => onSetActiveTab(RECOMMENDATIONS_TAB_ID)}
          title={t('docsPanel.recommendations', 'Recommendations')}
          aria-pressed={activeTab?.type === 'recommendations'}
          data-testid={testIds.docsPanel.recommendationsTab}
        >
          <Icon name="document-info" size="md" />
        </button>
      </div>

      {browseEnabled && (
        <button
          className={`${styles.iconTab} ${activeTab?.type === 'browse' ? styles.iconTabActive : ''}`}
          onClick={() => onSetActiveTab(BROWSE_TAB_ID)}
          title={t('packageBrowser.browse', 'Browse')}
          aria-label={t('packageBrowser.browse', 'Browse')}
          aria-pressed={activeTab?.type === 'browse'}
          data-testid="docs-panel-tab-browse"
        >
          <Icon name="compass" size="md" />
        </button>
      )}
      {guideTabs.length > 0 && <div className={styles.tabDivider} />}

      <div className={styles.tabList} ref={tabListRef} data-testid={testIds.docsPanel.tabList}>
        {guideTabs.map((tab) => {
          const editorStatus = tab.type === 'editor' ? getEditorChromeStatus() : null;
          const editorBadge = editorStatus ? editorTabStatusBadge(editorStatus) : null;
          const modified = editorStatus?.hasUnsyncedChanges ? ` ${styles.editorTabTitleModified}` : '';
          return (
            <button
              key={tab.id}
              className={`${styles.tab} ${tab.id === activeTabId ? styles.activeTab : ''}`}
              onClick={() => onSetActiveTab(tab.id)}
              title={
                editorStatus
                  ? editorTabTooltip(getTranslatedTitle(tab.title), editorStatus)
                  : getTranslatedTitle(tab.title)
              }
              data-testid={testIds.docsPanel.tab(tab.id)}
            >
              <div className={styles.tabContent}>
                {editorBadge && !tab.isLoading && (
                  <Badge text={editorBadge.text} color={editorBadge.color} className={styles.editorTabStatusBadge} />
                )}
                <span
                  className={`${styles.tabTitle}${tab.type === 'editor' ? ` ${styles.editorTabTitle}` : ''}${modified}`}
                >
                  {tab.isLoading ? (
                    <>
                      <Icon name="sync" size="xs" />
                      <span>{t('docsPanel.loading', 'Loading...')}</span>
                    </>
                  ) : (
                    getTranslatedTitle(tab.title)
                  )}
                </span>
                <IconButton
                  name="times"
                  size="sm"
                  aria-label={t('docsPanel.closeTab', 'Close {{title}}', {
                    title: getTranslatedTitle(tab.title),
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    reportAppInteraction(UserInteraction.CloseTabClick, {
                      content_type: getContentTypeForAnalytics(
                        tab.currentUrl || tab.baseUrl,
                        tabTypeToContentType(tab.type)
                      ),
                      tab_title: tab.title,
                      content_url: tab.currentUrl || tab.baseUrl,
                      interaction_location: 'tab_button',
                      ...(tab.type === 'learning-journey' &&
                        tab.content && {
                          completion_percentage: getJourneyProgress(tab.content),
                          current_milestone: tab.content.metadata?.learningJourney?.currentMilestone,
                          total_milestones: tab.content.metadata?.learningJourney?.totalMilestones,
                        }),
                    });
                    onCloseTab(tab.id);
                  }}
                  className={styles.closeButton}
                  data-testid={testIds.docsPanel.tabCloseButton(tab.id)}
                />
              </div>
            </button>
          );
        })}
      </div>

      {overflowGuideTabs.length > 0 && (
        <div className={styles.tabOverflow}>
          <button
            ref={chevronButtonRef}
            className={`${styles.tab} ${styles.chevronTab}`}
            onClick={() => {
              if (!isDropdownOpen) {
                dropdownOpenTimeRef.current = Date.now();
              }
              setIsDropdownOpen(!isDropdownOpen);
            }}
            aria-label={t('docsPanel.showMoreTabs', 'Show {{count}} more tabs', {
              count: overflowGuideTabs.length,
            })}
            aria-expanded={isDropdownOpen}
            aria-haspopup="true"
            data-testid={testIds.docsPanel.tabOverflowButton}
          >
            <span>+{overflowGuideTabs.length}</span>
            <Icon name={isDropdownOpen ? 'angle-up' : 'angle-down'} size="sm" />
          </button>
        </div>
      )}

      {isDropdownOpen && overflowGuideTabs.length > 0 && (
        <div
          ref={dropdownRef}
          className={styles.tabDropdown}
          role="menu"
          aria-label={t('docsPanel.moreTabsMenu', 'More tabs')}
          data-testid={testIds.docsPanel.tabDropdown}
        >
          {overflowGuideTabs.map((tab) => {
            const editorStatus = tab.type === 'editor' ? getEditorChromeStatus() : null;
            const editorBadge = editorStatus ? editorTabStatusBadge(editorStatus) : null;
            const modified = editorStatus?.hasUnsyncedChanges ? ` ${styles.editorTabTitleModified}` : '';
            return (
              <button
                key={tab.id}
                className={`${styles.dropdownItem} ${tab.id === activeTabId ? styles.activeDropdownItem : ''}`}
                onClick={() => {
                  onSetActiveTab(tab.id);
                  setIsDropdownOpen(false);
                }}
                role="menuitem"
                title={editorStatus ? editorTabTooltip(getTranslatedTitle(tab.title), editorStatus) : undefined}
                aria-label={t('docsPanel.switchToTab', 'Switch to {{title}}', {
                  title: getTranslatedTitle(tab.title),
                })}
                data-testid={testIds.docsPanel.tabDropdownItem(tab.id)}
              >
                <div className={styles.dropdownItemContent}>
                  {editorBadge && !tab.isLoading && (
                    <Badge text={editorBadge.text} color={editorBadge.color} className={styles.editorTabStatusBadge} />
                  )}
                  <span
                    className={`${styles.dropdownItemTitle}${
                      tab.type === 'editor' ? ` ${styles.editorDropdownItemTitle}` : ''
                    }${modified}`}
                  >
                    {tab.isLoading ? (
                      <>
                        <Icon name="sync" size="xs" />
                        <span>{t('docsPanel.loading', 'Loading...')}</span>
                      </>
                    ) : (
                      getTranslatedTitle(tab.title)
                    )}
                  </span>
                  <IconButton
                    name="times"
                    size="sm"
                    aria-label={t('docsPanel.closeTab', 'Close {{title}}', {
                      title: getTranslatedTitle(tab.title),
                    })}
                    onClick={(e) => {
                      e.stopPropagation();
                      reportAppInteraction(UserInteraction.CloseTabClick, {
                        content_type: getContentTypeForAnalytics(
                          tab.currentUrl || tab.baseUrl,
                          tabTypeToContentType(tab.type)
                        ),
                        tab_title: tab.title,
                        content_url: tab.currentUrl || tab.baseUrl,
                        close_location: 'dropdown',
                        ...(tab.type === 'learning-journey' &&
                          tab.content && {
                            completion_percentage: getJourneyProgress(tab.content),
                            current_milestone: tab.content.metadata?.learningJourney?.currentMilestone,
                            total_milestones: tab.content.metadata?.learningJourney?.totalMilestones,
                          }),
                      });
                      onCloseTab(tab.id);
                    }}
                    className={styles.dropdownItemClose}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <TabBarActions
        className={styles.tabBarActions}
        activeTab={activeTab}
        isDevMode={isDevMode}
        isEditorUser={isEditorUser}
        onReloadActiveTab={reloadActiveTab}
        onOpenEditorTab={onOpenEditorTab}
        onOpenDevToolsTab={onOpenDevToolsTab}
      />
    </div>
  );
}
