# CLI extensions

> Part of the [Pathfinder package design](../PATHFINDER-PACKAGE-DESIGN.md).
> See also: [Identity and resolution](./identity-and-resolution.md) · [Dependencies](./dependencies.md)

---

## Schema validation of new fields

The CLI validates `content.json` and `manifest.json` with separate schemas, then performs cross-file consistency checks when both are present.

### Shared sub-schemas

```typescript
/** A single reference or OR-group of alternatives */
const DependencyClauseSchema = z.union([z.string(), z.array(z.string()).min(1)]);

/** AND-list of dependency clauses (CNF: outer = AND, inner array = OR) */
const DependencyListSchema = z.array(DependencyClauseSchema);

const AuthorSchema = z
  .object({
    name: z.string().optional(),
    team: z.string().optional(),
  })
  .strict();

const GuideTargetingSchema = z
  .object({
    match: z.record(z.unknown()).optional(),
  })
  .passthrough();
```

### Content schema (`content.json`)

```typescript
export const ContentJsonSchema = z.object({
  schemaVersion: z.string().optional(),
  id: z.string().min(1, 'Guide id is required'),
  title: z.string().min(1, 'Guide title is required'),
  blocks: z.array(JsonBlockSchema),
});
```

### Manifest schema (`manifest.json`)

```typescript
export const ManifestJsonSchema = z.object({
  schemaVersion: z.string().optional(),
  id: z.string().min(1, 'Manifest id is required'),
  repository: z.string().optional(),
  // Metadata (flat)
  description: z.string().optional(),
  language: z.string().optional(),
  category: z.string().optional(),
  author: AuthorSchema.optional(),
  // Dependencies (flat, with CNF OR support)
  depends: DependencyListSchema.optional(),
  recommends: DependencyListSchema.optional(),
  suggests: DependencyListSchema.optional(),
  provides: z.array(z.string()).optional(),
  conflicts: z.array(z.string()).optional(),
  replaces: z.array(z.string()).optional(),
  // Targeting
  targeting: GuideTargetingSchema.optional(),
});
```

### Merged logical schema (for legacy single-file guides)

For backwards compatibility with single-file guides that carry all fields:

```typescript
export const JsonGuideSchemaStrict = z.object({
  schemaVersion: z.string().optional(),
  repository: z.string().optional(),
  id: z.string().min(1, 'Guide id is required'),
  title: z.string().min(1, 'Guide title is required'),
  blocks: z.array(JsonBlockSchema),
  // Metadata (flat)
  description: z.string().optional(),
  language: z.string().optional(),
  category: z.string().optional(),
  author: AuthorSchema.optional(),
  // Dependencies (flat, with CNF OR support)
  depends: DependencyListSchema.optional(),
  recommends: DependencyListSchema.optional(),
  suggests: DependencyListSchema.optional(),
  provides: z.array(z.string()).optional(),
  conflicts: z.array(z.string()).optional(),
  replaces: z.array(z.string()).optional(),
  // Targeting
  targeting: GuideTargetingSchema.optional(),
});
```

## Package-level validation (new capability)

```bash
# Validate a single guide file (existing behavior)
npx pathfinder-cli validate ./guides/welcome-to-grafana/content.json

# Validate a package directory (new)
npx pathfinder-cli validate --package ./guides/welcome-to-grafana/

# Validate all packages in a directory tree (new)
npx pathfinder-cli validate --packages ./guides/
```

Package-level validation adds checks that single-file validation cannot perform:

| Check                         | What it validates                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Directory structure           | Package directory contains `content.json`                                               |
| ID consistency (directory)    | `content.json` `id` matches directory name                                              |
| ID consistency (cross-file)   | `manifest.json` `id` matches `content.json` `id` (when both present)                    |
| Manifest.json structure       | `manifest.json` passes `ManifestJsonSchema` validation (when present)                   |
| Dependency resolution (local) | All same-repo `depends`/`recommends` reference guide IDs that exist in the tree         |
| Circular dependency detection | No cycles in the dependency graph                                                       |
| Capability coverage           | Every `depends` target either exists as a guide ID or is `provides`-d by some guide     |
| Cross-repo references         | Warns on unresolvable cross-repo references (cannot validate without external metadata) |
| Conflict consistency          | `conflicts` pairs that are not symmetric generate a warning                             |
| Assets directory              | Warns if `content.json` references assets that don't exist in `assets/`                 |

## Dependency graph command (new)

```bash
# Output dependency graph as text
npx pathfinder-cli graph ./guides/

# Output as DOT format for visualization
npx pathfinder-cli graph --format dot ./guides/ | dot -Tsvg > graph.svg
```

Displays the dependency DAG across all packages in a directory tree. Useful for debugging, documentation, and verifying learning path structures.

## Future: build-index command

```bash
# Scan packages and produce index.json for the recommender
npx pathfinder-cli build-index ./guides/ --output index.json
```

This is noted as a future command and is **out of scope** for this design. See [deferred concerns](../PATHFINDER-PACKAGE-DESIGN.md#deferred-concerns).
