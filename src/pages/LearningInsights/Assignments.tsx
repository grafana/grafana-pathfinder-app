import React, { useState } from 'react';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { personName, utcTime } from './insights.helpers';
import type { InsightsStyles } from './learning-insights.styles';

interface Props {
  data: LearningInsightsResponse;
  styles: InsightsStyles;
  status: string;
  onStatus: (status: string) => void;
  selectedPerson: string;
  onPerson: (userId: string) => void;
}

export function Assignments({ data, styles: s, status, onStatus, selectedPerson, onPerson }: Props) {
  const [rule, setRule] = useState('');
  const [target, setTarget] = useState('');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const people = new Map(data.people.map((person) => [person.userId, person]));
  const targets = Array.from(
    new Map(
      data.assignments.map((row) => [JSON.stringify([row.targetType, row.targetSource, row.targetId]), row])
    ).entries()
  );
  const rows = data.assignments.filter(
    (row) =>
      (!rule || (row.ruleId || '__unrecorded') === rule) &&
      (!target || JSON.stringify([row.targetType, row.targetSource, row.targetId]) === target) &&
      (!status || row.status === status) &&
      (!search ||
        `${personName(people.get(row.userId), row.userId)} ${row.userId} ${people.get(row.userId)?.userLogin || ''}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()))
  );
  return (
    <section aria-labelledby="assignments-title">
      <h2 id="assignments-title">Who needs a follow-up?</h2>
      <p className={s.muted}>
        Current recipient obligations, independent of the completion period. Overdue is a subset of outstanding; unknown
        is separate.
      </p>
      <div className={s.filters}>
        <label>
          Find a person
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, login or subject"
          />
        </label>
        <label>
          Wave or rule
          <select value={rule} onChange={(event) => setRule(event.target.value)}>
            <option value="">All rules</option>
            {Array.from(new Set(data.assignments.map((row) => row.ruleId || '__unrecorded')))
              .sort()
              .map((value) => (
                <option key={value} value={value}>
                  {value === '__unrecorded' ? 'No recorded rule' : value}
                </option>
              ))}
          </select>
        </label>
        <label>
          Target
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">All targets</option>
            {targets.map(([key, row]) => (
              <option value={key} key={key}>
                {row.targetId} · {row.targetSource} · {row.targetType}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => onStatus(event.target.value)}>
            <option value="">All statuses</option>
            {['complete', 'outstanding', 'overdue', 'unknown', 'withdrawn'].map((value) => (
              <option value={value} key={value}>
                {value === 'outstanding' ? 'Outstanding (not overdue)' : value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Assignment records, scroll for more columns">
        <table className={s.table}>
          <caption>
            {data.completeness === 'partial' ? 'Returned' : 'Recorded'} assignments · {rows.length} matching obligations
            · Showing {Math.min(visibleCount, rows.length)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Target / rule</th>
              <th scope="col">Guides credited</th>
              <th scope="col">Status</th>
              <th scope="col">Due (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, visibleCount).map((row) => {
              const completed = row.guides.filter((guide) => guide.completed).length;
              const resolved = row.status !== 'unknown' && row.guides.length > 0;
              return (
                <tr key={row.name} aria-selected={selectedPerson === row.userId}>
                  <td>
                    <button
                      className={s.textButton}
                      onClick={() => onPerson(row.userId)}
                      aria-expanded={selectedPerson === row.userId}
                      aria-controls="learner-evidence"
                    >
                      {personName(people.get(row.userId), row.userId)}
                    </button>
                  </td>
                  <td>
                    {row.targetId}
                    <div className={s.muted}>
                      {row.targetSource} · {row.targetType}
                      <br />
                      {row.ruleId || 'No recorded rule'}
                    </div>
                  </td>
                  <td>
                    {resolved ? (
                      <>
                        {completed} / {row.guides.length}
                        <progress value={completed} max={row.guides.length} aria-label="Required guides credited" />
                      </>
                    ) : (
                      'Unknown'
                    )}
                  </td>
                  <td
                    className={row.status === 'complete' ? s.success : row.status === 'overdue' ? s.warning : undefined}
                  >
                    {row.status === 'complete'
                      ? '✓ Complete'
                      : row.status === 'unknown'
                        ? 'Unknown'
                        : row.status === 'overdue'
                          ? 'Overdue'
                          : row.status === 'withdrawn'
                            ? 'Withdrawn'
                            : 'Outstanding'}
                  </td>
                  <td>{row.dueAt ? utcTime(row.dueAt) : 'No due date'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className={s.notice}>
          {data.assignments.length
            ? 'No assignments match these filters.'
            : 'No assignment records returned. This is not an all-member roster.'}
        </p>
      )}
      {rows.length > visibleCount && (
        <button className={s.button} onClick={() => setVisibleCount((value) => value + 50)}>
          Show 50 more obligations
        </button>
      )}
      <p className={s.muted} style={{ marginTop: 16 }}>
        Select a person to inspect current required guides, credited evidence and learning links. No reminder is sent.
      </p>
    </section>
  );
}
