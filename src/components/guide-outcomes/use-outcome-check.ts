import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuideOutcome, OutcomeEvidence, OutcomeScope } from '../../types/outcome.types';
import type { CheckResultError } from '../../types/requirements.types';
import type { OutcomeEvidenceStore } from '../../lib/outcomes/outcome-evidence';
import { listOutcomeResources, verifyGrafanaOutcome } from '../../requirements-manager';

export function useOutcomeCheck(scope: OutcomeScope, outcome: GuideOutcome, store: OutcomeEvidenceStore) {
  const [resource, setResource] = useState<{ value: string; label: string } | null>(null);
  const resourceUid = resource?.value ?? '';
  const [resourceRefresh, setResourceRefresh] = useState(0);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResultError | null>(null);
  const [history, setHistory] = useState<OutcomeEvidence[]>([]);
  const [storageError, setStorageError] = useState(false);
  const request = useRef<AbortController | null>(null);

  const resourceRequest = useRef<AbortController | null>(null);
  const loadOptions = useCallback(
    async (query: string) => {
      resourceRequest.current?.abort();
      const controller = new AbortController();
      resourceRequest.current = controller;
      const items = await listOutcomeResources(outcome, controller.signal, query);
      return items.map((item) => ({ label: item.label, value: item.uid }));
    },
    [outcome]
  );

  useEffect(() => {
    let cancelled = false;
    store
      .read(scope)
      .then((records) => {
        if (!cancelled) {
          setHistory((previous) => [
            ...records.filter(
              (record) =>
                !previous.some((item) => item.outcomeId === record.outcomeId && item.resourceUid === record.resourceUid)
            ),
            ...previous,
          ]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStorageError(true);
        }
      });
    return () => {
      cancelled = true;
      request.current?.abort();
      resourceRequest.current?.abort();
    };
  }, [scope, store]);

  const selectResource = useCallback((uid: string, label = uid) => {
    request.current?.abort();
    setResource({ value: uid, label });
    setResult(null);
    setChecking(false);
  }, []);

  const cancel = useCallback(() => {
    request.current?.abort();
    setChecking(false);
  }, []);

  const check = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setResult(null);
    try {
      const checked = await verifyGrafanaOutcome(outcome, resourceUid, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setResult(checked);
      if (checked.verdict === 'satisfied') {
        try {
          const saved = await store.record(scope, outcome.id, resourceUid, [checked]);
          if (saved && !controller.signal.aborted) {
            setHistory((previous) => [
              ...previous.filter((item) => !(item.outcomeId === outcome.id && item.resourceUid === resourceUid)),
              saved,
            ]);
            setStorageError(false);
          }
        } catch {
          if (!controller.signal.aborted) {
            setStorageError(true);
          }
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setChecking(false);
      }
    }
  }, [outcome, resourceUid, scope, store]);

  const reloadResources = useCallback(() => {
    resourceRequest.current?.abort();
    setResourceRefresh((value) => value + 1);
  }, []);
  const historical = history.find((item) => item.outcomeId === outcome.id && item.resourceUid === resourceUid);
  return {
    loadOptions,
    resourceRefresh,
    resourceUid,
    resource,
    selectResource,
    reloadResources,
    checking,
    result,
    historical,
    storageError,
    check,
    cancel,
  };
}
