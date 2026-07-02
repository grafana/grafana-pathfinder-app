import React from 'react';
import { cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { testIds } from '../../constants/testIds';
import type { OutlineItem } from '../../hooks';
import { getGuideReaderStyles, GuideReaderStyles } from './guide-reader.styles';

const HIGHLIGHT_DURATION_MS = 3000;

function jumpToHeading(container: HTMLElement, id: string): void {
  const target = container.querySelector<HTMLElement>('#' + CSS.escape(id));
  if (!target) {
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.add('fragment-highlight');
  window.setTimeout(() => {
    target.classList.remove('fragment-highlight');
  }, HIGHLIGHT_DURATION_MS);
}

function levelClassName(styles: GuideReaderStyles, level: number): string {
  if (level >= 4) {
    return styles.outlineItemLevel4;
  }
  if (level === 3) {
    return styles.outlineItemLevel3;
  }
  return styles.outlineItemLevel2;
}

function handleListKeyDown(event: React.KeyboardEvent<HTMLUListElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return;
  }
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
  const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex === -1) {
    return;
  }
  event.preventDefault();
  const nextIndex =
    event.key === 'ArrowDown' ? Math.min(currentIndex + 1, buttons.length - 1) : Math.max(currentIndex - 1, 0);
  buttons[nextIndex]?.focus();
}

interface OutlineRailProps {
  items: OutlineItem[];
  containerRef: React.RefObject<HTMLDivElement>;
  activeId?: string | null;
  onJump?: (id: string) => void;
}

export function OutlineRail({ items, containerRef, activeId, onJump }: OutlineRailProps) {
  const styles = useStyles2(getGuideReaderStyles);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav
      className={styles.outlineRail}
      aria-label={t('guideReader.outlineLabel', 'Document outline')}
      data-testid={testIds.guideReader.outline}
    >
      <ul className={styles.outlineList} onKeyDown={handleListKeyDown}>
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={cx(
                  styles.outlineItem,
                  levelClassName(styles, item.level),
                  isActive && styles.outlineItemActive
                )}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => {
                  onJump?.(item.id);
                  if (containerRef.current) {
                    jumpToHeading(containerRef.current, item.id);
                  }
                }}
                data-testid={testIds.guideReader.outlineItem(item.id)}
              >
                {item.text}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
