import { useContext, useEffect } from 'react';
import { ConditionalExecutionContext } from '../section-branch-context';

export function useReportExecuting(executing: boolean, onExecutingChange?: (executing: boolean) => void): void {
  const reportConditionalExecution = useContext(ConditionalExecutionContext);
  useEffect(() => {
    if (!executing || !reportConditionalExecution) {
      return;
    }
    const token = {};
    reportConditionalExecution(token, true);
    return () => reportConditionalExecution(token, false);
  }, [executing, reportConditionalExecution]);
  useEffect(() => {
    if (!executing) {
      return;
    }
    onExecutingChange?.(true);
    return () => onExecutingChange?.(false);
  }, [executing, onExecutingChange]);
}
