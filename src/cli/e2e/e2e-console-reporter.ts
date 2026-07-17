/**
 * Human-readable console output for the e2e command.
 *
 * Owns every line the command prints to the terminal — the resolved run
 * configuration, pre-flight results, remote-resolution feedback, and the final
 * summary — plus the optional JSON report write. The command decides what to
 * run; this module decides how the results are shown. Mirrors e2e-reporter.ts,
 * which owns the JSON report structure. Pure presentation: it performs no input
 * resolution, planning, or execution.
 */

import { CLEAN_COMPOSE_PROJECT } from './clean-environment';
import { E2E_REPORT_SCHEMA_VERSION, type MultiGuideReport, type RunnerProvenance } from './schemas/e2e-report.schema';
import {
  generateReport,
  writeReport,
  generateMultiGuideReport,
  writeMultiGuideReport,
  formatMultiGuideSummary,
} from './e2e-reporter';
import {
  countGuideStatuses,
  guideResultReason,
  preRunSkipsFromResults,
  summarizeSteps,
  GUIDE_STATUS_ICONS,
  GUIDE_STATUS_LABELS,
  type GuideRunResult,
  type RunMode,
} from './e2e-results';
import type { RemoteResolution } from './e2e-package';
import type { LoadedGuide } from '../utils/file-loader';
import type { PreflightOutcome } from './manifest-preflight';
import type { SideEffectClassification } from './side-effects';

function skipOnlyReport(
  preRunSkipped: MultiGuideReport['preRunSkipped'],
  cleanupWarnings: string[] = []
): MultiGuideReport {
  const timestamp = new Date().toISOString();
  const runner: RunnerProvenance = {
    name: 'pathfinder-e2e-runner',
    version: process.env.PATHFINDER_E2E_RUNNER_VERSION ?? 'source',
    nodeVersion: process.version,
    playwrightVersion: process.env.PLAYWRIGHT_VERSION ?? 'unknown',
  };
  return {
    schemaVersion: E2E_REPORT_SCHEMA_VERSION,
    outcome: 'skipped',
    runner,
    startedAt: timestamp,
    endedAt: timestamp,
    type: 'multi-guide',
    config: { timestamp },
    summary: {
      totalGuides: 0,
      passedGuides: 0,
      failedGuides: 0,
      authExpiredGuides: 0,
      skippedGuides: 0,
      steps: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        notReached: 0,
        mandatoryFailed: 0,
        skippableFailed: 0,
      },
      totalDuration: 0,
    },
    guides: [],
    reports: [],
    preRunSkipped,
    cleanupWarnings: cleanupWarnings.length > 0 ? cleanupWarnings : undefined,
  };
}

function formatSideEffects(sideEffects: SideEffectClassification | undefined): string {
  if (!sideEffects) {
    return 'side effects unknown';
  }
  if (sideEffects.reasons.length === 0) {
    return sideEffects.level;
  }
  return `${sideEffects.level}: ${sideEffects.reasons.map((r) => `${r.path} ${r.message}`).join('; ')}`;
}

/** The resolved run settings rendered by printRunConfiguration. */
export interface RunConfigurationView {
  grafanaUrl: string;
  tier: string;
  artifacts: string;
  package?: string;
  output?: string;
  trace: boolean;
  headed: boolean;
  alwaysScreenshot: boolean;
  clean: boolean;
}

/**
 * Print the results of a manifest pre-flight check to the console.
 */
export function printPreflightOutcome(outcome: PreflightOutcome, verbose: boolean): void {
  for (const result of outcome.results) {
    if (result.status === 'pass') {
      if (verbose) {
        console.log(`   ✓ ${result.check}`);
      }
    } else if (result.status === 'skip') {
      if (verbose) {
        console.log(`   ⊘ ${result.check}: ${result.reason}`);
      }
    } else {
      console.error(`   ✗ ${result.check}: ${result.message}`);
    }
  }
}

/**
 * Print the validation-passed banner and the resolved run configuration.
 */
export function printRunConfiguration(valid: LoadedGuide[], config: RunConfigurationView, mode: RunMode): void {
  console.log(`\n✅ Guide validation passed for ${valid.length} guide(s).`);
  console.log('\n📋 E2E test configuration:');
  console.log(`   Grafana URL: ${config.grafanaUrl}`);
  console.log(`   Tier:        ${config.tier}`);
  console.log(`   Artifacts:   ${config.artifacts}`);
  if (mode === 'remote-package') {
    console.log(`   Package:     ${config.package} (remote)`);
  } else if (mode === 'remote-repository') {
    console.log(`   Source:      remote repository index`);
  } else if (config.package) {
    console.log(`   Package:     ${config.package}`);
  }
  if (config.output) {
    console.log(`   Output:      ${config.output}`);
  }
  if (config.trace) {
    console.log(`   Trace:       enabled`);
  }
  if (config.headed) {
    console.log(`   Headed:      enabled (browser visible)`);
  }
  if (config.alwaysScreenshot) {
    console.log(`   Screenshots: on success and failure`);
  }
  if (config.clean) {
    console.log(`   Clean:       enabled (project "${CLEAN_COMPOSE_PROJECT}", isolated from any dev stack)`);
  }
}

/**
 * Print the run summary: aggregate guide/step counts for multi-guide runs, or a
 * compact pass/fail breakdown for a single guide.
 */
export function printSummary(results: GuideRunResult[], cleanupWarnings: string[] = []): void {
  const resultsWithData = results.filter((r) => r.resultsData).map((r) => r.resultsData!);
  const isMultiGuide = results.length > 1;
  const counts = countGuideStatuses(results);

  console.log('\n' + '─'.repeat(68));
  console.log('📊 Summary');
  console.log('─'.repeat(68));

  if (isMultiGuide) {
    // Multi-guide summary: passed headline + one line per non-zero status.
    console.log(`\n   Guides: ${counts.passed}/${results.length} passed`);
    for (const [status, label] of GUIDE_STATUS_LABELS) {
      if (status !== 'passed' && counts[status] > 0) {
        console.log(`   ├─ ${label}: ${counts[status]}`);
      }
    }

    // Aggregate step statistics across all guides
    if (resultsWithData.length > 0) {
      const steps = summarizeSteps(resultsWithData);
      console.log(`\n   Steps: ${steps.total} total`);
      console.log(`   ├─ ✅ Passed: ${steps.passed}`);
      if (steps.failed > 0) {
        console.log(`   ├─ ❌ Failed: ${steps.failed}`);
      }
      if (steps.skipped > 0) {
        console.log(`   ├─ ⊘ Skipped: ${steps.skipped}`);
      }
      if (steps.notReached > 0) {
        console.log(`   └─ ○ Not reached: ${steps.notReached}`);
      }
    }

    // List individual guide results
    console.log(`\n   Guide results:`);
    for (const result of results) {
      const icon = GUIDE_STATUS_ICONS[result.status];
      const suffix = result.autoIncluded ? ' (auto-included)' : '';
      console.log(`   ${icon} ${result.id}${suffix}${guideResultReason(result)}`);
    }
  } else {
    // Single guide summary: one line per non-zero status.
    for (const [status, label] of GUIDE_STATUS_LABELS) {
      if (counts[status] > 0) {
        console.log(`   ${label}: ${counts[status]}`);
      }
    }
  }

  if (cleanupWarnings.length > 0) {
    console.log(`\n   Cleanup warnings: ${cleanupWarnings.length}`);
    for (const warning of cleanupWarnings) {
      console.log(`   ⚠ ${warning}`);
    }
  }
  console.log('\n' + '─'.repeat(68));
}

/**
 * Write the JSON report when an output path is set: an aggregated multi-guide
 * report or a single detailed report. A failure to write is a warning, not an
 * error.
 */
export function writeJsonReport(
  results: GuideRunResult[],
  outputPath: string | undefined,
  cleanupWarnings: string[] = []
): void {
  if (!outputPath) {
    return;
  }

  const resultsWithData = results.filter((r) => r.resultsData).map((r) => r.resultsData!);
  const isMultiGuide = results.length > 1;
  const preRunSkipped = preRunSkipsFromResults(results);

  if (resultsWithData.length === 0 && preRunSkipped.length > 0) {
    try {
      const report = skipOnlyReport(preRunSkipped, cleanupWarnings);
      writeMultiGuideReport(report, outputPath);
      console.log(`\n📄 Multi-guide JSON report written to: ${outputPath}`);
      console.log(`   ${formatMultiGuideSummary(report)}`);
    } catch (err) {
      console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } else if (resultsWithData.length === 0) {
    console.warn(`   ⚠ No test results available for JSON report`);
  } else if (isMultiGuide) {
    try {
      const report = generateMultiGuideReport(resultsWithData);
      if (preRunSkipped.length > 0) {
        report.preRunSkipped = preRunSkipped;
      }
      if (cleanupWarnings.length > 0) {
        report.cleanupWarnings = cleanupWarnings;
      }
      writeMultiGuideReport(report, outputPath);
      console.log(`\n📄 Multi-guide JSON report written to: ${outputPath}`);
      console.log(`   ${formatMultiGuideSummary(report)}`);
    } catch (err) {
      console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } else {
    try {
      const report = generateReport(resultsWithData[0]!);
      if (preRunSkipped.length > 0) {
        report.preRunSkipped = preRunSkipped;
      }
      if (cleanupWarnings.length > 0) {
        report.cleanupWarnings = cleanupWarnings;
      }
      writeReport(report, outputPath);
      console.log(`\n📄 JSON report written to: ${outputPath}`);
    } catch (err) {
      console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
}

/** Print a one-line (or verbose) summary of what remote resolution produced. */
export function printRemoteResolution(
  resolution: RemoteResolution,
  mode: RunMode,
  packageName: string | undefined,
  verbose: boolean
): void {
  const source = mode === 'remote-package' ? `package "${packageName}"` : 'repository index';
  console.log(`\n📦 Resolved ${source}: ${resolution.runnable.length} runnable, ${resolution.skipped.length} skipped`);
  if (verbose) {
    for (const g of resolution.runnable) {
      console.log(`   ✓ ${g.id} (${g.tier}, ${formatSideEffects(g.sideEffects)}) → ${g.sourceUrl}`);
    }
    for (const s of resolution.skipped) {
      const sideEffects = s.sideEffects ? ` (${formatSideEffects(s.sideEffects)})` : '';
      console.log(`   ⊘ ${s.id}: ${s.reason}${sideEffects} — ${s.message}`);
    }
  }
}
