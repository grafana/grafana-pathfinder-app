# Design intent for maintain-docs

This document captures the architectural viewpoint and design rationale behind the maintain-docs skill. It is not a procedure — see `SKILL.md` for execution steps. This is the _why_ behind the _what_.

PRs which this skill has created [can be viewed here](https://github.com/grafana/grafana-pathfinder-app/pulls?q=is%3Apr+is%3Aclosed+maintain-docs+label%3Adocumentation)

## Core concept: documentation as materialized view

Documentation about a codebase is conceptually a **materialized view** of the source code — a precomputed projection that trades freshness for accessibility. Like a materialized view in a database, it provides faster access to information that could theoretically be derived from the source of truth (the code), but at the cost of potential drift when the underlying data changes.

This analogy is the foundation of the skill's design. It leads to two key questions:

1. **If agents could always re-derive facts from code, would documentation be unnecessary?** In principle, yes — for a certain class of information. If agents were fast and cheap enough, you could answer any factual question about the system by reading the raw source. No materialized view needed.

2. **What information _cannot_ be derived from code?** This is where the analogy breaks down, and where documentation remains irreplaceable.

## Two layers of documentation

The skill distinguishes between two fundamentally different types of documented information:

### Code-coupled facts (auto-maintainable)

These are claims that can be mechanically verified against the source code:

- File paths and directory structures
- Function, class, and component names
- API shapes, parameter lists, return types
- Configuration values and defaults
- npm scripts and CLI commands
- Data flow and dependency relationships

This layer is a materialized view. It drifts. The maintain-docs skill exists primarily to detect and correct drift in this layer. In a world with sufficiently capable agents, this layer could be eliminated entirely — agents would just read the code.

### Human intent (not derivable from code)

These are claims that cannot be verified or inferred by reading source code, no matter how capable the agent:

- **Rejected alternatives**: What was considered and deliberately not chosen. The code shows what _is_, not what _could have been_. A function implemented with polling doesn't tell you that WebSockets were considered and rejected for reasons of infrastructure cost.
- **Non-goals**: What the system explicitly does not try to do. An authentication module that handles passwords but not OAuth doesn't tell you whether OAuth support is a planned feature or a deliberate exclusion.
- **Business and product context**: Why a system exists at all, who it serves, what problem it solves in the broader product landscape. This context shapes every implementation decision but rarely appears in code.
- **Cross-system integration rationale**: Why two systems interact the way they do, especially when the interaction pattern was shaped by constraints in the _other_ system that aren't visible from this codebase.
- **Stability and maturity signals**: Whether an API is experimental, evolving, or stable. Whether a pattern is load-bearing and widely depended upon, or a prototype that's expected to change.
- **Prioritization context**: Which parts of the system are high-leverage for agent decision-making — where a wrong implementation choice is expensive to fix.

This layer is not a materialized view. It's original content that exists nowhere else. It cannot drift in the same way code-coupled facts drift, because it was never derived from code in the first place. It can become _stale_ (a rejected alternative might become viable, a non-goal might become a goal), but that staleness can only be detected by humans with product context.

## Design consequences

### The skill maintains the materialized view

The primary job of maintain-docs is to keep the code-coupled layer accurate. This is mechanical work: compare docs to code, find mismatches, fix them. The skill is well-suited to this because the verification is objective — a file path either exists or it doesn't, a function either has that signature or it doesn't.

### The skill preserves but does not generate intent

The skill can _detect_ that intent documentation exists (rationale sections, design decision records) and can verify that the code-coupled facts _within_ those sections are still accurate. But it must never fabricate intent. If a doc doesn't explain why a decision was made, the skill cannot invent that explanation — only a human with the original context can provide it.

When the skill encounters intent content during staleness validation, it treats it like any other factual claim: check the parts that reference code, fix errors, leave the rationale alone.

### Not everything needs intent documentation

It's an anti-goal to document intent for every subsystem. This creates coupling that becomes stale and maintenance burden that won't be repaid. Intent documentation should be concentrated where it has the highest leverage:

- **High-traffic agent decision points**: Subsystems where agents frequently make implementation choices and where a wrong choice is expensive to fix.
- **Non-obvious constraints**: Areas where the code looks like it could be changed in an obvious way, but that change would violate an invisible constraint (performance budget, backwards compatibility, external contract).
- **Architectural boundaries**: The interfaces between major subsystems, where the _shape_ of the boundary was a deliberate choice that agents might second-guess.

For everything else, the absence of intent documentation is acceptable. An agent that encounters a subsystem without intent docs should read the code, make a reasonable choice, and move on — not wait for intent to be written.

### Prioritization over comprehensiveness

The skill's complexity budget and scoring system reflect this philosophy. The budget forces triage: fix the highest-leverage issues first, defer the rest. This is intentional. A skill that tried to achieve comprehensive documentation coverage would spend most of its effort on low-value work and create maintenance burden that outweighs the benefit.

The ideal steady state is not "every doc is perfect." It's "the docs that agents need most are accurate, and the intent that matters most is captured." Everything else is acceptable imperfection.

## Relationship to the feedback loop

The Phase 0 feedback check exists because the skill's judgment about what matters is fallible. If PRs are being rejected, the skill's prioritization is misaligned with what the team actually values. The feedback loop corrects for this — it's the mechanism by which human judgment about documentation value feeds back into the skill's behavior.

Without this loop, the skill would optimize for its own scoring criteria, which may not match team needs. With it, the skill converges toward producing work that humans actually want to merge.
