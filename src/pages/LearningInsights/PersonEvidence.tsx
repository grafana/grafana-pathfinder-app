import React, { useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '../../lib/clipboard';
import type { LearningInsightsAssignment, LearningInsightsResponse } from '../../types/learning-insights';
import { learningLink, personName, displayTime, completionMethod } from './insights.helpers';
import type { InsightsStyles } from './learning-insights.styles';
import { CompletionScope } from './CompletionScope';
import { insightsQuality } from './insights-quality';

interface Props {
  data: LearningInsightsResponse;
  userId: string;
  styles: InsightsStyles;
  onClose: () => void;
  timeZone?: string;
}

function AssignmentEvidence({
  assignment: row,
  styles: s,
  timeZone,
}: {
  assignment: LearningInsightsAssignment;
  styles: InsightsStyles;
  timeZone: string;
}) {
  const link = learningLink(row.targetSource, row.targetId, row.targetType);
  const [copyState, setCopyState] = useState('');
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const copy = () => {
    if (!link) {
      return;
    }
    void copyTextToClipboard(link).then((copied) => {
      if (mounted.current) {
        setCopyState(copied ? 'Learning link copied.' : 'Could not copy. Use the open learning content link.');
      }
    });
  };
  const known = row.status !== 'unknown';
  return (
    <section className={s.section}>
      <h3>{row.targetId}</h3>
      <p className={s.muted}>
        {row.targetSource} · {row.targetType}
        {row.trackId ? ` · Track: ${row.trackId}` : ''}
        <br />
        Rule: {row.ruleId || 'Not recorded'}
      </p>
      <p className={row.status === 'complete' ? s.success : row.status === 'overdue' ? s.warning : undefined}>
        <strong>
          {row.status === 'complete'
            ? '✓ Complete'
            : row.status === 'unknown'
              ? 'Unknown — cannot evaluate'
              : row.status === 'overdue'
                ? 'Overdue'
                : row.status === 'withdrawn'
                  ? 'Withdrawn'
                  : 'Outstanding'}
        </strong>
      </p>
      {row.reason && (
        <p className={s.muted}>
          {row.reason === 'completion-history-incomplete'
            ? 'Completion history is incomplete. Refresh to retry; missing credit cannot yet be ruled out.'
            : row.reason === 'lifecycle-unsupported'
              ? 'This assignment uses an unsupported state. Ask your administrator to check it.'
              : 'Required learning content could not be verified. Refresh, then check that the assigned content is still available.'}
        </p>
      )}
      <p className={s.muted}>
        Assigned: {displayTime(row.assignedAt, timeZone)}
        <br />
        Due: {row.dueAt ? displayTime(row.dueAt, timeZone) : 'No due date recorded'}
      </p>
      <h3>
        {!known
          ? 'Required-guide evidence is unresolved'
          : row.guides.length
            ? `${row.guides.filter((guide) => guide.completed).length} of ${row.guides.length} guides credited`
            : 'Required-guide list unavailable'}
      </h3>
      {!row.guides.length && (
        <p className={s.muted}>No required-guide list returned. This does not prove zero progress.</p>
      )}
      <ul>
        {row.guides.map((guide) => (
          <li key={JSON.stringify([guide.guideSource, guide.guideId])}>
            <span className={guide.completed ? s.success : s.muted}>
              {guide.completed ? '✓ Credited' : known ? 'No completion credit' : 'Unresolved'} — {guide.guideId}
            </span>
            <div className={s.muted}>{guide.guideSource}</div>
          </li>
        ))}
      </ul>
      {link ? (
        <div className={s.header}>
          <a className={s.primary} href={link}>
            Open learning content →
          </a>
          <button className={s.button} onClick={copy}>
            Copy learning link
          </button>
        </div>
      ) : (
        <p className={s.muted}>
          A reliable learning link cannot be reconstructed for this source. Open the target from Explore learning.
        </p>
      )}
      <span role="status" className={s.muted}>
        {copyState}
      </span>
    </section>
  );
}

export function PersonEvidence({ data, userId, styles: s, onClose, timeZone = 'UTC' }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const person = data.people.find((candidate) => candidate.userId === userId);
  const assignments = data.assignments.filter((row) => row.userId === userId);
  const completions = data.completions.filter((row) => row.userId === userId);
  return (
    <aside className={s.detail} aria-labelledby="person-evidence-title">
      <div className={s.header}>
        <span className={s.muted}>Person details</span>
        <button className={s.button} onClick={onClose}>
          Close details
        </button>
      </div>
      <h2 id="person-evidence-title" ref={heading} tabIndex={-1}>
        {personName(person, userId)}
      </h2>
      <p className={s.muted}>
        Subject: {userId}
        {person?.userLogin ? ` · Login: ${person.userLogin}` : ''}
      </p>
      <p className={s.muted}>
        Partial step progress is not recorded here. Missing completion is not evidence of a failed attempt or of never
        starting.
      </p>
      <h3>Current assignments ({assignments.length})</h3>
      {!assignments.length && <p className={s.muted}>No assignment records returned for this person.</p>}
      {assignments.map((assignment) => (
        <AssignmentEvidence key={assignment.name} assignment={assignment} styles={s} timeZone={timeZone} />
      ))}
      <section className={s.section}>
        <h3>Completion evidence in selected period ({completions.length})</h3>
        {insightsQuality(data).ambiguous && <CompletionScope styles={s} />}
        {!completions.length && (
          <p className={s.muted}>
            No completion records returned in this period. Older evidence may still satisfy an assignment.
          </p>
        )}
        <ul>
          {[...completions]
            .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
            .map((row) => (
              <li key={JSON.stringify([row.guideSource, row.guideId])}>
                <span className={s.success}>✓ {row.guideTitle || row.guideId}</span>
                <div className={s.muted}>
                  {completionMethod(row.source)}
                  <br />
                  <time dateTime={row.completedAt} title={row.completedAt}>
                    {displayTime(row.completedAt, timeZone)}
                  </time>
                </div>
              </li>
            ))}
        </ul>
      </section>
    </aside>
  );
}
