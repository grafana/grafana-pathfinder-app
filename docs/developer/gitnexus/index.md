# GitNexus knowledge graph for Pathfinder

[GitNexus](https://github.com/abhigyanpatwari/GitNexus) is a codebase intelligence tool that builds a knowledge graph of the repository — every symbol, dependency, call chain, and execution flow — and exposes it to AI agents via MCP. This gives Cursor and other AI agents deep architectural awareness, enabling them to accurately trace impacts, understand execution flows, and make safer edits.

## What was set up

The following was done on the `gitnexus` branch to integrate GitNexus with this repository.

### 1. Repository indexed

Running `gitnexus analyze` from the repo root indexed the codebase and stored the graph in `.gitnexus/` (gitignored):

```
3,555 nodes | 9,314 edges | 305 clusters | 266 flows
```

The index captures:

- All TypeScript/Go symbols (functions, classes, interfaces, methods)
- Import/call relationships across files
- Functional clusters (community detection)
- Execution flows traced from entry points

The index file at `.gitnexus/meta.json` records the commit hash it was built from, so agents can detect when the index is stale.

### 2. Cursor MCP configured

Running `gitnexus setup` added the gitnexus MCP server to `~/.cursor/mcp.json`:

```json
"gitnexus": {
  "command": "npx",
  "args": ["-y", "gitnexus@latest", "mcp"]
}
```

This is a **global** config — it applies to all Cursor workspaces. Once configured, no per-project setup is needed.

### 3. Agent skills installed

Six agent skills were installed to `~/.cursor/skills/`:

| Skill                      | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `gitnexus-exploring`       | Understand architecture, trace execution flows |
| `gitnexus-impact-analysis` | Blast radius analysis before making changes    |
| `gitnexus-debugging`       | Trace bugs through call chains                 |
| `gitnexus-refactoring`     | Plan safe renames, extractions, splits         |
| `gitnexus-guide`           | Reference for all MCP tools and resources      |
| `gitnexus-cli`             | Index, status, clean, wiki CLI commands        |

The same skills were also installed to `~/.claude/skills/gitnexus/` for Claude Code.

### 4. Context files updated

- **`CLAUDE.md`** — created with a skills dispatch table for Claude Code agents
- **`AGENTS.md`** — a GitNexus section was appended with the same skills dispatch table (between `<!-- gitnexus:start -->` and `<!-- gitnexus:end -->` markers so it can be updated by re-running `gitnexus analyze`)

### 5. `.gitignore` updated

`.gitnexus` was added to `.gitignore`. The KuzuDB graph database stored there is large (~87MB) and regenerated locally — it should not be committed.

## Keeping the index fresh

The index is tied to a specific commit. After merging significant changes, re-run:

```bash
gitnexus analyze
```

Run this from the repo root. It takes ~60 seconds. Agents will warn you if the index is stale (it compares the stored commit hash against `HEAD`).

To force a full re-index:

```bash
gitnexus analyze --force
```

## Using GitNexus in Cursor

The MCP server starts automatically when Cursor launches (it uses `npx -y gitnexus@latest mcp` which serves all indexed repos from the global registry). No additional action is needed.

### MCP tools available

| Tool                      | What it does                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `gitnexus_query`          | Hybrid search (BM25 + semantic) returning results grouped by execution flow            |
| `gitnexus_context`        | 360-degree view of a symbol — callers, callees, clusters, processes it participates in |
| `gitnexus_impact`         | Blast radius analysis — what breaks if you change symbol X                             |
| `gitnexus_detect_changes` | Pre-commit impact analysis from git diff                                               |
| `gitnexus_rename`         | Multi-file coordinated rename with dry-run support                                     |
| `gitnexus_cypher`         | Raw Cypher queries against the knowledge graph                                         |
| `gitnexus_list_repos`     | List all indexed repositories                                                          |

### MCP resources available

Resources are read with the `gitnexus://` URI scheme:

| Resource                                                | Purpose                                          |
| ------------------------------------------------------- | ------------------------------------------------ |
| `gitnexus://repos`                                      | All indexed repositories                         |
| `gitnexus://repo/grafana-pathfinder-app/context`        | Codebase stats and index freshness check         |
| `gitnexus://repo/grafana-pathfinder-app/clusters`       | All 305 functional clusters with cohesion scores |
| `gitnexus://repo/grafana-pathfinder-app/processes`      | All 266 execution flows                          |
| `gitnexus://repo/grafana-pathfinder-app/process/{name}` | Full execution trace for a specific flow         |
| `gitnexus://repo/grafana-pathfinder-app/schema`         | Graph schema for writing Cypher queries          |

### Example workflows

**"What calls `useInteractiveEngine`?"**

```
gitnexus_context({ name: "useInteractiveEngine" })
```

Returns all callers, the clusters it belongs to, and the execution flows it participates in.

**"What breaks if I change `ContextEngine`?"**

```
gitnexus_impact({ target: "ContextEngine", direction: "upstream", minConfidence: 0.8 })
```

Returns a depth-grouped blast radius with confidence scores for each dependency.

**"Show me the tutorial execution flow"**

```
READ gitnexus://repo/grafana-pathfinder-app/processes
```

Then pick the relevant flow and read its full trace:

```
READ gitnexus://repo/grafana-pathfinder-app/process/{flow-name}
```

**"Find all the authentication-related code"**

```
gitnexus_query({ query: "authentication middleware plugin settings" })
```

Returns symbols grouped by execution flow, so you see which flows are affected.

## Recommended workflow for agents

Agents should follow this sequence at the start of any non-trivial task:

1. `READ gitnexus://repo/grafana-pathfinder-app/context` — check index freshness and get an overview
2. `gitnexus_query(...)` — find relevant symbols and flows for the task
3. `gitnexus_context(...)` on key symbols — understand callers/callees and cluster membership
4. `gitnexus_impact(...)` before making changes — verify blast radius

If the context resource reports the index is stale, run `gitnexus analyze` in the terminal before proceeding.

## CLI reference

```bash
# Index the repo (or update a stale index)
gitnexus analyze

# Force a full re-index
gitnexus analyze --force

# Check index status
gitnexus status

# Generate a wiki from the knowledge graph (requires LLM API key)
gitnexus wiki

# List all indexed repos
gitnexus list

# Delete the index for this repo
gitnexus clean

# Start the MCP server manually (stdio)
gitnexus mcp

# Start a local HTTP server (connects to the GitNexus web UI)
gitnexus serve
```

## Files changed by this setup

| File                          | Change                                          |
| ----------------------------- | ----------------------------------------------- |
| `.gitnexus/`                  | Graph database (gitignored, not committed)      |
| `.gitignore`                  | Added `.gitnexus` entry                         |
| `AGENTS.md`                   | GitNexus section appended (with update markers) |
| `CLAUDE.md`                   | Created — skills dispatch table for Claude Code |
| `.claude/skills/gitnexus/`    | Six agent skills for Claude Code                |
| `~/.cursor/mcp.json`          | Global Cursor MCP config (outside this repo)    |
| `~/.cursor/skills/gitnexus-*` | Global Cursor skills (outside this repo)        |
