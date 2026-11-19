import React, { useEffect, useState } from 'react';
import { Alert, Button, Combobox, RadioButtonGroup } from '@grafana/ui';
import { KioskOverlay } from '../kiosk/KioskOverlay';
import { preparePrKiosk } from './pr-kiosk-preview';
import type { PrJsonFile } from './github-api';
import type { PreparedKioskData } from '../kiosk/kiosk-rules';
import type { KioskMode } from '../../types/kiosk-page.schema';
import { parseSnapshotUrl, prPreviewContext } from '../../lib/pr-preview-core';

export function KioskPrPreview({ files, fetchId }: { files: PrJsonFile[]; fetchId: string }) {
  const [choice, setChoice] = useState<string>();
  const [mode, setMode] = useState<KioskMode>('instance');
  const [open, setOpen] = useState(false);
  const selected = files.find((file) => file.rawUrl === choice) ?? files[0];
  const rawUrl = selected?.rawUrl;
  const [result, setResult] = useState<{
    key: string;
    data?: PreparedKioskData;
    promise?: Promise<PreparedKioskData>;
    error?: string;
  }>();
  const key = `${rawUrl}-${fetchId}`;
  const current = result?.key === key ? result : undefined;
  useEffect(() => {
    if (!rawUrl) {
      return;
    }
    const controller = new AbortController();
    const promise = preparePrKiosk(rawUrl, fetchId, controller.signal);
    promise
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ key, data, promise });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ key, error: error instanceof Error ? error.message : 'Could not load this kiosk.' });
        }
      });
    return () => controller.abort();
  }, [rawUrl, fetchId, key]);
  if (!selected) {
    return <p>No kiosk catalogs found in this snapshot.</p>;
  }
  return (
    <div>
      <label htmlFor="pr-kiosk-catalog">Kiosk catalog</label>
      <Combobox
        id="pr-kiosk-catalog"
        options={files.map((file) => ({
          value: file.rawUrl,
          label: `${file.directoryName}/rules.json`,
          description: file.status,
        }))}
        value={rawUrl}
        onChange={(option) => {
          setChoice(option.value);
          setOpen(false);
        }}
      />
      <p>
        Commit: <code>{parseSnapshotUrl(selected.rawUrl)?.sha}</code>
      </p>
      <RadioButtonGroup
        value={mode}
        options={[
          { label: 'Current instance', value: 'instance' },
          { label: 'Presentation', value: 'presentation' },
        ]}
        onChange={(value) => setMode(value as KioskMode)}
      />
      <p>
        {mode === 'presentation'
          ? 'Configured stacks open in new tabs. Enable dev mode and install a compatible plugin on each target. Input forms require current-instance mode.'
          : 'Guides run against this Grafana instance. Preview actions can change real resources.'}
      </p>
      {current?.error && (
        <Alert title="Kiosk validation failed" severity="error">
          <pre style={{ whiteSpace: 'pre-wrap' }}>{current.error}</pre>
        </Alert>
      )}
      {!current && <p>Validating kiosk…</p>}
      {current?.data && (
        <>
          <p>Catalog is valid. Guide sources:</p>
          <ul>
            {current.data.data.rules
              .filter((rule) => rule.interactiveLearning !== false)
              .map((rule, index) => (
                <li key={index}>
                  {rule.title}: {prPreviewContext(rule.url) ? 'PR snapshot' : 'External content'}
                </li>
              ))}
          </ul>
        </>
      )}
      <Button disabled={!current?.data} onClick={() => setOpen(true)}>
        Preview kiosk
      </Button>
      {open && current?.promise && (
        <KioskOverlay
          preview
          catalog={current.promise}
          rulesUrl={selected.rawUrl}
          mode={mode}
          onClose={() => setOpen(false)}
          onLaunch={() => setOpen(false)}
        />
      )}
    </div>
  );
}
