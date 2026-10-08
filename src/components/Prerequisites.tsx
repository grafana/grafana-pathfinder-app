import React, { useId } from 'react';
import { css } from '@emotion/css';

interface Prerequisite {
  id: string;
  label: string;
}

const containerClass = css`
  margin: 0 0 16px;
  padding: 12px 16px;
  border-left: 2px solid var(--grafana-colors-border-strong);
  background: var(--grafana-colors-background-secondary);
`;

const headingClass = css`
  margin: 0 0 8px;
  font-size: 1rem;
`;

const listClass = css`
  margin: 0;
  padding-left: 20px;
`;

function getPrerequisites(value: unknown): Prerequisite[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Prerequisite =>
      item !== null &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.label === 'string' &&
      item.id.length > 0 &&
      item.label.length > 0
  );
}

export function Prerequisites({ prerequisites }: { prerequisites: unknown }) {
  const headingId = useId();
  const items = getPrerequisites(prerequisites);
  if (items.length === 0) {
    return null;
  }

  return (
    <section className={containerClass} aria-labelledby={headingId}>
      <h3 className={headingClass} id={headingId}>
        Prerequisites
      </h3>
      <ul className={listClass} data-testid="prerequisites-list">
        {items.map(({ id, label }) => (
          <li key={id}>{label}</li>
        ))}
      </ul>
    </section>
  );
}
