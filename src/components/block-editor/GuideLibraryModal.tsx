/**
 * Guide Library Modal
 *
 * Lists the private guides from the slim catalogue and reads the full guide only when loaded for editing
 */

import React, { useRef, useState } from 'react';
import { Modal, Button, Badge, Icon, Tooltip, useStyles2, Spinner, Alert } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { JsonGuide } from './types';
import { ConfirmModal, AlertModal } from './NotificationModals';
import { formatPath } from '../../validation/errors';
import { decodeAppPlatformGuideBlocks } from '../../types/app-platform-guide-compat';
import type { CustomGuideRepositoryEntry } from '../../lib/custom-guide-repository-client';

/** A stored guide as read for loading; `blocks` is unknown because a stored guide can be malformed. */
export interface StoredGuide {
  metadata: { name: string; [key: string]: unknown };
  spec: {
    id: string;
    title: string;
    schemaVersion?: string;
    blocks?: unknown;
    status?: 'draft' | 'published';
    manifest?: Record<string, unknown>;
  };
}

export interface GuideLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  guides: CustomGuideRepositoryEntry[];
  isLoading: boolean;
  error: string | null;
  /** Resolves undefined only when the guide no longer exists. */
  readGuide: (resourceName: string) => Promise<StoredGuide | undefined>;
  /** `stored` is the resource the guide was decoded from, so the save flow knows its status and version. */
  onLoadGuide: (guide: JsonGuide, resourceName: string, stored: StoredGuide) => void;
  onDeleteGuide: (resourceName: string) => Promise<void>;
  onRefresh: () => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  content: css({
    padding: 0,
  }),
  header: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  guideList: css({
    maxHeight: '500px',
    overflowY: 'auto',
    padding: theme.spacing(2),
  }),
  guideItem: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(2),
    marginBottom: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    transition: 'all 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.emphasize(theme.colors.background.secondary, 0.03),
      borderColor: theme.colors.border.medium,
    },
  }),
  guideInfo: css({
    flex: 1,
    minWidth: 0,
  }),
  guideTitle: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    marginBottom: theme.spacing(0.5),
    color: theme.colors.text.primary,
  }),
  guideMeta: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    display: 'flex',
    gap: theme.spacing(2),
  }),
  guideActions: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginLeft: theme.spacing(2),
  }),
  emptyState: css({
    textAlign: 'center',
    padding: theme.spacing(4),
    color: theme.colors.text.secondary,
  }),
  emptyStateIcon: css({
    fontSize: '48px',
    marginBottom: theme.spacing(2),
  }),
  loadingState: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
});

/**
 * Modal for browsing and loading guides from the backend
 */
export function GuideLibraryModal({
  isOpen,
  onClose,
  guides,
  isLoading,
  error,
  readGuide,
  onLoadGuide,
  onDeleteGuide,
  onRefresh,
}: GuideLibraryModalProps) {
  const styles = useStyles2(getStyles);
  const [deletingGuide, setDeletingGuide] = useState<string | null>(null);
  const [loadingGuide, setLoadingGuide] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    guideName: string;
    guideTitle: string;
    resourceName: string;
  }>({
    isOpen: false,
    guideName: '',
    guideTitle: '',
    resourceName: '',
  });

  // The modal stays mounted while closed, so dismissing it must cancel a read still in flight, synchronously:
  // landing later, that read would replace whatever the author has edited since.
  const loadToken = useRef(0);
  const handleClose = () => {
    loadToken.current++;
    setLoadingGuide(null);
    onClose();
  };

  const handleLoadGuide = async (entry: CustomGuideRepositoryEntry) => {
    const token = ++loadToken.current;
    setLoadingGuide(entry.name);
    try {
      const stored = await readGuide(entry.name);
      if (token !== loadToken.current) {
        return;
      }
      if (!stored) {
        setLoadError(`Cannot load guide: "${entry.name}" was not found on the server`);
        return;
      }
      loadStoredGuide(stored);
    } catch (error) {
      if (token === loadToken.current) {
        setLoadError(error instanceof Error ? error.message : 'Unknown error');
      }
    } finally {
      // A cancelled read must not clear the spinner of a load started after it.
      if (token === loadToken.current) {
        setLoadingGuide(null);
      }
    }
  };

  const loadStoredGuide = (backendGuide: StoredGuide) => {
    if (!backendGuide.spec.blocks || !Array.isArray(backendGuide.spec.blocks)) {
      setLoadError('Cannot load guide: missing or invalid blocks array');
      return;
    }
    if (!backendGuide.spec.title) {
      setLoadError('Cannot load guide: missing title');
      return;
    }

    const decoded = decodeAppPlatformGuideBlocks(backendGuide.spec.blocks, 'editor');
    if (!decoded.ok) {
      const issue = decoded.issues[0];
      const path = formatPath([
        'blocks',
        ...(issue?.path ?? []).map((key) => (typeof key === 'number' ? key : String(key))),
      ]);
      setLoadError(`Cannot load guide: ${path}: ${issue?.message ?? 'invalid blocks'}`);
      return;
    }

    const guide: JsonGuide = {
      id: backendGuide.spec.id,
      title: backendGuide.spec.title,
      schemaVersion: backendGuide.spec.schemaVersion || '1.0',
      blocks: decoded.blocks,
    };
    onLoadGuide(guide, backendGuide.metadata.name, backendGuide);
    onClose();
  };

  const handleDeleteGuide = async (guide: CustomGuideRepositoryEntry) => {
    setDeleteConfirm({
      isOpen: true,
      guideName: guide.name,
      guideTitle: guide.title || guide.name,
      resourceName: guide.name,
    });
  };

  const confirmDelete = async () => {
    const resourceName = deleteConfirm.resourceName;
    setDeleteConfirm({ isOpen: false, guideName: '', guideTitle: '', resourceName: '' });
    setDeletingGuide(resourceName);
    try {
      await onDeleteGuide(resourceName);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setDeletingGuide(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm({ isOpen: false, guideName: '', guideTitle: '', resourceName: '' });
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) {
      return 'Unknown';
    }
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  return (
    <Modal title="Guide library" isOpen={isOpen} onDismiss={handleClose}>
      <div className={styles.content}>
        <div className={styles.header}>
          <span>
            These guides are stored privately in your Grafana instance. Published guides are visible to users in the
            interactive learning side panel.
          </span>
          <Button variant="secondary" size="sm" icon="sync" onClick={onRefresh}>
            Refresh
          </Button>
        </div>

        {error && (
          <div style={{ padding: '16px' }}>
            <Alert severity="error" title="Error loading guides">
              {error}
            </Alert>
          </div>
        )}

        <div className={styles.guideList}>
          {isLoading ? (
            <div className={styles.loadingState}>
              <Spinner size="lg" />
            </div>
          ) : guides.length === 0 && !error ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>📚</div>
              <p>No guides in library.</p>
              <p>Use &ldquo;Save&rdquo; in the editor to save your first guide.</p>
            </div>
          ) : (
            guides.map((guide) => {
              const guideStatus: 'draft' | 'published' = guide.status === 'published' ? 'published' : 'draft';
              const isActioning = deletingGuide === guide.name;
              return (
                <div key={guide.name} className={styles.guideItem}>
                  <div className={styles.guideInfo}>
                    <div className={styles.guideTitle}>
                      {guide.title || guide.name}{' '}
                      {guideStatus === 'published' ? (
                        <Tooltip content="Published and visible to users">
                          <Badge text="Published" color="green" icon="cloud-upload" />
                        </Tooltip>
                      ) : (
                        <Tooltip content="Saved to library but not published to users">
                          <Badge text="Draft" color="blue" icon="circle" />
                        </Tooltip>
                      )}
                    </div>
                    <div className={styles.guideMeta}>
                      <span>
                        <Icon name="cube" /> {guide.name}
                      </span>
                      <span>
                        <Icon name="clock-nine" /> {formatDate(guide.creationTimestamp)}
                      </span>
                    </div>
                  </div>
                  <div className={styles.guideActions}>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={loadingGuide === guide.name ? undefined : 'pen'}
                      onClick={() => handleLoadGuide(guide)}
                      disabled={loadingGuide !== null}
                      tooltip="Load guide for editing"
                    >
                      {loadingGuide === guide.name ? <Spinner inline size="sm" /> : null}
                      Load
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      icon="trash-alt"
                      onClick={() => handleDeleteGuide(guide)}
                      disabled={isActioning}
                      tooltip="Delete guide"
                    >
                      {deletingGuide === guide.name ? <Spinner size="sm" /> : null}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        title="Delete guide?"
        message={
          <>
            <p>
              Are you sure you want to delete <strong>&quot;{deleteConfirm.guideTitle}&quot;</strong>?
            </p>
            <p style={{ marginTop: '8px', fontSize: '0.9em', color: '#888' }}>This action cannot be undone.</p>
          </>
        }
        variant="destructive"
        confirmText="Delete"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

      {/* Delete Error Modal */}
      <AlertModal
        isOpen={deleteError !== null}
        title="Failed to delete guide"
        message={deleteError ?? ''}
        severity="error"
        onClose={() => setDeleteError(null)}
      />

      {/* Load Error Modal */}
      <AlertModal
        isOpen={loadError !== null}
        title="Failed to load guide"
        message={loadError ?? ''}
        severity="error"
        onClose={() => setLoadError(null)}
      />
    </Modal>
  );
}
