/**
 * Parser for extracting interactive steps from HTML guide content
 * Parses HTML in browser context using Playwright's evaluate function
 */

import { Page } from '@playwright/test';
import { StepInfo, InteractiveActionType } from './types';
import { logInfo, logDebug, logWarn, logError } from './logger';

/**
 * Parse HTML content to extract interactive steps (runs in browser context)
 */
export async function parseGuideSteps(page: Page): Promise<StepInfo[]> {
  logInfo('Starting guide steps parsing...', { context: 'parser' });
  
  return await page.evaluate(() => {
    const steps: StepInfo[] = [];
    const parser = new DOMParser();

    // Get the guide content from the Pathfinder panel
    const contentContainer = document.querySelector('[data-pathfinder-content="true"]');
    if (!contentContainer) {
      console.warn('[PARSER] Content container not found');
      return steps;
    }

    const html = contentContainer.innerHTML;
    console.log(`[PARSER] Content container HTML length: ${html.length}`);
    const doc = parser.parseFromString(html, 'text/html');

    // Find all interactive elements
    // Try .interactive-step first (matches what's actually rendered), then fallback to .interactive
    let interactiveElements = doc.querySelectorAll('.interactive-step[data-targetaction]');
    console.log(`[PARSER] Found ${interactiveElements.length} interactive elements with .interactive-step class`);
    
    // Fallback to .interactive if .interactive-step finds nothing
    if (interactiveElements.length === 0) {
      interactiveElements = doc.querySelectorAll('.interactive[data-targetaction]');
      console.log(`[PARSER] Fallback: Found ${interactiveElements.length} interactive elements with .interactive class`);
    }

    let stepIndex = 0;

    interactiveElements.forEach((element) => {
      const targetAction = element.getAttribute('data-targetaction');

      // Skip sequence containers themselves - we want the steps within them
      if (targetAction === 'sequence') {
        // Find all interactive steps within this sequence
        // Try .interactive-step first, then fallback to .interactive
        let sequenceSteps = element.querySelectorAll('li.interactive-step[data-targetaction]');
        if (sequenceSteps.length === 0) {
          sequenceSteps = element.querySelectorAll('li.interactive[data-targetaction]');
        }
        console.log(`[PARSER] Found ${sequenceSteps.length} steps within sequence container`);
        sequenceSteps.forEach((stepEl) => {
          const stepInfo = extractStepInfo(stepEl as HTMLElement, stepIndex++);
          if (stepInfo) {
            steps.push(stepInfo);
            console.log(`[PARSER] Extracted step ${stepInfo.index}: ${stepInfo.type} - ${stepInfo.reftarget.substring(0, 50)}`);
          } else {
            console.warn(`[PARSER] Failed to extract step info from sequence step ${stepIndex}`);
          }
        });
      } else {
        // Regular interactive step
        const stepInfo = extractStepInfo(element as HTMLElement, stepIndex++);
        if (stepInfo) {
          steps.push(stepInfo);
          console.log(`[PARSER] Extracted step ${stepInfo.index}: ${stepInfo.type} - ${stepInfo.reftarget.substring(0, 50)}`);
        } else {
          console.warn(`[PARSER] Failed to extract step info from element ${stepIndex}`);
        }
      }
    });

    console.log(`[PARSER] Total steps extracted: ${steps.length}`);
    return steps;

    function extractStepInfo(element: HTMLElement, index: number): StepInfo | null {
      const targetAction = element.getAttribute('data-targetaction');
      const reftarget = element.getAttribute('data-reftarget');
      const targetvalue = element.getAttribute('data-targetvalue');
      const requirements = element.getAttribute('data-requirements');
      const objectives = element.getAttribute('data-objectives');
      const skippable = element.getAttribute('data-skippable') === 'true';
      const textContent = element.textContent?.trim() || undefined;

      if (!targetAction || !reftarget) {
        console.warn(`[PARSER] Step ${index} missing required attributes: targetAction=${targetAction}, reftarget=${reftarget}`);
        return null;
      }

      // Validate action type
      const validActions: InteractiveActionType[] = [
        'highlight',
        'button',
        'formfill',
        'navigate',
        'hover',
        'sequence',
        'multistep',
        'guided',
      ];

      if (!validActions.includes(targetAction as InteractiveActionType)) {
        console.warn(`[PARSER] Step ${index} has invalid action type: ${targetAction}`);
        return null;
      }

      return {
        index,
        type: targetAction as InteractiveActionType,
        reftarget,
        targetvalue: targetvalue || undefined,
        requirements: requirements || undefined,
        objectives: objectives || undefined,
        skippable,
        stepHtml: element.outerHTML,
        textContent,
      };
    }
  });
}

/**
 * Extract guide metadata from HTML (runs in browser context)
 */
export async function parseGuideMetadata(page: Page, url: string): Promise<{ title: string; id: string }> {
  logInfo('Parsing guide metadata...', { context: 'parser' });
  
  const result = await page.evaluate(() => {
    const contentContainer = document.querySelector('[data-pathfinder-content="true"]');
    if (!contentContainer) {
      console.warn('[PARSER] Content container not found for metadata extraction');
      return { title: 'Untitled Guide' };
    }

    // Try to find title in the rendered content
    const h1Tag = contentContainer.querySelector('h1');
    const title = h1Tag?.textContent?.trim() || 'Untitled Guide';
    console.log(`[PARSER] Extracted title: ${title}`);

    return { title };
  });

  // Extract ID from URL (e.g., "bundled:welcome-to-grafana" -> "welcome-to-grafana")
  const id = url.replace('bundled:', '').replace(/\.html$/, '');
  logInfo(`Guide metadata parsed: title="${result.title}", id="${id}"`, { context: 'parser' });

  return { title: result.title, id };
}

