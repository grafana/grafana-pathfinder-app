import React from 'react';

export function InsightsSymbol({ kind }: { kind: 'chart' | 'book' | 'clock' | 'info' }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'chart' && (
        <>
          <path d="M4 4v16h16M7 15l4-5 4 3 5-8" />
          <circle cx="11" cy="10" r="1" />
        </>
      )}
      {kind === 'book' && (
        <>
          <path d="M12 6v15M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Z" />
        </>
      )}
      {kind === 'clock' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 6v6l4 2" />
        </>
      )}
      {kind === 'info' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </>
      )}
    </svg>
  );
}
