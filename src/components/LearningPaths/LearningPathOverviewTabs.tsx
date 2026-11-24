import React, { useId, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';
import { Tab, TabsBar, useStyles2 } from '@grafana/ui';

type OverviewTab = 'modules' | 'details';

export function LearningPathOverviewTabs({
  modules,
  details,
  openDetails,
}: {
  modules: React.ReactNode;
  details: React.ReactNode;
  openDetails: boolean;
}) {
  const id = useId();
  const styles = useStyles2(getStyles);
  const [selected, setSelected] = useState<OverviewTab>(openDetails ? 'details' : 'modules');
  const detailsAvailable = details != null;
  const active = detailsAvailable ? selected : 'modules';
  const tabs = [
    { key: 'modules' as const, label: t('coverPage.outlineTab', 'Outline'), content: modules },
    { key: 'details' as const, label: t('coverPage.detailsTab', 'Details'), content: details },
  ];

  return (
    <>
      <TabsBar className={styles.tabs}>
        {tabs.map(({ key, label }) => (
          <Tab
            key={key}
            id={`${id}-${key}-tab`}
            aria-controls={`${id}-${key}`}
            label={label}
            active={active === key}
            disabled={key === 'details' && !detailsAvailable}
            onChangeTab={() => setSelected(key)}
            onKeyDown={(event) => {
              if (!detailsAvailable || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                return;
              }
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'modules'
                  : event.key === 'End'
                    ? 'details'
                    : key === 'modules'
                      ? 'details'
                      : 'modules';
              setSelected(next);
              document.getElementById(`${id}-${next}-tab`)?.focus();
            }}
          />
        ))}
      </TabsBar>
      {tabs.map(({ key, content }) => (
        <div key={key} role="tabpanel" id={`${id}-${key}`} aria-labelledby={`${id}-${key}-tab`} hidden={active !== key}>
          {content}
        </div>
      ))}
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  tabs: css({ marginBottom: theme.spacing(2) }),
});
