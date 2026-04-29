# pathfinder-cli

Command-line authoring tool for [Grafana Pathfinder](https://github.com/grafana/grafana-pathfinder-app) interactive guide packages.

`pathfinder-cli` reads, mutates, validates, and writes Pathfinder guide packages on disk. Schema-driven flags and an agent-oriented `--format json` surface make it usable both interactively and as the validator behind an MCP authoring server.

## Install

```sh
npx pathfinder-cli@latest --version
```

Or pin to a specific guide-schema version:

```sh
npx pathfinder-cli@1.1.0 --version
```

The published version of this package matches the guide schema version it understands. CLI and schema cannot drift.

### Docker

```sh
docker run --rm grafana/pathfinder-cli:latest --version
docker run --rm -v "$PWD:/workspace" grafana/pathfinder-cli:latest create my-guide --title "My guide"
```

The image's first positional argument selects the entrypoint. The default is `pathfinder-cli`. `mcp` routes to `pathfinder-mcp` (added in a future release).

## Usage

```sh
pathfinder-cli --help
pathfinder-cli <command> --help
pathfinder-cli <command> --help --format json   # stable JSON shape for agents
```

Common commands:

| Command        | Purpose                                                  |
| -------------- | -------------------------------------------------------- |
| `create`       | Create a new guide package on disk.                      |
| `add-block`    | Append a block (step, choice, multistep, etc.).          |
| `add-step`     | Add a step to an existing interactive block.             |
| `add-choice`   | Add a choice to a quiz block.                            |
| `edit-block`   | Edit a block's fields by id.                             |
| `remove-block` | Remove a block by id.                                    |
| `set-manifest` | Update manifest fields (title, description, tags, …).    |
| `inspect`      | Print the package's structure as text or JSON.           |
| `validate`     | Validate a package directory against the current schema. |

Every mutation revalidates the package on write — invalid packages cannot be saved.

## For agents

`--help --format json` is a stability contract. The shape is documented and intended to be consumed by AI authoring agents. See [AGENT-AUTHORING.md](https://github.com/grafana/grafana-pathfinder-app/blob/main/docs/design/AGENT-AUTHORING.md) for the agent context block, command reference, and authoring workflow.

## Documentation

- [AGENT-AUTHORING.md](https://github.com/grafana/grafana-pathfinder-app/blob/main/docs/design/AGENT-AUTHORING.md) — full CLI reference and agent context.
- [PATHFINDER-AI-AUTHORING.md](https://github.com/grafana/grafana-pathfinder-app/blob/main/docs/design/PATHFINDER-AI-AUTHORING.md) — the design this CLI is one component of.
- [Repository](https://github.com/grafana/grafana-pathfinder-app) — issues, contributions.

## License

AGPL-3.0
