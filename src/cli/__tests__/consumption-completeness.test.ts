/**
 * Asserts that every parameter an agent is told to send has somewhere to land. The
 * audit's worst failure rung was a published parameter accepted by the preflight,
 * forwarded to a runner, silently dropped on the way into the artifact, and reported
 * back as `status: "ok"` — a success receipt for a mutation that ignored it.
 *
 * *Reaching the runner* is structural now: a command's schema both publishes and parses
 * its parameters, and the runner takes the parsed result, so a published parameter no
 * runner receives is not expressible (§8).
 *
 * *Reaching the artifact* still needs asserting, for the three commands whose parameters
 * are not the fields of the thing they write — `add-block` and `edit-block` address a
 * block whose type is known only at runtime, `set-manifest` flattens nested locations.
 * Role is declared, so which parameters need a destination is derived, not listed.
 */

import { z } from 'zod';

import { JsonQuizChoiceSchema, JsonStepSchema } from '../../types/json-guide.schema';
import { ContentJsonSchema, ManifestJsonObjectSchema } from '../../types/package.schema';
import { addBlockGroup } from '../commands/add-block';
import { FLATTENED_MANIFEST_PARAMS } from '../commands/set-manifest';
import { publishedNames, shapeKeys, specFields, type CommandSpec } from '../contracts';
import { agentView } from '../mcp/lib/command-interface';
import { COMMAND_SPECS } from '../commands/manifest';
import { buildServer } from '../mcp/server';
import { BLOCK_SCHEMA_MAP } from '../utils/block-registry';

// What the agent surface publishes is decided by the MCP bindings, so the server is
// built to register them rather than the view being reconstructed from a list of names.
beforeAll(() => {
  buildServer({ name: 'consumption-completeness' });
});

/**
 * Published parameters that carry artifact content, as the agent surface offers
 * them. `command` is the bound command name, which for a group variant is the
 * group's — the binding withholds by root command.
 */
function publishedContentNames(command: string, spec: CommandSpec): string[] {
  const published = new Set(publishedNames(spec, agentView(command)));
  return specFields(spec)
    .filter((entry) => entry.policy.role === 'content' && published.has(entry.name))
    .map((entry) => entry.name);
}

/** Field names the artifact schema will accept. */
function destinationKeys(schema: unknown): Set<string> {
  return new Set(shapeKeys(schema as z.ZodObject));
}

function spec(name: string): CommandSpec {
  const found = COMMAND_SPECS.get(name);
  if (!found) {
    throw new Error(`${name}: no spec registered`);
  }
  return found;
}

describe('published content parameters have a destination', () => {
  it.each([
    ['add-step', JsonStepSchema],
    ['add-choice', JsonQuizChoiceSchema],
  ] as const)('%s publishes nothing the artifact schema would drop', (name, artifact) => {
    const destination = destinationKeys(artifact);
    const orphaned = publishedContentNames(name, spec(name)).filter((param) => !destination.has(param));
    expect(orphaned).toEqual([]);
  });

  // `create` seeds both files a package is made of, so either is a destination:
  // `title` reaches content.json, `description` the manifest, and `id` and `type`
  // both.
  it('create publishes nothing neither file would hold', () => {
    const destination = new Set([...shapeKeys(ContentJsonSchema), ...shapeKeys(ManifestJsonObjectSchema)]);
    const orphaned = publishedContentNames('create', spec('create')).filter((param) => !destination.has(param));
    expect(orphaned).toEqual([]);
  });

  // Each variant writes its own block type, so each is checked against that
  // type's schema rather than against the union.
  it.each(Object.keys(BLOCK_SCHEMA_MAP))('add-block %s publishes nothing the block schema would drop', (type) => {
    const destination = destinationKeys(BLOCK_SCHEMA_MAP[type as never]);
    const orphaned = publishedContentNames('add-block', addBlockGroup.variants.get(type)!).filter(
      (param) => !destination.has(param)
    );
    expect(orphaned).toEqual([]);
  });

  // `edit-block` publishes the union of every block type's fields, because the
  // addressed block reveals its type only when read from disk. The runner then
  // narrows to that one type — so the union is the destination here, and the
  // narrowing is covered by the runner's own tests.
  it('edit-block publishes nothing that belongs to no block type', () => {
    const destination = new Set(Object.values(BLOCK_SCHEMA_MAP).flatMap((schema) => shapeKeys(schema)));
    const published = publishedContentNames('edit-block', spec('edit-block'));
    expect(published.length).toBeGreaterThan(10);
    expect(published.filter((param) => !destination.has(param))).toEqual([]);
  });

  it('set-manifest publishes nothing outside the manifest, flattened paths included', () => {
    const destination = new Set([...shapeKeys(ManifestJsonObjectSchema), ...FLATTENED_MANIFEST_PARAMS]);
    const published = publishedContentNames('set-manifest', spec('set-manifest'));
    expect(published).toEqual(expect.arrayContaining(FLATTENED_MANIFEST_PARAMS));
    expect(published.filter((param) => !destination.has(param))).toEqual([]);
  });
});

describe('commands that write no content publish none', () => {
  // `inspect`, `remove-block`, and `schema` read, delete, and report. A content
  // parameter on any of them would mean a runner is writing something its
  // command does not admit to writing.
  it.each(['inspect', 'remove-block', 'schema'])('%s declares no content parameter', (name) => {
    expect(publishedContentNames(name, spec(name))).toEqual([]);
  });
});

describe('harness self-check', () => {
  // The assertions above pass, so it is worth proving the comparison can fail at
  // all — otherwise a green suite is indistinguishable from a no-op suite, the
  // exact property §4.5 faults the pre-existing tests for.
  it('reports an orphan when the destination is missing a published field', () => {
    const published = publishedContentNames('add-choice', spec('add-choice'));
    expect(published.length).toBeGreaterThan(0);

    const incomplete = new Set(published.slice(1));
    expect(published.filter((param) => !incomplete.has(param))).toEqual([published[0]]);
  });
});
