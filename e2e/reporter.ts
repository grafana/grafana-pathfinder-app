/**
 * Reporter for generating test reports
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { TestReport, GuideMetadata, StepResult } from './types';

/**
 * Generate and save a JSON test report
 */
export async function generateReport(
  report: TestReport,
  outputDir: string
): Promise<string> {
  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Generate report filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `report-${report.guide.id}-${timestamp}.json`;
  const filepath = join(outputDir, filename);

  // Write report
  await writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8');

  return filepath;
}

/**
 * Create a test report from results
 */
export function createTestReport(
  guide: GuideMetadata,
  steps: StepResult[],
  grafanaUrl: string,
  startTime: number
): TestReport {
  const passed = steps.filter((s) => s.status === 'passed').length;
  const failed = steps.filter((s) => s.status === 'failed').length;
  const skipped = steps.filter((s) => s.status === 'skipped').length;

  return {
    guide,
    summary: {
      totalSteps: steps.length,
      passed,
      failed,
      skipped,
    },
    steps,
    timestamp: new Date().toISOString(),
    grafanaUrl,
    duration: Date.now() - startTime,
  };
}

/**
 * Print a summary of the test report to console
 */
export function printReportSummary(report: TestReport): void {
  console.log('\n=== Test Report Summary ===');
  console.log(`Guide: ${report.guide.title} (${report.guide.id})`);
  console.log(`URL: ${report.guide.url}`);
  console.log(`Total Steps: ${report.summary.totalSteps}`);
  console.log(`Passed: ${report.summary.passed}`);
  console.log(`Failed: ${report.summary.failed}`);
  console.log(`Skipped: ${report.summary.skipped}`);
  console.log(`Duration: ${(report.duration / 1000).toFixed(2)}s`);

  if (report.summary.failed > 0) {
    console.log('\n=== Failed Steps ===');
    report.steps
      .filter((s) => s.status === 'failed')
      .forEach((step) => {
        console.log(`\nStep ${step.index} (${step.type}):`);
        console.log(`  Selector: ${step.reftarget}`);
        if (step.error) {
          console.log(`  Error: ${step.error.type}`);
          console.log(`  Message: ${step.error.message}`);
          if (step.error.screenshot) {
            console.log(`  Screenshot: ${step.error.screenshot}`);
          }
        }
      });
  }
}

