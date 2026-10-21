import React, { useRef, useState } from 'react';
import { config } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { InsightsSymbol } from './InsightsSymbol';
import { useLearningInsights } from '../../hooks/useLearningInsights';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { Assignments } from './Assignments';
import { Overview } from './Overview';
import { PersonEvidence } from './PersonEvidence';
import { defaultWindow, personName, utcTime } from './insights.helpers';
import { getStyles } from './learning-insights.styles';

export interface LearningInsightsViewProps {
  data: LearningInsightsResponse | null;
  loading?: boolean;
  error?: string | null;
  refresh: () => void;
  period?: string;
  onPeriod?: (days: string) => void;
}

export function LearningInsightsView({
  data,
  loading = false,
  error = null,
  refresh,
  period = '28',
  onPeriod,
}: LearningInsightsViewProps) {
  const s = useStyles2(getStyles);
  const [view, setView] = useState('overview');
  const [status, setStatus] = useState('');
  const [selectedPerson, setSelectedPerson] = useState('');
  const personPicker = useRef<HTMLSelectElement>(null);
  const selectPerson = (userId: string) => {
    setSelectedPerson(userId);
    setView('assignments');
  };
  const changeView = (next: string) => {
    setView(next);
    setSelectedPerson('');
  };
  const reviewAssignments = (nextStatus: string) => {
    setStatus(nextStatus);
    changeView('assignments');
  };
  const available = data?.capability.available;
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
        <div className={s.title}>
          <span className={s.medallion}>
            <InsightsSymbol kind="chart" />
          </span>
          <h1 id="learning-insights-title">Learning insights</h1>
          <span className={s.badge}>Admins</span>
        </div>
        <div className={s.header} style={{ marginBottom: 0 }}>
          <label>
            Completion period
            <select value={period} onChange={(event) => onPeriod?.(event.target.value)} disabled={!onPeriod || loading}>
              <option value="7">Last 7 complete days</option>
              <option value="28">Last 28 complete days</option>
              <option value="90">Last 90 complete days</option>
            </select>
          </label>
          <button className={s.button} onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>
      <p className={s.muted}>
        Recorded learning evidence for your current organization. Access is verified by the server.
      </p>
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
      {!loading && !error && data && !available && (
        <section className={s.notice}>
          <h2>Learning insights is unavailable</h2>
          <p>Reporting is not available for this stack or identity. No zero totals are inferred.</p>
          {data.capability.reason && <p className={s.muted}>Reason: {data.capability.reason}</p>}
        </section>
      )}
      {!loading && !error && data && available && (
        <>
          <p className={s.muted}>
            Completion window [from, to): <time dateTime={data.from}>{utcTime(data.from)}</time> (inclusive) →{' '}
            <time dateTime={data.to}>{utcTime(data.to)}</time> (exclusive).
          </p>
          <p className={s.muted}>
            Snapshot as of: {data.asOf ? utcTime(data.asOf) : 'Not available'} · Source: completion and assignment
            records · {data.completeness === 'partial' ? 'Partial evidence' : 'Complete bounded read'} · Refresh to
            update this snapshot.
          </p>
          {data.completeness === 'partial' && (
            <div className={s.notice} role="status">
              <strong>Partial results — counts are lower bounds, not stack totals.</strong>
              <p>
                Some records could not be read. Ranking and assignment shares describe returned records only; unresolved
                assignment evidence stays unknown.
              </p>
            </div>
          )}
          {!!data.warnings.length && (
            <details className={s.notice}>
              <summary>Source warnings ({data.warnings.length})</summary>
              <ul>
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          {!subjects.length && (
            <p className={s.notice}>
              No learning records returned for this organization. People appear only when a completion or assignment
              record exists; this is not a roster.
            </p>
          )}
          {view === 'overview' ? (
            <Overview data={data} styles={s} onPerson={selectPerson} onAssignments={reviewAssignments} />
          ) : (
            <>
              <section className={s.hero}>
                <div className={s.eyebrow}>Current learning obligations</div>
                <h2>Make the next step clearer.</h2>
                <p>Review assignments alongside the evidence. Offer support, not assumptions.</p>
                <p className={s.muted}>
                  Assignment evaluation uses older completion history and acceptance cutoffs, not only the chart period.
                </p>
              </section>
              <label>
                Recorded person
                <select
                  ref={personPicker}
                  value={selectedPerson}
                  onChange={(event) => setSelectedPerson(event.target.value)}
                >
                  <option value="">Choose a person to inspect</option>
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
                />
                <div id="learner-evidence">
                  {selectedPerson && (
                    <PersonEvidence
                      key={selectedPerson}
                      data={data}
                      userId={selectedPerson}
                      styles={s}
                      onClose={() => {
                        setSelectedPerson('');
                        personPicker.current?.focus();
                      }}
                    />
                  )}
                </div>
              </div>
            </>
          )}
          <footer className={s.footnote}>
            Names are recorded snapshots, with subject identifiers as fallback. Assignments use current target
            membership, not an immutable content revision. Historical identity changes cannot be reconstructed. Last
            completion is not last activity.
          </footer>
        </>
      )}
    </main>
  );
}

function AuthorizedLearningInsights() {
  const [days, setDays] = useState('28');
  const [window, setWindow] = useState<{ from?: string; to?: string }>({});
  const result = useLearningInsights(window.from, window.to);
  return (
    <LearningInsightsView
      {...result}
      period={days}
      onPeriod={(value) => {
        setDays(value);
        setWindow(defaultWindow(Number(value)));
      }}
    />
  );
}

export default function LearningInsightsPage() {
  const s = useStyles2(getStyles);
  const user = config.bootData.user;
  if (!user?.isGrafanaAdmin && user?.orgRole !== 'Admin') {
    return (
      <main className={s.page}>
        <h1>Learning insights</h1>
        <p className={s.notice}>
          Learning insights is available to stack and current-organization admins. Switch to an organization you
          administer or ask an admin for access.
        </p>
        <p className={s.muted}>
          This browser check is for navigation only. The server independently verifies reporting permissions.
        </p>
      </main>
    );
  }
  return <AuthorizedLearningInsights />;
}
