import {
  PATHFINDER_DOMAINS,
  PATHFINDER_NOT_FOR,
  PATHFINDER_NOUNS,
  PATHFINDER_TRIGGER_PHRASES,
  PATHFINDER_USE_CASE_VERBS,
} from '../agent-routing';
import { SERVER_INSTRUCTIONS } from '../server-instructions';

// The integration test in `../../__tests__/server.test.ts` verifies the
// instructions reach a connected client through the MCP `initialize`
// handshake. These tests guard the constants themselves so a future edit
// can't silently drop a trigger phrase or one of the two load-bearing
// authoring rules (#3 selector discipline, #8 multistep / noop).

describe('agent-routing constants', () => {
  it('exports a non-empty trigger phrase list', () => {
    expect(PATHFINDER_TRIGGER_PHRASES.length).toBeGreaterThan(0);
    // The 2026-05-08 Grafana Assistant session (issue #7) used "create a
    // pathfinder" verbatim — this is the canonical starter phrase and must
    // stay in the list.
    expect(PATHFINDER_TRIGGER_PHRASES).toContain('create a pathfinder');
  });

  it('exports non-empty use-case verbs and nouns so server-instructions can compose', () => {
    expect(PATHFINDER_USE_CASE_VERBS.length).toBeGreaterThan(0);
    expect(PATHFINDER_NOUNS.length).toBeGreaterThan(0);
    // The first noun is the product name itself; downstream composition in
    // `server-instructions.ts` slices off index 0 to avoid awkward
    // "Grafana Pathfinder / Pathfinder" duplication.
    expect(PATHFINDER_NOUNS[0]).toBe('Pathfinder');
  });

  it('exports an anti-routing list that names at least one non-Pathfinder use case', () => {
    expect(PATHFINDER_NOT_FOR.length).toBeGreaterThan(0);
    expect(PATHFINDER_NOT_FOR.join(' ')).toMatch(/dashboard|documentation|general/i);
  });

  it('exports a non-empty domains list naming the Grafana product surface area', () => {
    // Slice 3 — added so the routing layer has explicit vocabulary linking
    // product mentions (e.g. "Prometheus") to Pathfinder. If telemetry shows
    // a product missing from the list (e.g., "Faro", "OnCall"), extend here
    // and the server-instructions text picks it up automatically.
    expect(PATHFINDER_DOMAINS.length).toBeGreaterThan(0);
    expect(PATHFINDER_DOMAINS).toContain('Prometheus');
    expect(PATHFINDER_DOMAINS).toContain('Loki');
  });
});

describe('SERVER_INSTRUCTIONS', () => {
  it('is non-empty and reasonably scoped (slice-3 ceiling: 40 lines)', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    const lineCount = SERVER_INSTRUCTIONS.split('\n').length;
    // Every connected client pays this length on every session. Slice 3
    // (2026-05-12) bumped the ceiling from 30 → 40 after production
    // telemetry showed the original opener wasn't assertive enough to
    // overcome the model's "just answer in prose" default. Past 40, the
    // signal is to move content to `pathfinder_authoring_start` (layer 2,
    // paid once per session) instead of growing layer 3.
    expect(lineCount).toBeLessThanOrEqual(40);
  });

  it('contains the routing vocabulary anchor (issue #7)', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/create a pathfinder/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/pathfinder_authoring_start/);
  });

  it('opens with an assertive default that overrides "just answer in prose" (slice-3 telemetry response)', () => {
    // First non-empty paragraph after the lead-in must say "default" or
    // similar, and must reference both the verb space AND the noun space —
    // this is what closes the slice-1 routing gap observed on 2026-05-12.
    expect(SERVER_INSTRUCTIONS).toMatch(/default to using this server/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/last resort/i);
    // The asset-noun vocabulary must include the looser nouns added in
    // slice 3 — `content`, `guide`, `tutorial`, `learning content` —
    // otherwise the verb+noun pattern matching has nothing to catch on.
    expect(SERVER_INSTRUCTIONS).toMatch(/tutorial/);
    expect(SERVER_INSTRUCTIONS).toMatch(/walkthrough/);
    expect(SERVER_INSTRUCTIONS).toMatch(/learning content|how-to|training material/);
  });

  it('names common Grafana product domains so product-area prompts route correctly', () => {
    // Slice 3 — without explicit product vocabulary, prompts like "create a
    // tutorial about Prometheus" missed the routing signal because no
    // trigger phrase linked "Prometheus" to Pathfinder.
    expect(SERVER_INSTRUCTIONS).toMatch(/Prometheus/);
    expect(SERVER_INSTRUCTIONS).toMatch(/Loki/);
  });

  it('contains the selector-discipline rule (issue #3)', () => {
    // Field name + "never invent" must both land — this is the only hint
    // surface that reaches the model before tool selection.
    expect(SERVER_INSTRUCTIONS).toMatch(/reftarget/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/never invent|do not invent|do not guess/i);
  });

  it('contains the composition-opinionation rule (issue #8)', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/multistep/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/sibling/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/noop/i);
  });

  it('declares when NOT to use the server so MCP-aware clients route elsewhere', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/when not to use|do not use|belongs elsewhere|not for/i);
  });
});
