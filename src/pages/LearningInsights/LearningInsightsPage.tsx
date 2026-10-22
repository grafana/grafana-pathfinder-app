import React, { useRef, useState } from 'react';
import { config } from '@grafana/runtime';
import { dateMath, dateTime, type RawTimeRange, type TimeRange } from '@grafana/data';
import { RefreshPicker, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { useLearningInsights } from '../../hooks';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { Assignments } from './Assignments';
import { Overview } from './Overview';
import { CompletionScope } from './CompletionScope';
import { PersonEvidence } from './PersonEvidence';
import { personName } from './insights.helpers';
import { insightsQuality } from './insights-quality';
import { getStyles } from './learning-insights.styles';

export interface LearningInsightsViewProps {
  data: LearningInsightsResponse | null;
  loading?: boolean;
  error?: string | null;
  refresh: () => void;
  timeRange?: TimeRange;
  onTimeRange?: (range: TimeRange) => void;
  onTimeZone?: (zone: string) => void;
}

function reportRange(raw: RawTimeRange, timeZone = 'utc'): TimeRange {
  return { from: dateMath.parse(raw.from, false, timeZone)!, to: dateMath.parse(raw.to, false, timeZone)!, raw };
}
const initialRange = () => reportRange({ from: 'now-28d/d', to: 'now/d' });

export function LearningInsightsView({
  data,
  loading = false,
  error = null,
  refresh,
  timeRange,
  onTimeRange,
  onTimeZone,
}: LearningInsightsViewProps) {
  const s = useStyles2(getStyles);
  const [timeZone, setTimeZone] = useState('utc');
  const displayZone =
    timeZone === 'browser'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : timeZone.toUpperCase() === 'UTC'
        ? 'UTC'
        : timeZone;
  const [view, setView] = useState('overview');
  const [status, setStatus] = useState('');
  const [visiblePeople, setVisiblePeople] = useState(50);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [localRange, setLocalRange] = useState(() =>
    data ? reportRange({ from: data.from, to: data.to }) : initialRange()
  );
  const personPicker = useRef<HTMLSelectElement>(null);
  const range = timeRange ?? localRange;
  const changeRange = (next: TimeRange) => {
    const normalized = reportRange(next.raw, timeZone);
    setLocalRange(normalized);
    onTimeRange?.(normalized);
  };
  const shiftRange = (factor: number, zoom = false) => {
    const width = range.to.valueOf() - range.from.valueOf();
    const from = dateTime(range.from.valueOf() + width * factor);
    const to = dateTime(range.to.valueOf() + width * factor + (zoom ? width : 0));
    changeRange({ from, to, raw: { from, to } });
  };
  const selectPerson = (userId: string) => {
    setSelectedPerson(userId);
    setStatus('');
    setView('assignments');
  };
  const changeView = (next: string) => {
    setView(next);
    setSelectedPerson('');
    setStatus('');
  };
  const reviewAssignments = (nextStatus: string) => {
    changeView('assignments');
    setStatus(nextStatus);
  };
  const quality = data ? insightsQuality(data) : null;
  const subjects = data
    ? Array.from(
        new Set([
          ...data.people.map((person) => person.userId),
          ...data.assignments.map((row) => row.userId),
          ...data.completions.map((row) => row.userId),
        ])
      )
    : [];
  return (
    <main className={s.page} aria-labelledby="learning-insights-title" aria-busy={loading}>
      <header className={s.header}>
        <h1 id="learning-insights-title">Learning insights</h1>
        <div className={s.controls}>
          <TimeRangePicker
            value={range}
            timeZone={timeZone}
            onChangeTimeZone={(zone) => {
              setTimeZone(zone);
              onTimeZone?.(zone);
              const next = reportRange(range.raw, zone);
              setLocalRange(next);
              onTimeRange?.(next);
            }}
            onChange={changeRange}
            onMoveBackward={() => shiftRange(-1)}
            onMoveForward={() => shiftRange(1)}
            onZoom={() => shiftRange(-0.5, true)}
            quickRanges={[
              { from: 'now-7d/d', to: 'now/d', display: 'Last 7 complete days' },
              { from: 'now-28d/d', to: 'now/d', display: 'Last 28 complete days' },
              { from: 'now-90d/d', to: 'now/d', display: 'Last 90 complete days' },
            ]}
          />
          <RefreshPicker
            onRefresh={refresh}
            onIntervalChanged={() => undefined}
            noIntervalPicker
            isLoading={loading}
            text="Refresh"
          />
        </div>
      </header>
      <nav className={s.tabs} aria-label="Learning insights views">
        <button className={s.tab} aria-pressed={view === 'overview'} onClick={() => changeView('overview')}>
          Overview
        </button>
        <button className={s.tab} aria-pressed={view === 'assignments'} onClick={() => changeView('assignments')}>
          Assignments and people
        </button>
      </nav>
      {loading && (
        <div className={s.notice} role="status">
          Loading learning records…
        </div>
      )}
      {!loading && error && (
        <div className={s.notice} role="alert">
          <h2>Learning insights could not be loaded</h2>
          <p>{error}</p>
          <p>
            Check your current organization and admin permissions, then try Refresh. No previous results are shown as
            current.
          </p>
        </div>
      )}
      {!loading && !error && !data && <p className={s.notice}>No response is available. Try Refresh.</p>}
      {!loading && !error && data && !data.capability.available && (
        <section className={s.notice}>
          <h2>Learning insights is unavailable</h2>
          <p>
            Reporting is not available for this stack or identity. Ask your Grafana administrator to check reporting
            configuration and access. No zero totals are inferred.
          </p>
        </section>
      )}
      {!loading && !error && data?.capability.available && (
        <>
          {quality!.notices.map((notice) => (
            <p key={notice} className={s.notice} role="status">
              {notice}
            </p>
          ))}
          {!subjects.length && !quality!.completionsIncomplete && !quality!.assignmentsIncomplete && (
            <p className={s.empty}>
              No learning records returned for this organization. People appear when they have completion or assignment
              records.
            </p>
          )}
          {view === 'overview' ? (
            <Overview
              data={data}
              styles={s}
              onPerson={selectPerson}
              onAssignments={reviewAssignments}
              timeZone={displayZone}
            />
          ) : (
            <>
              <label className={s.personFilter}>
                Person
                <select
                  ref={personPicker}
                  value={selectedPerson}
                  onChange={(event) => setSelectedPerson(event.target.value)}
                >
                  <option value="">All people</option>
                  {subjects.map((userId) => (
                    <option key={userId} value={userId}>
                      {personName(
                        data.people.find((person) => person.userId === userId),
                        userId
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <div className={selectedPerson ? s.grid : undefined}>
                <Assignments
                  data={data}
                  styles={s}
                  status={status}
                  onStatus={setStatus}
                  selectedPerson={selectedPerson}
                  onPerson={setSelectedPerson}
                  timeZone={displayZone}
                />
                <div id="learner-evidence">
                  {selectedPerson && (
                    <PersonEvidence
                      key={selectedPerson}
                      data={data}
                      userId={selectedPerson}
                      styles={s}
                      timeZone={displayZone}
                      onClose={() => {
                        setSelectedPerson('');
                        personPicker.current?.focus();
                      }}
                    />
                  )}
                </div>
              </div>
              {!selectedPerson && (
                <section className={s.section} aria-labelledby="people-title">
                  <h2 id="people-title">People</h2>
                  {quality!.ambiguous && <CompletionScope styles={s} />}
                  <p className={s.muted}>
                    People with available learning records, not an organization roster. Completion counts use the
                    selected period.
                  </p>
                  {!subjects.length && (
                    <p>
                      No people available
                      {quality!.completionsIncomplete || quality!.assignmentsIncomplete
                        ? '; some records could not be loaded'
                        : ''}
                      .
                    </p>
                  )}
                  <div className={s.peopleGrid}>
                    {subjects.slice(0, visiblePeople).map((userId) => (
                      <div key={userId} className={s.row}>
                        <button
                          className={s.textButton}
                          aria-label={`Inspect ${personName(
                            data.people.find((person) => person.userId === userId),
                            userId
                          )}`}
                          onClick={() => selectPerson(userId)}
                        >
                          {personName(
                            data.people.find((person) => person.userId === userId),
                            userId
                          )}
                        </button>
                        <span className={s.muted}>
                          {data.completions.filter((row) => row.userId === userId).length} guide completion
                          {data.completions.filter((row) => row.userId === userId).length === 1 ? '' : 's'} ·{' '}
                          {data.assignments.filter((row) => row.userId === userId).length} assignment
                          {data.assignments.filter((row) => row.userId === userId).length === 1 ? '' : 's'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {subjects.length > visiblePeople && (
                    <button className={s.button} onClick={() => setVisiblePeople((value) => value + 50)}>
                      Show more people ({Math.min(visiblePeople, subjects.length)} of {subjects.length})
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function AuthorizedLearningInsights() {
  const [timeZone, setTimeZone] = useState('utc');
  const [timeRange, setTimeRange] = useState(initialRange);
  const result = useLearningInsights(timeRange.from.toISOString(), timeRange.to.toISOString());
  const refresh = () => {
    const next = reportRange(timeRange.raw, timeZone);
    if (next.from.valueOf() !== timeRange.from.valueOf() || next.to.valueOf() !== timeRange.to.valueOf()) {
      setTimeRange(next);
    } else {
      result.refresh();
    }
  };
  return (
    <LearningInsightsView
      {...result}
      refresh={refresh}
      timeRange={timeRange}
      onTimeRange={setTimeRange}
      onTimeZone={setTimeZone}
    />
  );
}

export default function LearningInsightsPage() {
  const s = useStyles2(getStyles);
  const user = config.bootData.user;
  if (user?.orgRole !== 'Admin') {
    return (
      <main className={s.page}>
        <h1>Learning insights</h1>
        <p className={s.notice}>
          Learning insights is available to current-organization admins. Switch to an organization you administer or ask
          an admin for access.
        </p>
      </main>
    );
  }
  return <AuthorizedLearningInsights />;
}
