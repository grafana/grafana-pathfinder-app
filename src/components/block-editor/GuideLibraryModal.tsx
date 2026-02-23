/**
 * Guide Library Modal
 *
 * Displays a list of guides from the backend and allows loading them for editing
 */

import React, { useState } from 'react';
import { Modal, Button, Icon, useStyles2, Spinner, Alert } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { JsonGuide } from './types';
import { ConfirmModal, AlertModal } from './NotificationModals';

interface BackendGuide {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp?: string;
    uid?: string;
  };
  spec: {
    id: string;
    title: string;
    schemaVersion?: string;
    blocks: any[];
  };
}

export interface GuideLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  guides: BackendGuide[];
  isLoading: boolean;
  error: string | null;
  onLoadGuide: (guide: JsonGuide, resourceName: string, metadata: any) => void;
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
  onLoadGuide,
  onDeleteGuide,
  onRefresh,
}: GuideLibraryModalProps) {
  const styles = useStyles2(getStyles);
  const [deletingGuide, setDeletingGuide] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  const handleLoadGuide = (backendGuide: BackendGuide) => {
    const guide: JsonGuide = {
      id: backendGuide.spec.id,
      title: backendGuide.spec.title,
      schemaVersion: backendGuide.spec.schemaVersion || '1.0',
      blocks: backendGuide.spec.blocks,
    };
    onLoadGuide(guide, backendGuide.metadata.name, backendGuide.metadata);
    onClose();
  };

  const handleDeleteGuide = async (guide: BackendGuide) => {
    setDeleteConfirm({
      isOpen: true,
      guideName: guide.metadata.name,
      guideTitle: guide.spec.title,
      resourceName: guide.metadata.name,
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
    <Modal title="Guide library" isOpen={isOpen} onDismiss={onClose}>
      <div className={styles.content}>
        <div className={styles.header}>
          <span>Load a guide from the backend</span>
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
          ) : guides.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>📚</div>
              <p>No guides found in the backend.</p>
              <p>Create and publish a guide to see it here.</p>
            </div>
          ) : (
            guides.map((guide) => (
              <div key={guide.metadata.uid || guide.metadata.name} className={styles.guideItem}>
                <div className={styles.guideInfo}>
                  <div className={styles.guideTitle}>{guide.spec.title}</div>
                  <div className={styles.guideMeta}>
                    <span>
                      <Icon name="cube" /> {guide.metadata.name}
                    </span>
                    <span>
                      <Icon name="clock-nine" /> {formatDate(guide.metadata.creationTimestamp)}
                    </span>
                    <span>
                      <Icon name="apps" /> {guide.spec.blocks.length} blocks
                    </span>
                  </div>
                </div>
                <div className={styles.guideActions}>
                  <Button
                    variant="primary"
                    size="sm"
                    icon="pen"
                    onClick={() => handleLoadGuide(guide)}
                    tooltip="Load guide for editing"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    icon="trash-alt"
                    onClick={() => handleDeleteGuide(guide)}
                    disabled={deletingGuide === guide.metadata.name}
                    tooltip="Delete guide"
                  >
                    {deletingGuide === guide.metadata.name ? <Spinner size="sm" /> : null}
                  </Button>
                </div>
              </div>
            ))
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
    </Modal>
  );
}
