import React, { useState } from 'react';
import { Icon } from '@grafana/ui';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import {
  assignmentCounts,
  completionTrend,
  contentKey,
  learningLink,
  personName,
  displayDate,
  displayTime,
  completionMethod,
} from './insights.helpers';
import { insightsQuality } from './insights-quality';
import type { InsightsStyles } from './learning-insights.styles';

interface Props {
  data: LearningInsightsResponse;
  styles: InsightsStyles;
  onPerson: (userId: string) => void;
  onAssignments: (status: string) => void;
  timeZone?: string;
}

export function Overview({ data, styles: s, onPerson, onAssignments, timeZone = 'UTC' }: Props) {
  const [content, setContent] = useState('');
  const rows = data.completions.filter((row) => !content || contentKey(row.guideSource, row.guideId) === content);
  const counts = assignmentCounts(data.assignments);
  const quality = insightsQuality(data);
  const byGuide = new Map<
    string,
    { key: string; row: LearningInsightsResponse['completions'][number]; count: number }
  >();
  for (const row of data.completions) {
    const key = contentKey(row.guideSource, row.guideId);
    const previous = byGuide.get(key);
    byGuide.set(key, { key, row: previous?.row ?? row, count: (previous?.count ?? 0) + 1 });
  }
  const rankings = Array.from(byGuide.values()).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const trend = completionTrend(rows, data.from, data.to);
  const max = Math.max(1, ...trend.map((bucket) => bucket.count));
  const people = new Map(data.people.map((person) => [person.userId, person]));
  return (
    <>
      <section className={s.metrics} aria-label="Learning summary">
        <div>
          <Icon name="users-alt" className={s.metricIcon} />
          <strong>{new Set(data.completions.map((row) => row.userId)).size}</strong>
          <span>People completing</span>
        </div>
        <div>
          <Icon name="book-open" className={s.metricIcon} />
          <strong>{data.completions.length}</strong>
          <span>Guide completions</span>
        </div>
        <div>
          <Icon name="clipboard-alt" className={s.metricIcon} />
          <strong>{quality.assignmentsIncomplete ? '—' : data.assignments.length - counts.withdrawn}</strong>
          <span>Current assignments</span>
        </div>
      </section>
      <div className={s.metricContext}>
        <p className={s.muted}>Each person and guide counts once per period. Assignments are current.</p>
      </div>
      <div className={s.grid}>
        <section className={s.section} aria-labelledby="completions-chart-title">
          <div className={s.header}>
            <h2 id="completions-chart-title">Guide completions over time</h2>
            <label>
              Content
              <select value={content} onChange={(event) => setContent(event.target.value)}>
                <option value="">All recorded guides</option>
                {rankings.map(({ key, row }) => (
                  <option key={key} value={key}>
                    {row.guideTitle || row.guideId} · {row.guideSource}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={s.muted}>
            Guide completions in{' '}
            {trend.length
              ? Math.round(((Date.parse(trend[0]!.to) - Date.parse(trend[0]!.from)) / 86400000) * 10) / 10
              : 0}
            -day intervals (last may be shorter). First completion per person and guide in this period.
          </p>
          {rows.length > 0 ? (
            <>
              <div className={s.chart} role="list" aria-label="Guide completions by interval">
                {trend.map((bucket) => {
                  const label = `${displayTime(bucket.from, timeZone)} to ${displayTime(bucket.to, timeZone)} ${timeZone} (end excluded): ${bucket.count} guide completions`;
                  return (
                    <div
                      className={s.barColumn}
                      key={bucket.from}
                      role="listitem"
                      aria-label={label}
                      title={label}
                      tabIndex={0}
                    >
                      <strong aria-hidden="true">{bucket.count}</strong>
                      <div
                        aria-hidden="true"
                        className={s.bar}
                        style={{ height: `${(bucket.count / max) * 125}px`, borderTopWidth: bucket.count ? 4 : 0 }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className={s.chartLabels} aria-hidden="true">
                {trend.map((bucket) => (
                  <span key={bucket.from}>
                    {displayDate(bucket.from, timeZone)} – {displayDate(bucket.to, timeZone)}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className={s.empty}>
              {quality.completionsIncomplete
                ? 'No matching completion records available. The completion read is incomplete.'
                : 'No completion records in this period and content filter.'}
            </p>
          )}
        </section>
        <section className={s.section} aria-labelledby="focus-title">
          <h2 id="focus-title">Assignment follow-up</h2>
          {quality.assignmentsIncomplete && <p className={s.empty}>Assignment summary unavailable</p>}
          {!data.assignments.length && !quality.assignmentsIncomplete && (
            <div className={s.empty}>
              <h3>No assignments yet</h3>
              <p>Assignment progress will appear here when people are assigned learning content.</p>
            </div>
          )}
          {data.assignments.length > 0 && (
            <>
              <p>
                {counts.complete} complete · {counts.outstanding} outstanding · {counts.unknown} need review ·{' '}
                {counts.withdrawn} withdrawn
              </p>
              {counts.overdue > 0 && (
                <div className={s.row}>
                  <div>
                    <h3>
                      {counts.overdue} overdue {counts.overdue === 1 ? 'assignment' : 'assignments'}
                    </h3>
                    <p className={s.muted}>Review due dates and completion records.</p>
                    <button className={s.textButton} onClick={() => onAssignments('overdue')}>
                      Review overdue assignments →
                    </button>
                  </div>
                </div>
              )}
              {counts.unknown > 0 && (
                <div className={s.row}>
                  <div>
                    <h3>
                      {counts.unknown} {counts.unknown === 1 ? 'assignment needs' : 'assignments need'} review
                    </h3>
                    <p className={s.muted}>
                      Completion history or required guides could not be verified. Refresh, then check the assigned
                      content if this continues.
                    </p>
                    <button className={s.textButton} onClick={() => onAssignments('unknown')}>
                      Review unresolved assignments →
                    </button>
                  </div>
                </div>
              )}
              {!counts.overdue && !counts.unknown && !quality.assignmentsIncomplete && (
                <p className={s.success}>
                  <span aria-hidden="true">✓ </span>No assignments need attention
                </p>
              )}
            </>
          )}
        </section>
      </div>
      <div className={s.grid}>
        <section className={s.section} aria-labelledby="ranking-title">
          <h2 id="ranking-title">What people are completing</h2>
          <p className={s.muted}>People per guide in this period</p>
          {!rankings.length && (
            <p>
              {quality.completionsIncomplete
                ? 'No guide completions available. The completion read is incomplete.'
                : 'No guide completions recorded in this period.'}
            </p>
          )}
          {rankings.slice(0, 8).map(({ key, row, count }) => {
            const link = learningLink(row.guideSource, row.guideId, 'guide');
            return (
              <div key={key} className={s.row}>
                <div>
                  {link ? (
                    <a href={link}>{row.guideTitle || row.guideId}</a>
                  ) : (
                    <strong>{row.guideTitle || row.guideId}</strong>
                  )}
                  <div className={s.muted}>{row.guideSource}</div>
                </div>
                <strong className={s.noWrap}>
                  {count} {count === 1 ? 'person' : 'people'}
                </strong>
              </div>
            );
          })}
          {rankings.length > 8 && (
            <p className={s.muted}>Top 8 of {rankings.length} guides. Use Content to inspect any guide.</p>
          )}
        </section>
        <section className={s.section} aria-labelledby="recent-title">
          <h2 id="recent-title">Recent completions</h2>
          {!rows.length && (
            <p>
              No matching completions
              {quality.completionsIncomplete ? ' available; the completion read is incomplete' : ''}.
            </p>
          )}
          {[...rows]
            .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
            .slice(0, 8)
            .map((row) => (
              <div key={JSON.stringify([row.userId, row.guideSource, row.guideId])} className={s.row}>
                <div>
                  <button className={s.textButton} onClick={() => onPerson(row.userId)}>
                    {personName(people.get(row.userId), row.userId)}
                  </button>
                  <div>{row.guideTitle || row.guideId}</div>
                  <div className={s.muted}>{completionMethod(row.source)}</div>
                </div>
                <time className={s.muted} dateTime={row.completedAt} title={row.completedAt}>
                  {displayTime(row.completedAt, timeZone)}
                </time>
              </div>
            ))}
        </section>
      </div>
    </>
  );
}
