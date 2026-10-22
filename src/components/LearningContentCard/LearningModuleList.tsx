import React, { useEffect, useRef, useState } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { cx } from '@emotion/css';
import type { Milestone } from '../../types/content.types';
import { getLearningContentCardStyles } from './learning-content-card.styles';

export function LearningModuleList({
  modules,
  onOpen,
  progress,
  itemTestId,
  numbered = true,
  compact = false,
}: {
  modules: Milestone[];
  onOpen?: (member: Milestone) => void | Promise<unknown>;
  progress?: Record<string, number>;
  itemTestId?: (index: number) => string;
  numbered?: boolean;
  compact?: boolean;
}) {
  const styles = useStyles2(getLearningContentCardStyles);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<number | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const open = async (member: Milestone, index: number) => {
    if (lock.current || member.isLocked || !onOpen) {
      return;
    }
    lock.current = true;
    setPending(index);
    setError(null);
    try {
      await onOpen(member);
    } catch {
      if (mounted.current) {
        setError(index);
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setPending(null);
      }
    }
  };
  const List = numbered ? 'ol' : 'ul';
  return (
    <List className={cx(styles.modules, compact && styles.modulesCompact)}>
      {modules.map((member, index) => {
        const percent = member.id ? progress?.[member.id] : undefined;
        const complete = percent === 100;
        const row = (
          <>
            <span
              className={cx(styles.moduleNumber, compact && styles.moduleNumberCompact, complete && styles.completed)}
            >
              {complete ? (
                <Icon name="check" size="sm" />
              ) : numbered ? (
                index + 1
              ) : (
                <Icon name="arrow-right" size="sm" />
              )}
            </span>
            <span className={styles.moduleContent}>
              <span className={cx(styles.moduleTitle, compact && styles.moduleTitleCompact)}>{member.title}</span>
              {member.description && !compact && <span className={styles.moduleDescription}>{member.description}</span>}
              <span className={styles.moduleMeta}>
                {member.isLocked
                  ? t('learningCard.unavailable', 'Unavailable')
                  : complete
                    ? t('learningCard.completed', 'Completed')
                    : typeof percent === 'number' && percent > 0 && percent < 100
                      ? t('learningCard.progress', '{{percent}}% complete', { percent })
                      : typeof member.estimatedMinutes === 'number' &&
                          Number.isFinite(member.estimatedMinutes) &&
                          member.estimatedMinutes > 0
                        ? t('learningCard.moduleTime', '{{minutes}} min', { minutes: member.estimatedMinutes })
                        : null}
              </span>
            </span>
            {member.isLocked && <Icon name="lock" size="sm" />}
            {onOpen && numbered && !member.isLocked && <Icon name="angle-right" size="sm" />}
          </>
        );
        return (
          <li key={`${member.id || member.url || member.title}:${index}`}>
            {onOpen ? (
              <button
                className={cx(styles.moduleRow, compact && styles.moduleRowCompact, styles.moduleLink)}
                disabled={member.isLocked || pending !== null}
                data-testid={itemTestId?.(index)}
                onClick={() => {
                  void open(member, index);
                }}
              >
                {row}
              </button>
            ) : (
              <div className={cx(styles.moduleRow, compact && styles.moduleRowCompact)}>{row}</div>
            )}
            {pending === index && <span role="status">{t('learningCard.opening', 'Opening…')}</span>}
            {error === index && (
              <div className={styles.error} role="alert">
                <p>
                  {numbered
                    ? t('learningCard.moduleError', 'Could not open this module.')
                    : t('learningCard.linkError', 'Could not open this content.')}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void open(member, index);
                  }}
                >
                  {t('learningCard.retry', 'Retry')}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </List>
  );
}
