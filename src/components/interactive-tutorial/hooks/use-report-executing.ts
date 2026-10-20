import { useEffect } from 'react';

export function useReportExecuting(executing: boolean, onExecutingChange?: (executing: boolean) => void): void {
  useEffect(() => {
    if (!executing) {
      return;
    }
    onExecutingChange?.(true);
    return () => onExecutingChange?.(false);
  }, [executing, onExecutingChange]);
}
