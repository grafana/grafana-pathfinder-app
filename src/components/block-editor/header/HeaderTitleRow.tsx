import React, { useRef, useState } from 'react';
import { useStyles2 } from '@grafana/ui';
import { getHeaderStyles } from './header.styles';

export interface HeaderTitleRowProps {
  guideTitle: string;
  /** Called when the title is committed (blur or Enter). */
  onTitleCommit: (title: string) => void;
}

// The input's `size` (character count) content-sizes it so the gradient
// underline hugs the title. Approximate under a proportional font; clamped so
// it stays usable when empty and bounded when the title is long (the row shrinks
// it further at narrow widths).
const MIN_TITLE_CHARS = 8;
const MAX_TITLE_CHARS = 60;

export function HeaderTitleRow({ guideTitle, onTitleCommit }: HeaderTitleRowProps) {
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

  return (
    <div className={styles.titleInputWrap}>
      <input
        ref={titleInputRef}
        className={styles.guideTitleInput}
        value={titleDraft}
        size={Math.min(Math.max(titleDraft.length + 1, MIN_TITLE_CHARS), MAX_TITLE_CHARS)}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={handleTitleKeyDown}
        aria-label="Guide title"
      />
    </div>
  );
}

HeaderTitleRow.displayName = 'HeaderTitleRow';
