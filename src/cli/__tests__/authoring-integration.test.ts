/**
 * Integration test: author a multi-block guide using only the operations the
 * agent context block in AGENT-AUTHORING.md promises. The test mirrors the
 * "Agent usage example" from the design doc (with the documented argument
 * reordering for add-block — see the per-phase plan's Deviations section).
 *
 * Exit criterion this satisfies:
 *   "An agent following only the ~20-line context block in
 *   `AGENT-AUTHORING.md` can author a multi-block guide that passes
 *   `validatePackage()`."
 *
 * If this test passes, the P1 surface is sufficient for end-to-end agent
 * authoring of a non-trivial guide. We round-trip through the standalone
 * `validatePackage(dir)` (the disk-aware validator used by the
 * pathfinder-cli validate command) at the end so we know a published guide
 * with these contents would pass the same checks.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runAddBlock } from '../commands/add-block';
import { runAddChoice } from '../commands/add-choice';
import { runAddStep } from '../commands/add-step';
import { runCreate } from '../commands/create';
import { runInspect } from '../commands/inspect';
import { runSetManifest } from '../commands/set-manifest';
import { readPackage } from '../utils/package-io';
import { validatePackage } from '../../validation/validate-package';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-integration-'));
}

describe('agent authoring round-trip (full multi-block guide)', () => {
  const root = tempDir();
  const dir = path.join(root, 'getting-started-with-loki');

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('builds a complete guide and the result passes validatePackage()', async () => {
    // create
    let r: Awaited<ReturnType<typeof runCreate>> = await runCreate({
      dir,
      id: 'getting-started-with-loki',
      title: 'Getting started with Loki',
      type: 'guide',
      description: 'Learn to send logs to Loki and query them in Grafana',
    });
    expect(r.status).toBe('ok');

    // intro section
    r = await runAddBlock({
      dir,
      type: 'section',
      explicitId: 'intro',
      flagValues: { title: 'Introduction' },
    });
    expect(r.status).toBe('ok');

    // markdown inside intro
    r = await runAddBlock({
      dir,
      type: 'markdown',
      parentId: 'intro',
      flagValues: {
        content: 'In this guide you will learn how to send logs to **Loki** and query them in Grafana.',
      },
    });
    expect(r.status).toBe('ok');

    // interactive nav inside intro
    r = await runAddBlock({
      dir,
      type: 'interactive',
      parentId: 'intro',
      flagValues: {
        action: 'navigate',
        reftarget: '[data-testid="nav-item-connections"]',
        content: 'Open the **Connections** page from the sidebar.',
        requirements: ['on-page:/'],
        showMe: true,
      },
    });
    expect(r.status).toBe('ok');

    // guided block with steps
    r = await runAddBlock({
      dir,
      type: 'guided',
      explicitId: 'add-loki',
      parentId: 'intro',
      flagValues: { content: 'Add Loki as a data source.' },
    });
    expect(r.status).toBe('ok');

    let s = await runAddStep({
      dir,
      parentId: 'add-loki',
      flagValues: {
        action: 'button',
        reftarget: '[data-testid="add-datasource-button"]',
        description: 'Click **Add data source**.',
      },
    });
    expect(s.status).toBe('ok');

    s = await runAddStep({
      dir,
      parentId: 'add-loki',
      flagValues: {
        action: 'formfill',
        reftarget: '[data-testid="datasource-search"]',
        targetvalue: 'Loki',
        description: 'Search for Loki.',
      },
    });
    expect(s.status).toBe('ok');

    // quiz with choices
    r = await runAddBlock({
      dir,
      type: 'quiz',
      explicitId: 'check-understanding',
      flagValues: {
        question: 'Which query language does Loki use?',
        requirements: ['section-completed:intro'],
      },
    });
    expect(r.status).toBe('ok');

    const choices = [
      { id: 'a', text: 'PromQL', hint: 'PromQL is used by Prometheus, not Loki.' },
      { id: 'b', text: 'LogQL', correct: true },
      { id: 'c', text: 'SQL', hint: 'Loki uses its own query language, not SQL.' },
    ];
    for (const c of choices) {
      const cr = await runAddChoice({ dir, parentId: 'check-understanding', flagValues: c });
      expect(cr.status).toBe('ok');
    }

    // manifest update
    const m = await runSetManifest({
      dir,
      flagValues: {
        description: 'Learn to send logs to Loki and query them in Grafana',
        provides: ['loki-basics'],
        recommends: ['first-dashboard'],
      },
    });
    expect(m.status).toBe('ok');

    // inspect
    const inspect = runInspect({ dir });
    expect(inspect.status).toBe('ok');
    if (inspect.status === 'ok') {
      expect(inspect.data?.valid).toBe(true);
      expect(inspect.data?.blockCount).toBeGreaterThan(0);
    }

    // The CLI validation passed at every mutation. Now run the standalone
    // disk-aware validator that would gate publishing — it must also pass.
    const finalValidation = validatePackage(dir);
    if (!finalValidation.isValid) {
      // Surface the issues for easier debugging when this test ever fails.
      throw new Error(
        `validatePackage() rejected the authored guide:\n${finalValidation.errors
          .map((e) => `  - ${e.message}`)
          .join('\n')}`
      );
    }
    expect(finalValidation.isValid).toBe(true);

    // The on-disk shape matches the in-memory state, with the canonical id.
    const state = readPackage(dir);
    expect(state.content.id).toBe('getting-started-with-loki');
    expect(state.manifest?.id).toBe('getting-started-with-loki');
    expect(state.manifest?.provides).toEqual(['loki-basics']);
  });
});
