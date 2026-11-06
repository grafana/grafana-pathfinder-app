import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2, IconName } from '@grafana/data';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import type { getMyLearningStyles } from '../MyLearningTab.styles';

export function LearningCardsRow({
  title,
  description,
  icon,
  children,
  styles,
}: {
  title: string;
  description?: string;
  icon: IconName;
  children: React.ReactNode;
  styles: ReturnType<typeof getMyLearningStyles>;
}) {
  const rowStyles = useStyles2(getStyles);
  const rowId = useId();
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  const count = React.Children.count(children);
  const updateEdges = useCallback(() => {
    const element = row.current;
    if (!element) {
      return;
    }
    const next = {
      previous: element.scrollLeft > 1,
      next: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
    };
    setEdges((current) => (current.previous === next.previous && current.next === next.next ? current : next));
  }, []);

  useEffect(() => {
    const element = row.current;
    if (!element) {
      return;
    }
    updateEdges();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateEdges);
      return () => window.removeEventListener('resize', updateEdges);
    }
    const observer = new ResizeObserver(updateEdges);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, updateEdges]);

  const scroll = (direction: number) => {
    const element = row.current;
    element?.scrollBy({
      left: direction * element.clientWidth * 0.9,
      behavior: 'instant',
    });
  };

  return (
    <section className={styles.openSection}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>
          <Icon name={icon} size="lg" />
        </span>
        <div className={styles.sectionHeadingText}>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {description && <p className={styles.sectionDescription}>{description}</p>}
        </div>
        {(edges.previous || edges.next) && (
          <div className={rowStyles.controls}>
            <Button
              icon="angle-left"
              size="md"
              variant="secondary"
              fill="outline"
              aria-label={t('myLearning.previousItems', 'Previous items in {{section}}', { section: title })}
              aria-controls={rowId}
              disabled={!edges.previous}
              onClick={() => scroll(-1)}
            />
            <Button
              icon="angle-right"
              size="md"
              variant="secondary"
              fill="outline"
              aria-label={t('myLearning.nextItems', 'Next items in {{section}}', { section: title })}
              aria-controls={rowId}
              disabled={!edges.next}
              onClick={() => scroll(1)}
            />
          </div>
        )}
      </div>
      <div
        ref={row}
        id={rowId}
        role="region"
        aria-label={title}
        tabIndex={0}
        onScroll={updateEdges}
        className={cx(
          rowStyles.row,
          edges.previous && rowStyles.fadeLeft,
          edges.next && rowStyles.fadeRight,
          edges.previous && edges.next && rowStyles.fadeBoth
        )}
      >
        {React.Children.map(children, (child) => (
          <div className={rowStyles.item}>{child}</div>
        ))}
      </div>
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  controls: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
  row: css({
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: `max(${theme.spacing(30)}, calc((100% - ${theme.spacing(6)}) / 4.5))`,
    gap: theme.spacing(1.5),
    overflowX: 'auto',
    overscrollBehaviorX: 'contain',
    scrollbarWidth: 'thin',
    paddingBottom: theme.spacing(1),
    '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: 2 },
    '@container (max-width: 1000px)': {
      gridAutoColumns: `max(${theme.spacing(30)}, calc((100% - ${theme.spacing(4.5)}) / 3.5))`,
    },
    '@container (max-width: 700px)': {
      gridAutoColumns: `max(${theme.spacing(30)}, calc((100% - ${theme.spacing(3)}) / 2.5))`,
    },
    '@container (max-width: 450px)': { gridAutoColumns: '85%' },
  }),
  item: css({ display: 'flex', minWidth: 0, '& > *': { width: '100%' } }),
  fadeLeft: css({ maskImage: `linear-gradient(to right, transparent, black ${theme.spacing(4)})` }),
  fadeRight: css({ maskImage: `linear-gradient(to right, black calc(100% - ${theme.spacing(4)}), transparent)` }),
  fadeBoth: css({
    maskImage: `linear-gradient(to right, transparent, black ${theme.spacing(4)}, black calc(100% - ${theme.spacing(4)}), transparent)`,
  }),
});
