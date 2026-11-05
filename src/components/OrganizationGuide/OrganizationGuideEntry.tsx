import React, { useState, useEffect, useRef } from 'react';
import { Alert, Badge, Button, Stack, Text } from '@grafana/ui';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { OrganizationGuideEntry as Entry } from './useOrganizationGuide';
import { resolveOrganizationGuide } from '../../integrations/organization-guide/resolve';

export function OrganizationGuideEntry({
  entry,
  onOpen,
}: {
  entry: Entry;
  onOpen: (url: string, title: string, packageInfo?: PackageOpenInfo) => void | Promise<void>;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    setOpening(true);
    setFailed(false);
    try {
      const guide = await resolveOrganizationGuide(entry.guide.resourceName);
      if (!mounted.current) {
        return;
      }
      if (!guide) {
        setFailed(true);
        return;
      }
      await onOpen(guide.url, guide.title, {
        packageId: guide.guideId,
        repository: 'app-platform',
        packageManifest: guide.content.metadata.packageManifest,
        launchSource: 'organization_guide',
      });
    } catch {
      if (mounted.current) {
        setFailed(true);
      }
    } finally {
      if (mounted.current) {
        setOpening(false);
      }
    }
  };
  return (
    <section aria-label="Organization guide">
      <Stack direction="column" gap={1}>
        <Text element="h3" variant="h5">
          Organization guide
        </Text>
        <Text>{entry.guide.title}</Text>
        {entry.completed && <Badge text="Completed" color="green" />}
        <Button variant="secondary" disabled={opening} onClick={() => void open()}>
          {entry.completed ? 'Open guide' : entry.progress > 0 ? 'Resume' : 'Start'}
        </Button>
        {failed && <Alert severity="warning" title="This organization guide is currently unavailable" />}
      </Stack>
    </section>
  );
}
