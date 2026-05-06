/**
 * `SuggestedRequirementsRow` — in-form companion to the Health panel's
 * `requirementsImpliedByActionButNotDeclared` diagnostic.
 *
 * Computes the requirements `suggestRequirementsFromContext` would
 * propose for the current (action, reftarget, position) and renders
 * one chip per missing token. Authors can click an individual chip to
 * apply that one, or "Apply all" to merge the entire suggestion set
 * into the requirements field.
 *
 * Renders nothing when no suggestions are missing, so the form stays
 * tidy when the author has already declared what's expected.
 */

import React, { useMemo } from 'react';
import { Badge, Button, Stack, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { mergeRequirements, suggestRequirementsFromContext } from './requirements-suggester';

export interface SuggestedRequirementsRowProps {
  /** The block's action (highlight / button / formfill / …). */
  action: string;
  /** The reftarget (CSS selector or button text). */
  reftarget: string;
  /** Current value of the requirements field, comma-separated. */
  requirements: string;
  /** Called with the merged comma-separated requirements value. */
  onApply: (next: string) => void;
  /** True iff this block is the first executable block in the guide. */
  isFirstStepInGuide?: boolean;
  /** True iff this requirement set is being edited inside a multistep / guided block. */
  isInsideMultistep?: boolean;
}

function getCurrentPath(): string | undefined {
  try {
    return window.location.pathname;
  } catch {
    return undefined;
  }
}

export function SuggestedRequirementsRow({
  action,
  reftarget,
  requirements,
  onApply,
  isFirstStepInGuide = false,
  isInsideMultistep = false,
}: SuggestedRequirementsRowProps) {
  const styles = useStyles2(getStyles);

  const missing = useMemo(() => {
    const declared = new Set(
      requirements
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
    );
    const suggested = suggestRequirementsFromContext(action, reftarget, {
      isFirstStepInGuide,
      isInsideMultistep,
      currentPath: getCurrentPath(),
    });
    return suggested.filter((s) => !declared.has(s));
  }, [action, reftarget, requirements, isFirstStepInGuide, isInsideMultistep]);

  if (missing.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <Stack direction="row" alignItems="center" gap={1} wrap="wrap">
        <span className={styles.label}>Suggested for this action:</span>
        {missing.map((token) => (
          <Badge
            key={token}
            text={token}
            color="blue"
            tooltip="Click to add"
            className={styles.chip}
            onClick={() => onApply(mergeRequirements(requirements, [token]))}
          />
        ))}
        {missing.length > 1 && (
          <Button
            size="sm"
            variant="secondary"
            fill="text"
            type="button"
            icon="check-circle"
            onClick={() => onApply(mergeRequirements(requirements, missing))}
          >
            Apply all
          </Button>
        )}
      </Stack>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    marginTop: theme.spacing(0.5),
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.info.transparent,
    borderLeft: `3px solid ${theme.colors.info.border}`,
  }),
  label: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  chip: css({
    cursor: 'pointer',
  }),
});
