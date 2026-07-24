import React, { useRef, useState } from 'react';
import { useStyles2 } from '@grafana/ui';
import type { ViewMode } from '../types';
import { getHeaderStyles } from './header.styles';

export interface HeaderTitleRowProps {
  guideTitle: string;
  /** Guide ID — null means not yet assigned (hides the ID display). */
  guideId: string | null;
  viewMode: ViewMode;
  /** Called when the title is committed (blur or Enter). */
  onTitleCommit: (title: string) => void;
}

/**
 * Editable guide title + id. In preview mode the rendered content already shows
 * the guide title as an `<h1>` (matching production), so the editable input is
 * replaced by a flex spacer to avoid duplicating that heading.
 */
export function HeaderTitleRow({ guideTitle, guideId, viewMode, onTitleCommit }: HeaderTitleRowProps) {
  const styles = useStyles2(getHeaderStyles);

  const [titleDraft, setTitleDraft] = useState(guideTitle);
  // Keep the draft in sync when the title changes externally (e.g. guide loaded
  // from library) — the "adjust state during render" pattern, no effect needed.
  const [lastSyncedTitle, setLastSyncedTitle] = useState(guideTitle);
  if (guideTitle !== lastSyncedTitle) {
    setLastSyncedTitle(guideTitle);
    setTitleDraft(guideTitle);
  }
  const titleInputRef = useRef<HTMLInputElement>(null);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(guideTitle); // revert if cleared
      return;
    }
    if (trimmed !== guideTitle) {
      onTitleCommit(trimmed);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      titleInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setTitleDraft(guideTitle);
      titleInputRef.current?.blur();
    }
  };

  if (viewMode === 'preview') {
    return <div className={styles.titleArea} aria-hidden="true" />;
  }

  return (
    <div className={styles.titleArea}>
      <input
        ref={titleInputRef}
        className={styles.guideTitleInput}
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={handleTitleKeyDown}
        aria-label="Guide title"
      />
      {guideId && <div className={`${styles.guideId} guide-id`}>({guideId})</div>}
    </div>
  );
}

HeaderTitleRow.displayName = 'HeaderTitleRow';
