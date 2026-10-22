import React, { useId, useRef, useState } from 'react';
import { Combobox } from '@grafana/ui';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { personName, displayTime, assignmentTitle, assignmentStatus, assignmentIssue } from './insights.helpers';
import { insightsQuality } from './insights-quality';
import { AssignmentEvidence } from './AssignmentEvidence';
import type { InsightsStyles } from './learning-insights.styles';

interface Props {
  data: LearningInsightsResponse;
  styles: InsightsStyles;
  status: string;
  onStatus: (status: string) => void;
  selectedPerson: string;
  onPerson: (userId: string) => void;
  timeZone?: string;
}

export function Assignments({ data, styles: s, status, onStatus, selectedPerson, onPerson, timeZone = 'UTC' }: Props) {
  const quality = insightsQuality(data);
  const contentInputId = useId();
  const [target, setTarget] = useState('');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedAssignment, setSelectedAssignment] = useState('');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const people = new Map(data.people.map((person) => [person.userId, person]));
  const targets = Array.from(
    new Map(
      data.assignments.map((row) => [JSON.stringify([row.targetType, row.targetSource, row.targetId]), row])
    ).entries()
  );
  const rows = data.assignments.filter(
    (row) =>
      (!selectedPerson || row.userId === selectedPerson) &&
      (!target || JSON.stringify([row.targetType, row.targetSource, row.targetId]) === target) &&
      (!status || row.status === status) &&
      (selectedPerson ||
        !search ||
        `${personName(people.get(row.userId), row.userId)} ${row.userId} ${people.get(row.userId)?.userLogin || ''}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()))
  );
  const selected = rows.find((row) => row.name === selectedAssignment);
  if (!data.assignments.length) {
    return (
      <section aria-labelledby="assignments-title">
        <h2 id="assignments-title">Assignments</h2>
        <p className={s.empty}>
          {quality.assignmentsIncomplete
            ? 'Assignments could not all be loaded. Refresh to retry.'
            : 'No assignments yet.'}
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="assignments-title">
      <h2 id="assignments-title">
        {selectedPerson ? `Assignments for ${personName(people.get(selectedPerson), selectedPerson)}` : 'Assignments'}
      </h2>
      <div className={s.filters}>
        {!selectedPerson && (
          <label>
            Find a person
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or login"
            />
          </label>
        )}
        <label htmlFor={contentInputId}>
          Learning content
          <Combobox
            id={contentInputId}
            aria-label="Learning content"
            placeholder="Search learning content"
            value={target || null}
            isClearable
            options={targets.map(([key, row]) => ({
              value: key,
              label: assignmentTitle(row, data.completions),
              description: `${row.targetType} · ${row.targetSource}`,
            }))}
            onChange={(option) => setTarget(option?.value ?? '')}
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => onStatus(event.target.value)}>
            <option value="">All statuses</option>
            {(['complete', 'outstanding', 'overdue', 'unknown', 'withdrawn'] as const).map((value) => (
              <option value={value} key={value}>
                {value === 'outstanding' ? 'Outstanding (not overdue)' : assignmentStatus(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Assignment records, scroll for more columns">
        <table className={s.table}>
          <caption>
            {quality.assignmentsIncomplete ? 'Partial assignment list' : 'Current assignments'} · {rows.length} matching
            {rows.length > visibleCount ? ` · Showing ${visibleCount}` : ''}
          </caption>
          <thead>
            <tr>
              {!selectedPerson && <th scope="col">Person</th>}
              <th scope="col">Learning content</th>
              <th scope="col">Completion</th>
              <th scope="col">Status</th>
              <th scope="col">Due ({timeZone})</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, visibleCount).map((row) => {
              const completed = row.guides.filter((guide) => guide.completed).length;
              const checkable = row.status !== 'unknown' && row.guides.length > 0;
              return (
                <tr key={row.name} aria-selected={selectedAssignment === row.name}>
                  {!selectedPerson && (
                    <td>
                      <button className={s.textButton} onClick={() => onPerson(row.userId)}>
                        {personName(people.get(row.userId), row.userId)}
                      </button>
                    </td>
                  )}
                  <td>
                    <button
                      className={s.textButton}
                      aria-expanded={selected?.name === row.name}
                      aria-controls="assignment-details"
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setSelectedAssignment(row.name);
                      }}
                    >
                      {assignmentTitle(row, data.completions)}
                    </button>
                  </td>
                  <td>
                    {row.status === 'withdrawn' ? (
                      '—'
                    ) : checkable ? (
                      row.guides.length === 1 ? (
                        completed ? (
                          'Complete'
                        ) : (
                          'No completion recorded'
                        )
                      ) : (
                        <>
                          {completed} of {row.guides.length} guides
                          <progress
                            value={completed}
                            max={row.guides.length}
                            aria-label="Guides completed for this assignment"
                          />
                        </>
                      )
                    ) : row.guides.length > 0 ? (
                      `${completed} completed · check incomplete`
                    ) : (
                      'Cannot check'
                    )}
                  </td>
                  <td
                    className={row.status === 'complete' ? s.success : row.status === 'overdue' ? s.warning : undefined}
                  >
                    {assignmentStatus(row.status)}
                    {row.status === 'unknown' && (
                      <details className={s.completionScope}>
                        <summary>Why?</summary>
                        <p>{assignmentIssue(row.reason)}</p>
                      </details>
                    )}
                  </td>
                  <td>
                    {row.dueAt ? (
                      <time dateTime={row.dueAt} title={row.dueAt}>
                        {displayTime(row.dueAt, timeZone)}
                      </time>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className={s.notice}>No assignments match these filters.</p>}
      {rows.length > visibleCount && (
        <button className={s.button} onClick={() => setVisibleCount((value) => value + 50)}>
          Show 50 more assignments
        </button>
      )}
      {selected && (
        <AssignmentEvidence
          key={selected.name}
          assignment={selected}
          data={data}
          styles={s}
          timeZone={timeZone}
          onClose={() => {
            setSelectedAssignment('');
            trigger.current?.focus();
          }}
        />
      )}
    </section>
  );
}
