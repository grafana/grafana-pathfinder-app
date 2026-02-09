/**
 * Guide Test Runner Artifact Collection
 *
 * Functions for capturing screenshots, DOM snapshots, and console errors
 * when steps fail. Provides debugging context for CI environments.
 *
 * @see docs/design/e2e-test-runner-design.md#artifact-collection-on-failure
 */

import { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { ArtifactPaths } from './types';

// ============================================
// Artifact Collection Functions (L3-5D)
// ============================================

/**
 * Capture failure artifacts (screenshot, DOM snapshot, console errors) (L3-5D).
 *
 * This function captures diagnostic artifacts when a step fails to provide
 * debugging context in CI environments where you can't watch the browser.
 *
 * Per design doc:
 * - Screenshot: PNG image of visual state at failure
 * - DOM snapshot: HTML element structure for selector debugging
 * - Console errors: JSON file with console.error() calls during step
 *
 * Artifacts are only captured for failed steps to save space.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier (used in filenames)
 * @param consoleErrors - Console errors captured during step execution
 * @param artifactsDir - Directory to write artifacts to
 * @returns ArtifactPaths with paths to captured files, undefined if capture fails
 *
 * @example
 * ```typescript
 * const artifacts = await captureFailureArtifacts(page, 'step-1', errors, './artifacts');
 * // artifacts.screenshot = './artifacts/step-1-failure.png'
 * // artifacts.dom = './artifacts/step-1-dom.html'
 * // artifacts.console = './artifacts/step-1-console.json'
 * ```
 */
export async function captureFailureArtifacts(
  page: Page,
  stepId: string,
  consoleErrors: string[],
  artifactsDir: string
): Promise<ArtifactPaths | undefined> {
  try {
    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true });

    const artifacts: ArtifactPaths = {};

    // Capture screenshot
    const screenshotPath = join(artifactsDir, `${stepId}-failure.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
      artifacts.screenshot = screenshotPath;
    } catch (screenshotError) {
      console.warn(
        `   ⚠ Failed to capture screenshot: ${screenshotError instanceof Error ? screenshotError.message : 'Unknown error'}`
      );
    }

    // Capture DOM snapshot
    const domPath = join(artifactsDir, `${stepId}-dom.html`);
    try {
      const html = await page.content();
      writeFileSync(domPath, html, 'utf-8');
      artifacts.dom = domPath;
    } catch (domError) {
      console.warn(
        `   ⚠ Failed to capture DOM snapshot: ${domError instanceof Error ? domError.message : 'Unknown error'}`
      );
    }

    // Capture console errors if any were collected
    if (consoleErrors.length > 0) {
      const consolePath = join(artifactsDir, `${stepId}-console.json`);
      try {
        writeFileSync(consolePath, JSON.stringify(consoleErrors, null, 2), 'utf-8');
        artifacts.console = consolePath;
      } catch (consoleError) {
        console.warn(
          `   ⚠ Failed to write console errors: ${consoleError instanceof Error ? consoleError.message : 'Unknown error'}`
        );
      }
    }

    // Return artifacts only if we captured at least one
    if (artifacts.screenshot || artifacts.dom || artifacts.console) {
      return artifacts;
    }

    return undefined;
  } catch (error) {
    console.warn(
      `   ⚠ Failed to capture failure artifacts: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return undefined;
  }
}

/**
 * Capture success artifacts (screenshot only).
 *
 * This is a lighter-weight version of captureFailureArtifacts that only
 * captures a screenshot on success. DOM and console logs are not captured
 * on success to save space.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier (used in filenames)
 * @param artifactsDir - Directory to write artifacts to
 * @returns ArtifactPaths with screenshot path, undefined if capture fails
 *
 * @example
 * ```typescript
 * const artifacts = await captureSuccessArtifacts(page, 'step-1', './artifacts');
 * // artifacts.screenshot = './artifacts/step-1-success.png'
 * ```
 */
export async function captureSuccessArtifacts(
  page: Page,
  stepId: string,
  artifactsDir: string
): Promise<ArtifactPaths | undefined> {
  try {
    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true });

    const screenshotPath = join(artifactsDir, `${stepId}-success.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return { screenshot: screenshotPath };
  } catch (error) {
    console.warn(
      `   ⚠ Failed to capture success screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return undefined;
  }
}

/**
 * Capture PRE step artifacts (screenshot before step execution).
 *
 * This function captures a screenshot of the page state before a step
 * is executed. Only captured when alwaysScreenshot is enabled.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier (used in filenames)
 * @param artifactsDir - Directory to write artifacts to
 * @returns Path to screenshot file, undefined if capture fails
 *
 * @example
 * ```typescript
 * const prePath = await capturePreStepArtifacts(page, 'step-1', './artifacts');
 * // prePath = './artifacts/step-1-pre.png'
 * ```
 */
export async function capturePreStepArtifacts(
  page: Page,
  stepId: string,
  artifactsDir: string
): Promise<string | undefined> {
  try {
    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true });

    const screenshotPath = join(artifactsDir, `${stepId}-pre.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return screenshotPath;
  } catch (error) {
    console.warn(`   ⚠ Failed to capture PRE screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return undefined;
  }
}

/**
 * Capture final screenshot at the end of test execution.
 *
 * This function captures a screenshot of the final page state after
 * all steps have been executed. Only captured when alwaysScreenshot is enabled.
 *
 * @param page - Playwright Page object
 * @param artifactsDir - Directory to write artifacts to
 * @returns Path to screenshot file, undefined if capture fails
 *
 * @example
 * ```typescript
 * const finalPath = await captureFinalScreenshot(page, './artifacts');
 * // finalPath = './artifacts/execution-final.png'
 * ```
 */
export async function captureFinalScreenshot(page: Page, artifactsDir: string): Promise<string | undefined> {
  try {
    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true });

    const screenshotPath = join(artifactsDir, 'execution-final.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return screenshotPath;
  } catch (error) {
    console.warn(
      `   ⚠ Failed to capture final screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return undefined;
  }
}
