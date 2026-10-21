import React, { useState } from 'react';
import { InsightsSymbol } from './InsightsSymbol';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import {
  assignmentCounts,
  completionTrend,
  contentKey,
  learningLink,
  personName,
  utcDate,
  utcTime,
} from './insights.helpers';
import type { InsightsStyles } from './learning-insights.styles';

interface Props {
  data: LearningInsightsResponse;
  styles: InsightsStyles;
  onPerson: (userId: string) => void;
  onAssignments: (status: string) => void;
}

export function Overview({ data, styles: s, onPerson, onAssignments }: Props) {
  const [content, setContent] = useState('');
  const rows = data.completions.filter((row) => !content || contentKey(row.guideSource, row.guideId) === content);
  const counts = assignmentCounts(data.assignments);
  const active = data.assignments.length - counts.withdrawn;
  const partial = data.completeness === 'partial';
  const number = (value: number) => `${partial ? 'At least ' : ''}${value}`;
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
  const completePercent = active ? (counts.complete / active) * 100 : 0;
  const outstandingPercent = active ? (counts.outstanding / active) * 100 : 0;
  return (
    <>
      <section className={s.hero} aria-labelledby="learning-hero-title">
        <div className={s.heroGrid}>
          <div>
            <div className={s.eyebrow}>Your stack, learning together</div>
            <h2 id="learning-hero-title">Learning, made visible.</h2>
            <p>See what is being completed. Know where to follow up.</p>
            <div className={s.metrics}>
              <div>
                <strong>{number(new Set(data.completions.map((row) => row.userId)).size)}</strong>
                <span>People completing</span>
              </div>
              <div>
                <strong>{number(data.completions.length)}</strong>
                <span>Guide completions</span>
              </div>
              <div>
                <strong className={s.warning}>{number(counts.overdue)}</strong>
                <span>Assignments overdue</span>
              </div>
            </div>
            <p className={s.muted}>
              Completions in the selected UTC period. Assignments are current, independent of the period.
            </p>
          </div>
          <div>
            <div
              className={s.ring}
              aria-hidden="true"
              style={{
                background: `conic-gradient(#8fe0bf 0% ${completePercent}%, #ffc17c ${completePercent}% ${completePercent + outstandingPercent}%, #8b8fa7 ${completePercent + outstandingPercent}% 100%)`,
              }}
            >
              <div className={s.ringInner}>
                <strong>
                  {counts.complete} / {active}
                </strong>
                <span>{partial ? 'recorded complete' : 'complete'}</span>
              </div>
            </div>
            <div className={s.legend}>
              <span className={s.success}>{number(counts.complete)} complete</span>
              <span className={s.warning}>{number(counts.outstanding)} outstanding</span>
              <span>
                {counts.unknown} unknown{partial ? ' in returned records' : ''}
              </span>
            </div>
            <p className={s.muted} style={{ textAlign: 'center', marginTop: 12 }}>
              {number(active)} active obligations · {number(counts.overdue)} of the recorded outstanding are overdue.{' '}
              {counts.withdrawn} withdrawn.
            </p>
            {partial && <p className={s.muted}>Ring shows returned obligations only, not the whole stack.</p>}
          </div>
        </div>
      </section>
      <div className={s.header}>
        <span className={s.badge}>Completion records</span>
        <span className={s.muted}>
          No roster or adoption percentage. Completion evidence is not a measure of mastery.
        </span>
      </div>
      <div className={s.grid}>
        <section className={s.section} aria-labelledby="momentum-title">
          <div className={s.header}>
            <div>
              <h2 id="momentum-title">Learning momentum</h2>
              <p className={s.muted}>Each person and source-qualified guide counts once per period.</p>
            </div>
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
          <div aria-hidden="true">
            <div className={s.chart}>
              {trend.map((bucket) => (
                <div className={s.barColumn} key={bucket.from}>
                  <strong>{bucket.count}</strong>
                  <div className={s.bar} style={{ height: `${(bucket.count / max) * 125}px` }} />
                </div>
              ))}
            </div>
            <div className={s.chartLabels}>
              {trend.map((bucket) => (
                <span key={bucket.from}>{utcDate(bucket.from)}</span>
              ))}
            </div>
          </div>
          <details style={{ marginTop: 16 }}>
            <summary>View trend data (UTC)</summary>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <caption>
                  {partial
                    ? 'Observed completions; missing evidence may change interval placement'
                    : 'Guide completions'}{' '}
                  by interval [from, to)
                </caption>
                <thead>
                  <tr>
                    <th scope="col">From, inclusive</th>
                    <th scope="col">To, exclusive</th>
                    <th scope="col">Completions</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((bucket) => (
                    <tr key={bucket.from}>
                      <td>{utcTime(bucket.from)}</td>
                      <td>{utcTime(bucket.to)}</td>
                      <td>{bucket.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {!rows.length && (
            <p className={s.muted}>No completion records returned for this period and content filter.</p>
          )}
        </section>
        <section className={s.section} aria-labelledby="focus-title">
          <h2 id="focus-title">Where to focus</h2>
          <div className={s.row}>
            <div className={s.rowTitle}>
              <span className={s.medallion}>
                <InsightsSymbol kind="clock" />
              </span>
              <div>
                <h3>{number(counts.overdue)} overdue assignments</h3>
                <p className={s.muted}>Review due dates and recorded evidence.</p>
                <button className={s.textButton} onClick={() => onAssignments('overdue')}>
                  Review overdue assignments →
                </button>
              </div>
            </div>
          </div>
          <div className={s.row}>
            <div className={s.rowTitle}>
              <span className={s.medallion}>
                <InsightsSymbol kind="info" />
              </span>
              <div>
                <h3>{number(counts.unknown)} unknown statuses</h3>
                <p className={s.muted}>Unresolved targets or incomplete evidence are not outstanding.</p>
                <button className={s.textButton} onClick={() => onAssignments('unknown')}>
                  Check unknown assignments →
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className={s.grid}>
        <section className={s.section} aria-labelledby="ranking-title">
          <h2 id="ranking-title">What people are completing</h2>
          <p className={s.muted}>
            Most completed guides · {partial ? 'ranking of returned records only' : 'unique people in this period'}
          </p>
          {!rankings.length && <p>No guide completions recorded in this period.</p>}
          {rankings.slice(0, 8).map(({ key, row, count }) => {
            const link = learningLink(row.guideSource, row.guideId, 'guide');
            return (
              <div key={key} className={s.row}>
                <div className={s.rowTitle}>
                  <span className={s.medallion}>
                    <InsightsSymbol kind="book" />
                  </span>
                  <div>
                    {link ? (
                      <a href={link}>{row.guideTitle || row.guideId}</a>
                    ) : (
                      <strong>{row.guideTitle || row.guideId}</strong>
                    )}
                    <div className={s.muted}>{row.guideSource} · Guide</div>
                  </div>
                </div>
                <strong>{number(count)} people</strong>
              </div>
            );
          })}
          {rankings.length > 8 && (
            <p className={s.muted}>
              Showing the top 8 of {rankings.length} recorded guides. Use the content filter to inspect any guide.
            </p>
          )}
        </section>
        <section className={s.section} aria-labelledby="recent-title">
          <h2 id="recent-title">Recent completions</h2>
          <p className={s.muted}>Earliest qualifying completion per person and guide in this period.</p>
          {!rows.length && <p>No matching completions.</p>}
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
                  <div className={s.muted}>
                    {row.guideSource} · {row.source || 'Method not recorded'}
                  </div>
                </div>
                <time className={s.muted} dateTime={row.completedAt}>
                  {utcTime(row.completedAt)}
                </time>
              </div>
            ))}
        </section>
      </div>
    </>
  );
}
