/**
 * Asserts that every parameter an agent is told to send has somewhere to land. Ensures
 * no attributes given to the agent are silently dropped by the runner.
 *
 * *Reaching the runner* should be structural: a command's schema both publishes and parses
 * its parameters, and the runner takes the parsed result, so a published parameter no
 * runner receives is not expressible.
 *
 * *Reaching the artifact* still needs asserting only where a command's published field
 * names are hand-authored rather than spread from the schema they write — `create` seeds
 * two files from fields it declares itself, and `set-manifest` flattens nested manifest
 * paths into their own flag names. Checking `add-block`, `add-step`, `add-choice`, and
 * `edit-block` the same way would be tautological: those commands build their schema by
 * copying `.shape` straight off the block schema they write, so "does the published name
 * exist in the destination" can never fail — it's the same object compared to itself.
 * Their real risk (calling the runner with an unwired field, or invalid input not being
 * rejected) is covered by the runner tests and the CLI validators, not by a shape diff.
 */

import { ContentJsonSchema, ManifestJsonObjectSchema } from '../../types/package.schema';
import { FLATTENED_MANIFEST_PARAMS } from '../commands/set-manifest';
import { publishedNames, shapeKeys, specFields, type CommandSpec } from '../contracts';
import { agentView } from '../mcp/lib/command-interface';
import { COMMAND_SPECS } from '../commands/manifest';
import { buildServer } from '../mcp/server';

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

function spec(name: string): CommandSpec {
  const found = COMMAND_SPECS.get(name);
  if (!found) {
    throw new Error(`${name}: no spec registered`);
  }
  return found;
}

describe('published content parameters have a destination', () => {
  // `create` seeds both files a package is made of, so either is a destination:
  // `title` reaches content.json, `description` the manifest, and `id` and `type`
  // both. Its fields are hand-declared (see create.ts), so this is a real check —
  // renaming a field there without updating either artifact schema would surface here.
  it('create publishes nothing neither file would hold', () => {
    const destination = new Set([...shapeKeys(ContentJsonSchema), ...shapeKeys(ManifestJsonObjectSchema)]);
    const orphaned = publishedContentNames('create', spec('create')).filter((param) => !destination.has(param));
    expect(orphaned).toEqual([]);
  });

  // `set-manifest`'s manifest-shaped fields are derived (`ManifestJsonObjectSchema.omit(...)`),
  // so they can't drift. The flattened/nested params (`author-name`, `target-and`, ...) are
  // hand-declared against a separately hand-maintained name list (`FLATTENED_MANIFEST_PARAMS`)
  // though, so a rename on one side without the other is a real, catchable mistake.
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
  // all — otherwise a green suite is indistinguishable from a no-op suite.
  it('reports an orphan when the destination is missing a published field', () => {
    const published = publishedContentNames('create', spec('create'));
    expect(published.length).toBeGreaterThan(0);

    const incomplete = new Set(published.slice(1));
    expect(published.filter((param) => !incomplete.has(param))).toEqual([published[0]]);
  });
});
