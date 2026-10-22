import React, { useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '../../lib/clipboard';
import type { LearningInsightsAssignment, LearningInsightsResponse } from '../../types/learning-insights';
import {
  learningLink,
  personName,
  displayTime,
  assignmentTitle,
  assignmentStatus,
  assignmentIssue,
} from './insights.helpers';
import type { InsightsStyles } from './learning-insights.styles';

export function AssignmentEvidence({
  assignment: row,
  data,
  styles: s,
  timeZone,
  onClose,
}: {
  assignment: LearningInsightsAssignment;
  data: LearningInsightsResponse;
  styles: InsightsStyles;
  timeZone: string;
  onClose: () => void;
}) {
  const link = learningLink(row.targetSource, row.targetId, row.targetType);
  const [copyState, setCopyState] = useState('');
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);
  const completed = row.guides.filter((guide) => guide.completed).length;
  return (
    <section className={s.detail} id="assignment-details" aria-labelledby="assignment-details-title">
      <div className={s.header}>
        <h3 id="assignment-details-title" tabIndex={-1} ref={heading}>
          {assignmentTitle(row, data.completions)}
        </h3>
        <button className={s.button} onClick={onClose}>
          Close assignment details
        </button>
      </div>
      <p>
        {personName(
          data.people.find((person) => person.userId === row.userId),
          row.userId
        )}{' '}
        · <strong>{assignmentStatus(row.status)}</strong>
      </p>
      {row.status === 'unknown' && <p>{assignmentIssue(row.reason)}</p>}
      <p className={s.muted}>
        Assigned: {displayTime(row.assignedAt, timeZone)}
        <br />
        Due: {row.dueAt ? displayTime(row.dueAt, timeZone) : 'No due date'}
      </p>
      {row.status !== 'withdrawn' && (
        <>
          <h3>
            {row.guides.length
              ? `${completed} of ${row.guides.length} guides completed${row.status === 'unknown' ? ' · check incomplete' : ''}`
              : 'Completion cannot be checked'}
          </h3>
          <details className={s.completionScope}>
            <summary>How completion is counted</summary>
            <p>
              Completed guides that count toward this assignment. Earlier completions may not count, depending on its
              date rules. This is not step-by-step progress or a measure of mastery.
            </p>
          </details>
          {row.guides.length > 0 && (
            <ul>
              {row.guides.map((guide) => (
                <li key={JSON.stringify([guide.guideSource, guide.guideId])}>
                  {guide.completed
                    ? '✓ Complete'
                    : row.status === 'unknown'
                      ? 'Not verified'
                      : 'No completion recorded'}{' '}
                  —{' '}
                  {data.completions.find(
                    (item) => item.guideId === guide.guideId && item.guideSource === guide.guideSource
                  )?.guideTitle || guide.guideId}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {link && row.reason !== 'target-unresolved' ? (
        <div className={s.header}>
          <a className={s.primary} href={link}>
            Open learning content →
          </a>
          <button
            className={s.textButton}
            onClick={() => {
              void copyTextToClipboard(link).then((copied) => {
                if (mounted.current) {
                  setCopyState(
                    copied ? 'Learning link copied.' : 'Could not copy. Use the open learning content link.'
                  );
                }
              });
            }}
          >
            Copy learning link
          </button>
        </div>
      ) : (
        <p className={s.muted}>
          Open Explore learning to find the content, or ask your administrator to check the assignment.
        </p>
      )}
      {copyState && (
        <p role="status" className={s.muted}>
          {copyState}
        </p>
      )}
      <details>
        <summary>Technical details</summary>
        <dl>
          <dt>Assignment ID</dt>
          <dd>{row.name}</dd>
          <dt>Content ID</dt>
          <dd>{row.targetId}</dd>
          <dt>Content source and type</dt>
          <dd>
            {row.targetSource} · {row.targetType}
          </dd>
          <dt>Rule ID</dt>
          <dd>{row.ruleId || 'Not recorded'}</dd>
          {row.trackId && (
            <>
              <dt>Track ID</dt>
              <dd>{row.trackId}</dd>
            </>
          )}
          <dt>Subject ID</dt>
          <dd>{row.userId}</dd>
          {row.reason && (
            <>
              <dt>Diagnostic</dt>
              <dd>{row.reason}</dd>
            </>
          )}
        </dl>
      </details>
    </section>
  );
}
