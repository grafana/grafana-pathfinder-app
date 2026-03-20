/**
 * Hook that fetches, parses, and caches the remote dependency graph JSON.
 *
 * The URL is validated before fetch (must be https:// on the allowlisted host).
 * Fetched data is stored in component state; no global cache is used so that
 * multiple mounted instances (unlikely but possible) stay independent.
 */

import { useState, useEffect, useRef } from 'react';
import type { DependencyGraph } from '../../../types/package.types';
import type { FetchStatus } from '../types';

const ALLOWED_HOST = 'interactive-learning.grafana.net';

function isAllowedGraphUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && parsed.hostname === ALLOWED_HOST;
  } catch {
    return false;
  }
}

export interface UseGraphDataResult {
  graph: DependencyGraph | null;
  status: FetchStatus;
  error: string | null;
}

export function useGraphData(graphUrl: string): UseGraphDataResult {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    if (!isAllowedGraphUrl(graphUrl)) {
      const timer = setTimeout(() => {
        setStatus('error');
        setError(`Graph URL is not allowlisted: ${graphUrl}`);
      }, 0);
      return () => clearTimeout(timer);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setStatus('loading');
      setError(null);
    }, 0);

    const safeUrl = new URL(graphUrl);

    fetch(safeUrl.toString(), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} fetching graph`);
        }
        return res.json() as Promise<DependencyGraph>;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setGraph(data);
          setStatus('success');
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          const msg = err instanceof Error ? err.message : 'Unknown fetch error';
          setError(msg);
          setStatus('error');
        }
      });

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [graphUrl]);

  return { graph, status, error };
}
