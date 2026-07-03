/**
 * Tab bar surface for the docs panel: permanent icon-only tabs (recommendations,
 * optional editor, optional devtools), divider, guide-tab list with close buttons,
 * overflow chevron and dropdown, and the trailing TabBarActions slot.
 *
 * Extracted verbatim from `docs-panel.tsx`. Every `data-testid` is preserved
 * unchanged — `docs-panel.contract.test.tsx`'s testId exhaustiveness check
 * is the Pattern-J tripwire for this move.
 *
 * Pre-mortem H6 (test-id surface drift): the contract test asserts each
 * testIds.docsPanel.* key appears in exactly one tracked file; this
 * extraction moves the relevant references from docs-panel.tsx to this
 * file's entry in SOURCE_CONTRACT (updated in the same commit).
 */
import React from 'react';
import { Icon, IconButton } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { getStyles as getDocsPanelStyles } from '../../../styles/docs-panel.styles';
import { testIds } from '../../../constants/testIds';

type DocsPanelStyles = ReturnType<typeof getDocsPanelStyles>;
import { PERMANENT_TAB_IDS, getTranslatedTitle } from '../utils';
import { TabBarActions } from './TabBarActions';
import { reportAppInteraction, UserInteraction, getContentTypeForAnalytics } from '../../../lib/analytics';
import { getJourneyProgress } from '../../../docs-retrieval';

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
  tabBarRef: React.RefObject<HTMLDivElement>;
  tabListRef: React.RefObject<HTMLDivElement>;
  dropdownRef: React.RefObject<HTMLDivElement>;
  chevronButtonRef: React.RefObject<HTMLButtonElement>;
  dropdownOpenTimeRef: React.MutableRefObject<number>;
  onSetActiveTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  reloadActiveTab: (tab: LearningJourneyTab) => void;
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
}: DocsPanelTabBarProps): React.ReactElement {
  return (
    <div className={styles.tabBar} ref={tabBarRef} data-testid={testIds.docsPanel.tabBar}>
      {/* Permanent icon-only tabs */}
      <div className={styles.permanentTabs}>
        <button
          className={`${styles.iconTab} ${activeTabId === 'recommendations' ? styles.iconTabActive : ''}`}
          onClick={() => onSetActiveTab('recommendations')}
          title={t('docsPanel.recommendations', 'Recommendations')}
          data-testid={testIds.docsPanel.recommendationsTab}
        >
          <Icon name="document-info" size="md" />
        </button>
        {isEditorUser && (
          <button
            className={`${styles.iconTab} ${activeTabId === 'editor' ? styles.iconTabActive : ''}`}
            onClick={() => onSetActiveTab('editor')}
            title={t('docsPanel.guideEditor', 'Guide editor')}
            data-testid={testIds.docsPanel.tab('editor')}
          >
            <Icon name="edit" size="md" />
          </button>
        )}
        {isDevMode && (
          <button
            className={`${styles.iconTab} ${activeTabId === 'devtools' ? styles.iconTabActive : ''}`}
            onClick={() => onSetActiveTab('devtools')}
            title={t('docsPanel.devTools', 'Dev tools')}
            data-testid={testIds.docsPanel.tab('devtools')}
          >
            <Icon name="bug" size="md" />
          </button>
        )}
      </div>

      {/* Divider - only show when there are guide tabs */}
      {visibleTabs.filter((tab) => !PERMANENT_TAB_IDS.has(tab.id)).length > 0 && <div className={styles.tabDivider} />}

      {/* Guide tabs with titles */}
      <div className={styles.tabList} ref={tabListRef} data-testid={testIds.docsPanel.tabList}>
        {visibleTabs
          .filter((tab) => !PERMANENT_TAB_IDS.has(tab.id))
          .map((tab) => {
            return (
              <button
                key={tab.id}
                className={`${styles.tab} ${tab.id === activeTabId ? styles.activeTab : ''}`}
                onClick={() => onSetActiveTab(tab.id)}
                title={getTranslatedTitle(tab.title)}
                data-testid={testIds.docsPanel.tab(tab.id)}
              >
                <div className={styles.tabContent}>
                  {tab.type === 'devtools' && <Icon name="bug" size="xs" className={styles.tabIcon} />}
                  <span className={styles.tabTitle}>
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
                          tab.type || 'learning-journey'
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
            <Icon name="angle-down" size="sm" />
            <span>+{overflowGuideTabs.length}</span>
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
            return (
              <button
                key={tab.id}
                className={`${styles.dropdownItem} ${tab.id === activeTabId ? styles.activeDropdownItem : ''}`}
                onClick={() => {
                  onSetActiveTab(tab.id);
                  setIsDropdownOpen(false);
                }}
                role="menuitem"
                aria-label={t('docsPanel.switchToTab', 'Switch to {{title}}', {
                  title: getTranslatedTitle(tab.title),
                })}
                data-testid={testIds.docsPanel.tabDropdownItem(tab.id)}
              >
                <div className={styles.dropdownItemContent}>
                  {tab.type === 'devtools' && <Icon name="bug" size="xs" className={styles.dropdownItemIcon} />}
                  <span className={styles.dropdownItemTitle}>
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
                          tab.type || 'learning-journey'
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

      {/* Menu and close actions */}
      <TabBarActions
        className={styles.tabBarActions}
        activeTab={activeTab}
        isDevMode={isDevMode}
        onReloadActiveTab={reloadActiveTab}
      />
    </div>
  );
}
