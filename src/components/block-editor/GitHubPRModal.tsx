/**
 * GitHub PR Modal
 *
 * Modal for creating pull requests to the grafana/interactive-tutorials repository.
 * Shows preparation status, instructions, and opens GitHub when ready.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button, Modal, Alert, Spinner, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { JsonGuide } from './types';
import { prepareGitHubPR, openGitHub, type PRCreationResult } from './utils/github-pr';

/**
 * Generate a PR description template with instructions for the reviewer
 */
function getPRDescriptionTemplate(filename: string, guideTitle: string): string {
  const guideId = filename.replace('.json', '');
  const guideUrl = `https://interactive-learning.grafana.net/guides/${guideId}`;
  
  return `## New interactive guide: ${guideTitle}

### Description
<!-- Briefly describe what this guide teaches -->


### Checklist
- [ ] Guide JSON is valid and renders correctly in the block editor
- [ ] All selectors have been tested in the target Grafana version
- [ ] Guide has appropriate requirements for each step

### Index registration
To make this guide discoverable by the recommender, add an entry to \`index.json\`:

\`\`\`json
{
  "id": "${guideId}",
  "title": "${guideTitle}",
  "type": "docs-page",
  "url": "${guideUrl}",
  "match": {
    "urlPrefix": ["/connections"]
  }
}
\`\`\`

<!-- Adjust urlPrefix based on where this guide should appear -->
`;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),

  statusSection: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
  }),

  statusIcon: css({
    fontSize: '24px',
  }),

  statusText: css({
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
  }),

  statusSubtext: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),

  infoBox: css({
    display: 'flex',
    gap: theme.spacing(2),
    padding: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),

  infoValue: css({
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),

  instructions: css({
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),

  instructionsList: css({
    margin: 0,
    paddingLeft: theme.spacing(2.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    lineHeight: 1.8,

    '& li': {
      marginBottom: theme.spacing(0.5),
    },

    '& strong': {
      color: theme.colors.text.primary,
    },
  }),

  errorList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
    fontSize: theme.typography.bodySmall.fontSize,

    '& li': {
      marginBottom: theme.spacing(0.5),
    },
  }),

  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    paddingTop: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    marginTop: theme.spacing(1),
  }),

  prDescriptionSection: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),

  prDescriptionHeader: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }),

  prDescriptionLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
  }),

  prDescriptionPreview: css({
    margin: 0,
    padding: theme.spacing(1.5),
    fontSize: theme.typography.bodySmall.fontSize,
    fontFamily: theme.typography.fontFamilyMonospace,
    backgroundColor: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '150px',
    overflow: 'auto',
    color: theme.colors.text.secondary,
  }),
});

export interface GitHubPRModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** The guide to create a PR for */
  guide: JsonGuide;
  /** Called to close the modal */
  onClose: () => void;
}

type ModalState =
  | { status: 'preparing' }
  | { status: 'ready'; result: PRCreationResult }
  | { status: 'error'; result: PRCreationResult };

export function GitHubPRModal({ isOpen, guide, onClose }: GitHubPRModalProps) {
  const styles = useStyles2(getStyles);
  const [state, setState] = useState<ModalState>({ status: 'preparing' });

  // Prepare PR when modal opens
  // Note: We only trigger on isOpen to avoid re-running when guide object reference changes
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    setState({ status: 'preparing' });

    prepareGitHubPR(guide)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.status === 'ready') {
          setState({ status: 'ready', result });
        } else {
          setState({ status: 'error', result });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setState({
          status: 'error',
          result: {
            status: 'error',
            message: error instanceof Error ? error.message : 'An unexpected error occurred',
          },
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Handle opening GitHub
  const handleOpenGitHub = useCallback(() => {
    if (state.status === 'ready' && state.result.data) {
      openGitHub(state.result.data.githubUrl);
    }
  }, [state]);

  // Handle close
  const handleClose = useCallback(() => {
    setState({ status: 'preparing' });
    onClose();
  }, [onClose]);

  // Render content based on state
  const renderContent = () => {
    if (state.status === 'preparing') {
      return (
        <div className={styles.statusSection}>
          <Spinner size="xl" />
          <div className={styles.statusText}>Preparing...</div>
          <div className={styles.statusSubtext}>Copying JSON to clipboard and checking repository</div>
        </div>
      );
    }

    if (state.status === 'error') {
      return (
        <>
          <div className={styles.statusSection}>
            <span className={styles.statusIcon}>❌</span>
            <div className={styles.statusText}>{state.result.message}</div>
          </div>

          {state.result.errors && state.result.errors.length > 0 && (
            <Alert title="Issues found" severity="error">
              <ul className={styles.errorList}>
                {state.result.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </Alert>
          )}
        </>
      );
    }

    // Ready state
    const { data } = state.result;
    if (!data) {
      return null;
    }

    return (
      <>
        <div className={styles.statusSection}>
          <span className={styles.statusIcon}>{data.copiedToClipboard ? '📋' : '⚠️'}</span>
          <div className={styles.statusText}>
            {data.copiedToClipboard ? 'JSON copied to clipboard!' : 'Ready to create PR'}
          </div>
        </div>

        {!data.copiedToClipboard && (
          <Alert title="Clipboard access failed" severity="warning">
            Could not copy to clipboard automatically. Click the button below to copy, then paste into GitHub.
            <div style={{ marginTop: '8px' }}>
              <Button
                size="sm"
                icon="copy"
                onClick={() => {
                  navigator.clipboard.writeText(data.json).catch(() => {
                    // If this also fails, show the JSON in a prompt
                    window.prompt('Copy this JSON:', data.json.substring(0, 1000) + '...');
                  });
                }}
              >
                Copy JSON
              </Button>
            </div>
          </Alert>
        )}

        <div className={styles.infoBox}>
          <span>
            <span className={styles.infoValue}>{data.filename}</span>
          </span>
          <span>·</span>
          <span>{data.formattedSize}</span>
        </div>

        <div className={styles.instructions}>
          <ol className={styles.instructionsList}>
            <li>
              Click <strong>Open GitHub</strong> below
            </li>
            <li>
              <strong>Paste</strong> the JSON content (Ctrl/Cmd + V)
            </li>
            <li>
              Scroll down and click <strong>Commit changes</strong>
            </li>
            <li>
              Select <strong>Create a new branch</strong> and name it
            </li>
            <li>
              Click <strong>Propose changes</strong> to create your PR
            </li>
            <li>
              Add the PR description below, then submit
            </li>
          </ol>
        </div>

        <div className={styles.prDescriptionSection}>
          <div className={styles.prDescriptionHeader}>
            <span className={styles.prDescriptionLabel}>PR description template</span>
            <Button
              size="sm"
              variant="secondary"
              icon="copy"
              onClick={() => {
                const template = getPRDescriptionTemplate(data.filename, guide.title);
                navigator.clipboard.writeText(template);
              }}
              tooltip="Copy PR description"
            >
              Copy
            </Button>
          </div>
          <pre className={styles.prDescriptionPreview}>{getPRDescriptionTemplate(data.filename, guide.title)}</pre>
        </div>
      </>
    );
  };

  return (
    <Modal title="Create GitHub PR" isOpen={isOpen} onDismiss={handleClose}>
      <div className={styles.container}>
        {renderContent()}

        <div className={styles.footer}>
          <Button variant="secondary" onClick={handleClose}>
            {state.status === 'ready' ? 'Close' : 'Cancel'}
          </Button>
          {state.status === 'ready' && (
            <Button variant="primary" icon="external-link-alt" onClick={handleOpenGitHub}>
              Open GitHub
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

