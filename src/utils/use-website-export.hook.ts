/**
 * Hook for exporting steps to website shortcode format
 */

import { useCallback, useState } from 'react';
import { exportStepsForWebsite, exportSingleStepForWebsite, type WebsiteExportOptions } from './website-exporter';
import type { RecordedStep } from './devtools';

export interface UseWebsiteExportReturn {
  /** Export multiple steps to website shortcodes */
  exportSteps: (steps: RecordedStep[], options?: WebsiteExportOptions) => string;

  /** Export a single step to website shortcode */
  exportSingleStep: (action: string, selector: string, value?: string, description?: string) => string;

  /** Copy steps as website shortcodes to clipboard */
  copyForWebsite: (steps: RecordedStep[], options?: WebsiteExportOptions) => Promise<boolean>;

  /** Copy a single step as website shortcode to clipboard */
  copySingleForWebsite: (action: string, selector: string, value?: string, description?: string) => Promise<boolean>;

  /** Whether the last copy operation was successful */
  copied: boolean;
}

/**
 * Hook for exporting recorded steps to website shortcode format
 */
export function useWebsiteExport(): UseWebsiteExportReturn {
  const [copied, setCopied] = useState(false);

  const exportSteps = useCallback((steps: RecordedStep[], options?: WebsiteExportOptions): string => {
    return exportStepsForWebsite(steps, options);
  }, []);

  const exportSingleStep = useCallback(
    (action: string, selector: string, value?: string, description?: string): string => {
      return exportSingleStepForWebsite(action, selector, value, description);
    },
    []
  );

  const copyForWebsite = useCallback(
    async (steps: RecordedStep[], options?: WebsiteExportOptions): Promise<boolean> => {
      try {
        const output = exportStepsForWebsite(steps, options);
        await navigator.clipboard.writeText(output);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return true;
      } catch (error) {
        console.error('Failed to copy website shortcodes:', error);
        return false;
      }
    },
    []
  );

  const copySingleForWebsite = useCallback(
    async (action: string, selector: string, value?: string, description?: string): Promise<boolean> => {
      try {
        const output = exportSingleStepForWebsite(action, selector, value, description);
        await navigator.clipboard.writeText(output);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return true;
      } catch (error) {
        console.error('Failed to copy website shortcode:', error);
        return false;
      }
    },
    []
  );

  return {
    exportSteps,
    exportSingleStep,
    copyForWebsite,
    copySingleForWebsite,
    copied,
  };
}
