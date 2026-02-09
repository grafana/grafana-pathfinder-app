# SCORM Import Feasibility Analysis

This document synthesizes research and architectural analysis on importing SCORM files into the Pathfinder platform. It covers the SCORM format, the Pathfinder guide format, a detailed gap analysis, and a phased implementation approach.

## Table of Contents

- [Context & Assumptions](#context--assumptions)
- [SCORM Overview](#scorm-overview)
- [Pathfinder Interactive Guides Overview](#pathfinder-interactive-guides-overview)
- [Structural Cross-Walk](#structural-cross-walk)
- [Gap Analysis](#gap-analysis)
- [Translation Architecture](#translation-architecture)
- [Phased Implementation Plan](#phased-implementation-plan)
- [Design Constraints](#design-constraints)
- [Open Questions](#open-questions)
- [References](#references)

---

## Context & Assumptions

This analysis is informed by several current and planned developments in Pathfinder:

1. **Web display**: We'll want the ability to display Pathfinder guides on the web, with interactive features disabled. Content would render as narrative text describing what to do, without requiring Grafana Cloud. This means the guide format could evolve beyond being a Grafana-only in-product experience — it could becoming a general-purpose structured learning format.

2. **Package evolution**: Pathfinder guides are evolving beyond single JSON files toward a **package model** with rich metadata. The guide dependencies design ([guide-dependencies-design.md](./guide-dependencies-design.md)) introduces Debian-inspired dependency semantics (`depends`, `recommends`, `suggests`, `provides`, `conflicts`, `replaces`) and test environment metadata. This package model can naturally accommodate Dublin Core metadata, SCORM-equivalent fields, and other packaging concerns.

3. **Non-Grafana content**: If Pathfinder guides can be displayed on the web outside of Grafana Cloud, the format becomes suitable for learning content (e.g., sales training, compliance). A SCORM import that produces non-interactive Pathfinder packages is a valid and useful outcome even without live Grafana UI integration.

4. **Import as package decomposition**: A single SCORM course would typically map to a **set of interrelated Pathfinder packages** linked by Debian-style dependencies, not a single monolithic guide. This mirrors how SCORM's organization tree decomposes a course into SCOs, and how Debian packages decompose a system into components.

---

## SCORM Overview

### What SCORM Is

SCORM (Sharable Content Object Reference Model) is a set of technical standards for e-learning, maintained by the Advanced Distributed Learning (ADL) initiative. It defines how learning content is packaged, delivered, and tracked within a Learning Management System (LMS). SCORM has been the dominant e-learning interoperability standard since the early 2000s.

### Versions

| Feature | SCORM 1.2 (2001) | SCORM 2004 4th Ed. (2009) |
|---------|-------------------|---------------------------|
| Packaging | ZIP + `imsmanifest.xml` | ZIP + `imsmanifest.xml` |
| Content model | SCOs + Assets | SCOs + Assets |
| Sequencing | None (LMS decides) | Full sequencing & navigation rules |
| Suspend data | 4,096 characters | 64,000 characters |
| Interaction tracking | Limited | Full interaction model (10 types) |
| Navigation control | LMS-controlled | Content-author-controlled |
| Adoption | Most widely deployed | More capable but less adopted |

### Package Structure

A SCORM package is a ZIP file containing:

```
my-course.zip
├── imsmanifest.xml          ← Master manifest (XML)
├── schemas/                  ← XSD schema definitions
├── module-1/
│   ├── index.html            ← SCO launch file
│   ├── script.js             ← SCORM API calls + interactivity
│   ├── style.css
│   └── images/
│       └── diagram.png
├── module-2/
│   ├── index.html
│   └── quiz.html
└── shared-assets/
    ├── logo.png
    └── intro-video.mp4
```

### Manifest Structure (`imsmanifest.xml`)

The manifest contains four major sections:

**1. Metadata** — IEEE Learning Object Metadata (LOM):
- Title, description, keywords, language
- Author, publisher, rights/licensing
- Difficulty level, typical learning time
- Educational context, intended audience
- Technical requirements

**2. Organizations** — Hierarchical activity tree:
```xml
<organizations default="org-1">
  <organization identifier="org-1">
    <title>Sales Training Course</title>
    <item identifier="module-1" identifierref="sco-1">
      <title>Module 1: Introduction</title>
      <item identifier="lesson-1a" identifierref="sco-1a">
        <title>Lesson 1a: Company Overview</title>
      </item>
      <item identifier="lesson-1b" identifierref="sco-1b">
        <title>Lesson 1b: Product Line</title>
      </item>
    </item>
    <item identifier="module-2" identifierref="sco-2">
      <title>Module 2: Advanced Techniques</title>
    </item>
  </organization>
</organizations>
```

Items can nest arbitrarily deep. Parent items are containers (clusters); leaf items reference actual content (SCOs or Assets). A single package can contain multiple organizations presenting the same content in different arrangements.

**3. Resources** — Content files, classified as:
- **SCOs** (Sharable Content Objects): Interactive HTML/JS that communicates with the LMS via the SCORM Runtime API
- **Assets**: Static files (images, CSS, PDFs) that don't communicate with the LMS

**4. Sequencing** (SCORM 2004 only):
- Pre-condition rules (gates access based on prior activity)
- Post-condition rules (determines what happens after completion)
- Exit condition rules (evaluates on learner exit)
- Rollup rules (aggregates child activity state to parents)
- Control modes: Choice, Flow, ForwardOnly, ChoiceExit

### Runtime Data Model

SCORM's JavaScript API (`LMSInitialize`, `LMSSetValue`, `LMSGetValue`, etc.) enables SCOs to report learner state to the LMS:

| Data Element | Description |
|-------------|-------------|
| `cmi.completion_status` | incomplete, completed, not attempted |
| `cmi.success_status` | passed, failed, unknown |
| `cmi.score.raw/min/max/scaled` | Numeric scores with configurable ranges |
| `cmi.objectives.n.*` | Named learning objectives with individual satisfaction and scores |
| `cmi.interactions.n.*` | Per-question tracking (type, response, result, latency, weighting) |
| `cmi.suspend_data` | Arbitrary state string for bookmark/resume |
| `cmi.session_time` / `cmi.total_time` | Time tracking |
| `cmi.learner_preference.*` | Audio level, language, delivery speed |
| `cmi.launch_data` | Content-specific initialization data |

### SCORM Interaction Types (Assessment)

SCORM defines 10 interaction types for tracking learner responses:

| Type | Description | Example |
|------|-------------|---------|
| `true_false` | Boolean response | "Is the sky blue?" → true |
| `choice` | Single or multiple choice | Select A, B, C, or D |
| `fill_in` | Short text entry | "The capital of France is ___" |
| `long_fill_in` | Extended text entry | Essay or paragraph response |
| `matching` | Pair related items | Match terms to definitions |
| `performance` | Simulation or demonstration | Complete a task in a simulated environment |
| `sequencing` | Order items correctly | Arrange steps in the right order |
| `likert` | Scale-based response | Rate 1-5: "I found this helpful" |
| `numeric` | Numerical value entry | "What is 7 × 8?" → 56 |
| `other` | Catch-all for custom types | Vendor-specific interactions |

---

## Pathfinder Interactive Guides Overview

### Current Format

Pathfinder guides are JSON files with this root structure:

```json
{
  "schemaVersion": "1.0.0",
  "id": "unique-guide-id",
  "title": "Guide Title",
  "blocks": [ ... ]
}
```

### Block Types (12)

| Category | Block Types | Purpose |
|----------|-------------|---------|
| Content | `markdown`, `html`, `image`, `video` | Static instructional content |
| Interactive | `interactive`, `multistep`, `guided` | Drive actions in the live Grafana UI |
| Structural | `section`, `conditional`, `assistant` | Grouping, branching, AI customization |
| Assessment | `quiz`, `input` | Knowledge checks, user input collection |

### Evolving Package Model

The guide dependencies design introduces Debian-inspired package metadata:

```json
{
  "schemaVersion": "1.0.0",
  "id": "advanced-alerting-techniques",
  "title": "Advanced alerting techniques",
  "dependencies": {
    "depends": ["intro-to-alerting"],
    "recommends": ["prometheus-quickstart"],
    "suggests": ["oncall-integration", "alert-silencing"],
    "provides": ["multi-condition-alerts", "notification-policies"],
    "conflicts": ["deprecated-alerting-v9"],
    "replaces": ["alerting-techniques-v10"],
    "testEnvironment": { ... }
  },
  "blocks": [ ... ]
}
```

This model directly parallels how SCORM organizations decompose courses into prerequisite-linked activities.

### Key Differentiating Features

- **Live UI interaction**: `interactive`, `multistep`, `guided` blocks drive the real Grafana UI (when displayed in-product)
- **DOM targeting**: `reftarget` fields use CSS selectors to reference real UI elements
- **Application state requirements**: Prerequisites like `has-datasource:prometheus`, `is-admin`, `on-page:/dashboards`
- **Auto-completion objectives**: Detects when the user has already accomplished a step
- **Contextual recommendations**: `index.json` rules determine when/where to surface content
- **Conditional branching**: `conditional` blocks show different content based on runtime state
- **AI customization**: `assistant` blocks enable AI-powered content adaptation
- **Variable collection**: `input` blocks collect data that flows into subsequent steps

### Web Display Mode

When displayed on the web (outside Grafana), interactive features are disabled. The rendering degrades to narrative text:
- `interactive` blocks → descriptive text ("Click the Dashboards button in the navigation menu")
- `multistep` blocks → numbered step descriptions
- `guided` blocks → instructional text
- Content blocks (`markdown`, `image`, `video`, `quiz`, `input`) → render normally
- `section` blocks → collapsible sections or headings
- DOM selectors, requirements, and objectives → ignored

This web display mode is important for SCORM import: imported content would naturally work in web mode since it has no Grafana-specific interactive elements.

---

## Structural Cross-Walk

### Package-Level Mapping

| SCORM Concept | Pathfinder Equivalent | Notes |
|---------------|----------------------|-------|
| ZIP package | Guide package (JSON + assets) | SCORM is a ZIP; Pathfinder is evolving toward a package model |
| `imsmanifest.xml` | Guide `dependencies` field + proposed metadata | Manifest metadata maps to package metadata |
| Organization (activity tree) | Array of guides linked by `depends`/`recommends` | One SCORM organization → multiple interrelated Pathfinder packages |
| Item (cluster) | Guide package that `depends` on child guides | Parent items become container guides |
| Item (leaf) | Individual guide package | Leaf items become standalone guides |
| SCO (interactive content) | Guide with content blocks (no interactive blocks when imported) | SCO interactivity is lost; content text is preserved |
| Asset (static content) | `image`, `video` blocks; package assets | Direct mapping |
| Multiple organizations | Multiple dependency trees over the same guide pool | Same guides, different `depends` chains |

### Content-Level Mapping

| SCORM Content | Pathfinder Block | Translation Fidelity |
|---------------|-----------------|---------------------|
| HTML instructional pages | `markdown` blocks (via HTML-to-Markdown) or `html` blocks | High — text, headings, lists, tables, code all convert well |
| Embedded images | `image` block | Direct mapping |
| Embedded video | `video` block | Direct for standard video; custom players won't translate |
| Multiple choice questions | `quiz` block (`choices[]`, `multiSelect: false`) | Direct mapping |
| True/false questions | `quiz` block with 2 boolean choices | Direct mapping |
| Multi-select questions | `quiz` block (`multiSelect: true`) | Direct mapping |
| Fill-in-the-blank | `input` block (`inputType: "text"`, `pattern` for validation) | Partial — collects text but assessment semantics differ |
| Long-form text | `input` block (`inputType: "text"`) | Text is collected but not auto-graded |
| Matching questions | **No equivalent** | **Gap** |
| Sequencing/ordering | **No equivalent** | **Gap** |
| Likert scale | **No equivalent** | **Gap** |
| Numeric response | `input` block with regex `pattern` | Partial |
| Drag-and-drop / performance | **No equivalent** | **Gap** |

### Metadata Mapping

| SCORM Metadata (LOM) | Pathfinder Equivalent | Notes |
|-----------------------|----------------------|-------|
| Title | `title` field | Direct |
| Description | Recommendation rule `description` | Direct |
| Identifier | `id` field | Direct |
| Keywords | **No equivalent — proposed: `metadata.keywords`** | Gap |
| Language | **No equivalent — proposed: `metadata.language`** | Gap |
| Author | **No equivalent — proposed: `metadata.author`** | Gap |
| Difficulty | **No equivalent — proposed: `metadata.difficulty`** | Gap |
| Typical learning time | **No equivalent — proposed: `metadata.duration`** | Gap |
| Rights / licensing | **No equivalent — proposed: `metadata.rights`** | Gap |
| Educational context | **No equivalent — proposed: `metadata.context`** | Gap |
| Technical requirements | `dependencies.testEnvironment` | Partial — test env metadata is close but Grafana-specific |
| Prerequisites | `dependencies.depends` | Good match via Debian model |

### Sequencing Mapping

| SCORM Sequencing | Pathfinder Equivalent | Notes |
|------------------|----------------------|-------|
| Linear (forward-only) | `depends` chain: A → B → C | Natural mapping via ordered dependencies |
| Choice (any order) | `recommends` or no dependency | Guides available without hard prerequisite |
| Pre-condition rules | `depends` + `conflicts` | Simplified but functionally similar |
| Post-condition rules | **No equivalent** | Gap — no "on completion, do X" trigger |
| Rollup rules | **No equivalent** | Gap — no automatic state aggregation from child to parent |
| Attempt limits | **No equivalent** | Gap |
| Weighted scoring | **No equivalent** | Gap |

---

## Gap Analysis

### Gaps That Block SCORM Import (Must Address)

These gaps must be closed for a meaningful SCORM import pipeline:

#### G1: No Dublin Core / LOM Metadata in Guide Packages

**SCORM has**: Rich IEEE LOM metadata — title, description, keywords, language, author, difficulty, typical learning time, rights, educational context, intended audience, technical requirements.

**Pathfinder has**: Only `id` and `title` at the guide level; `description` in the recommendation rule.

**Impact on import**: SCORM metadata would be discarded, losing discoverability, attribution, rights, and educational context.

**Proposed resolution**: Add a `metadata` field to the guide package schema:

```json
{
  "id": "...",
  "title": "...",
  "metadata": {
    "description": "Full course description",
    "keywords": ["sales", "onboarding", "CRM"],
    "language": "en",
    "author": {
      "name": "Jane Smith",
      "organization": "Training Dept"
    },
    "difficulty": "intermediate",
    "typicalLearningTime": "PT2H30M",
    "rights": {
      "license": "CC-BY-4.0",
      "copyrightNotice": "© 2025 Acme Corp"
    },
    "educationalContext": ["professional-development", "sales"],
    "source": {
      "format": "SCORM",
      "version": "2004-4th",
      "importedAt": "2026-02-07T00:00:00Z",
      "originalIdentifier": "com.acme.sales-training-101"
    }
  },
  "dependencies": { ... },
  "blocks": [ ... ]
}
```

This is a natural extension of the evolving package model. The `source` sub-field provides provenance tracking for imported content.

**Effort**: Low — schema extension, not a new system.

#### G2: No Course / Module Container Concept

**SCORM has**: An explicit organization tree where parent items are containers grouping child items into modules, chapters, and lessons. A single SCORM package can define multiple organizations of the same content.

**Pathfinder has**: Individual guides linked by Debian-style dependencies. No formal "course" or "module" entity that groups guides into a named, ordered collection.

**Impact on import**: A SCORM course with 3 modules of 5 lessons each would become 15 individual guides plus 3 module guides plus 1 course guide — but there is no formal entity representing "this is a course called Sales Training 101 containing these modules."

**Proposed resolution**: Introduce a lightweight course/collection manifest — either:
- **(A)** A special guide type (e.g., `"type": "course"`) whose `blocks` contain only `markdown` overview content and whose `dependencies.depends` defines the ordered module list
- **(B)** A separate `collection.json` manifest that names a set of guides and their intended ordering

Option A is simpler and stays within the existing format; the "course guide" would render as a table-of-contents page on the web.

**Effort**: Medium — needs design decision, schema extension, and rendering support.

#### G3: Limited Assessment Block Types

**SCORM has**: 10 interaction types including matching, sequencing, Likert, numeric, drag-and-drop, and performance simulations.

**Pathfinder has**: `quiz` (single/multi-select choice) and `input` (text, boolean, datasource).

**Impact on import**: Matching, sequencing, Likert, and performance interactions cannot be faithfully translated. They would degrade to markdown descriptions or be dropped.

**Proposed resolution (incremental)**:
1. **Phase 1**: Degrade unsupported types to `markdown` blocks with the question text rendered as instructional content. Generate an import report flagging the degradation.
2. **Phase 2**: Add new assessment block types as needed:
   - `matching` — pair items from two lists
   - `ordering` — arrange items in correct sequence
   - `scale` — Likert or numeric scale response
3. **Phase 3**: Consider `performance` blocks for simulation-like interactions (lowest priority, highest complexity).

**Effort**: Phase 1 is low (lossy but functional). Phases 2-3 are medium-high per block type (schema, rendering, validation).

### Gaps That Degrade SCORM Import (Should Address)

These gaps result in information loss but don't block the import pipeline:

#### G4: No Scoring Model

**SCORM has**: Per-interaction scores (raw, min, max, scaled), per-objective scores, and overall course score with weighted rollup.

**Pathfinder has**: No scoring concept whatsoever. Quizzes have correct/incorrect feedback but no numeric score.

**Impact on import**: All SCORM scoring data is lost. Imported quizzes function as knowledge checks without grades.

**Proposed resolution**: Consider adding optional scoring metadata:
```json
{
  "type": "quiz",
  "question": "...",
  "choices": [...],
  "scoring": {
    "points": 10,
    "weight": 1.0,
    "objectiveId": "product-knowledge"
  }
}
```

Guide-level scoring could aggregate block scores:
```json
{
  "scoring": {
    "passingScore": 0.8,
    "objectives": [
      { "id": "product-knowledge", "weight": 0.6 },
      { "id": "process-compliance", "weight": 0.4 }
    ]
  }
}
```

**Effort**: High — requires schema changes, scoring engine, state persistence, and UI.

#### G5: No Completion Tracking / LMS API

**SCORM has**: Bidirectional runtime API where content reports completion, scores, and interaction data back to the LMS. The LMS stores, aggregates, and reports on this data.

**Pathfinder has**: Implicit telemetry signals. No formal completion API, no persistent learner record, no reporting dashboard.

**Impact on import**: Imported SCORM content loses all LMS integration. Organizations that require compliance tracking or completion certificates cannot use Pathfinder as a replacement.

**Proposed resolution**: This is a large platform capability, not just a schema change. If Pathfinder evolves toward LMS-like features, it would need:
- A completion tracking API
- Persistent learner records
- Reporting/analytics dashboard
- Possibly xAPI (Experience API / Tin Can) integration as the modern successor to SCORM's runtime API

**Effort**: Very high — this is a product direction decision, not a feature.

#### G6: No Suspend / Resume (Bookmarking)

**SCORM has**: `cmi.suspend_data` allows arbitrary state persistence. Learners can leave mid-course and resume exactly where they stopped.

**Pathfinder has**: Guides are stateless per session. Closing a guide loses all progress.

**Impact on import**: Long imported courses cannot be resumed. This is especially painful for multi-hour SCORM courses.

**Proposed resolution**: Track completion state per guide in the dependency chain. If a SCORM course is decomposed into 15 guides linked by `depends`, the system can track which guides are complete and resume at the first incomplete guide. This is coarser than SCORM's arbitrary bookmark but functional.

More granular resume (within a guide) would require block-level state persistence.

**Effort**: Medium for guide-level tracking; high for block-level resume.

#### G7: No Post-Completion Triggers or Rollup

**SCORM has**: Post-condition rules ("after completing this SCO, unlock the next module"), exit condition rules, and rollup rules that aggregate child state to parent state.

**Pathfinder has**: `depends` gates access but there is no trigger system for "on completion of X, do Y" and no automatic state rollup.

**Impact on import**: Complex SCORM sequencing logic (e.g., "complete 3 of 5 modules to pass") cannot be expressed. Simple linear ordering translates fine.

**Proposed resolution**: The Debian dependency model already handles linear prerequisites. For more complex patterns:
- `depends` with version/completion constraints: `"depends": [{"id": "module-1", "completion": "any-3-of-5"}]`
- Or express rollup at the course/collection level

**Effort**: Medium — extends the dependency model.

### Gaps That Are Acceptable (Won't Address)

| Gap | Rationale |
|-----|-----------|
| **No live UI interaction for imported content** | SCORM content is self-contained HTML; it was never designed to drive Grafana's UI. Imported content is informational by nature. Web display mode handles this naturally. |
| **No SCORM Runtime API emulation** | Pathfinder is not an LMS and should not become one. The import strips SCORM API calls from content. |
| **No multiple organization support** | A single Pathfinder dependency tree per import is sufficient. If multiple organizations are needed, run the import once per organization. |
| **No learner preference management** | SCORM's learner preferences (audio level, language, delivery speed) are presentation concerns. Pathfinder's rendering handles these differently. |
| **Loss of custom JavaScript interactivity** | SCORM SCOs often contain vendor-specific JavaScript for animations, simulations, and custom UIs. This is opaque and cannot be automatically translated to any declarative format. The import report should flag JavaScript-heavy SCOs for manual review. |

---

## Translation Architecture

### Core Concept: SCORM → Array of Pathfinder Packages

A SCORM import decomposes one SCORM package into multiple Pathfinder guide packages linked by Debian dependencies:

```
SCORM Package: "Sales Training 101"
├── Organization: Sales Training
│   ├── Module 1: Introduction
│   │   ├── Lesson 1a: Company Overview (SCO)
│   │   └── Lesson 1b: Product Line (SCO)
│   ├── Module 2: Techniques
│   │   ├── Lesson 2a: Prospecting (SCO)
│   │   └── Lesson 2b: Closing (SCO)
│   └── Final Assessment (SCO)
```

Becomes:

```
Pathfinder Packages:
├── sales-training-101/                  ← Course package (type: course)
│   ├── content.json                     ← Table of contents + overview
│   └── index.json                       ← Recommendation rules
├── sales-training-101-mod1/             ← Module 1 package
│   ├── content.json                     ← Module overview + lessons
│   └── index.json
├── sales-training-101-mod1-lesson1a/    ← Leaf lesson package
│   ├── content.json                     ← Actual content (markdown, images, quiz)
│   └── index.json
├── sales-training-101-mod1-lesson1b/
│   └── ...
├── sales-training-101-mod2/
│   └── ...
├── sales-training-101-mod2-lesson2a/
│   └── ...
├── sales-training-101-mod2-lesson2b/
│   └── ...
└── sales-training-101-assessment/
    └── ...
```

Dependency relationships:

```json
// sales-training-101/content.json
{
  "id": "sales-training-101",
  "title": "Sales Training 101",
  "type": "course",
  "metadata": { /* LOM metadata from SCORM manifest */ },
  "dependencies": {
    "depends": [
      "sales-training-101-mod1",
      "sales-training-101-mod2",
      "sales-training-101-assessment"
    ],
    "provides": ["sales-training-complete"]
  },
  "blocks": [
    { "type": "markdown", "content": "# Sales Training 101\n\nThis course covers..." }
  ]
}

// sales-training-101-mod1/content.json
{
  "id": "sales-training-101-mod1",
  "title": "Module 1: Introduction",
  "dependencies": {
    "depends": [
      "sales-training-101-mod1-lesson1a",
      "sales-training-101-mod1-lesson1b"
    ],
    "provides": ["sales-intro-complete"]
  },
  "blocks": [
    { "type": "markdown", "content": "# Module 1: Introduction\n\nIn this module..." }
  ]
}

// sales-training-101-mod2/content.json
{
  "id": "sales-training-101-mod2",
  "title": "Module 2: Techniques",
  "dependencies": {
    "depends": [
      "sales-training-101-mod1",    // Must complete Module 1 first
      "sales-training-101-mod2-lesson2a",
      "sales-training-101-mod2-lesson2b"
    ]
  },
  "blocks": [ ... ]
}

// sales-training-101-mod1-lesson1a/content.json
{
  "id": "sales-training-101-mod1-lesson1a",
  "title": "Company Overview",
  "metadata": {
    "source": { "format": "SCORM", "originalIdentifier": "lesson-1a" }
  },
  "blocks": [
    { "type": "markdown", "content": "## Our Company\n\nFounded in 1985..." },
    { "type": "image", "src": "https://cdn.example.com/assets/org-chart.png", "alt": "Organization chart" },
    { "type": "quiz", "question": "When was the company founded?",
      "choices": [
        { "id": "a", "text": "1975", "correct": false },
        { "id": "b", "text": "1985", "correct": true },
        { "id": "c", "text": "1995", "correct": false }
      ]
    }
  ]
}
```

### Import Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    SCORM Import Pipeline                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Stage 1: PARSE                                              │
│  ├─ Unzip SCORM .zip package                                │
│  ├─ Parse imsmanifest.xml                                    │
│  ├─ Extract organization tree (items, hierarchy, ordering)   │
│  ├─ Extract resource map (SCOs, Assets, file references)     │
│  ├─ Extract LOM metadata (title, author, keywords, etc.)     │
│  ├─ Extract sequencing rules (SCORM 2004)                    │
│  └─ Detect SCORM version (1.2 vs 2004 editions)             │
│                                                              │
│  Stage 2: EXTRACT                                            │
│  ├─ For each SCO:                                            │
│  │   ├─ Load launch HTML file                                │
│  │   ├─ Strip SCORM Runtime API JavaScript                   │
│  │   │   (LMSInitialize, LMSSetValue, LMSGetValue, etc.)    │
│  │   ├─ Extract text content, headings, structure            │
│  │   ├─ Extract embedded images, video, audio references     │
│  │   ├─ Identify assessment interactions (forms, quizzes)    │
│  │   └─ Flag JavaScript-heavy SCOs for manual review         │
│  └─ For each Asset:                                          │
│      └─ Catalog file type, size, references                  │
│                                                              │
│  Stage 3: TRANSFORM                                          │
│  ├─ HTML → Markdown conversion (via turndown or similar)     │
│  ├─ Image/video → asset extraction + CDN upload manifest     │
│  ├─ Quiz/assessment → quiz/input block generation            │
│  │   ├─ choice → quiz block                                  │
│  │   ├─ true_false → quiz block (2 choices)                  │
│  │   ├─ fill_in → input block with pattern                   │
│  │   ├─ matching → markdown (degraded) or matching block     │
│  │   ├─ sequencing → markdown (degraded) or ordering block   │
│  │   ├─ likert → markdown (degraded) or scale block          │
│  │   └─ other → markdown with question text                  │
│  ├─ Organization hierarchy → dependency tree                 │
│  │   ├─ Parent items → "depends" on child guides             │
│  │   ├─ Sequential items → "depends" chain                   │
│  │   └─ Optional items → "recommends" links                  │
│  ├─ Sequencing rules → dependency constraints                │
│  │   ├─ Prerequisites → "depends"                            │
│  │   ├─ Forward-only → linear "depends" chain                │
│  │   └─ Choice mode → no hard dependencies                   │
│  └─ LOM metadata → package metadata field                    │
│                                                              │
│  Stage 4: ASSEMBLE                                           │
│  ├─ Determine splitting strategy:                            │
│  │   ├─ ≤5 leaf SCOs → single guide with sections            │
│  │   ├─ 6-20 leaf SCOs → guide per top-level item            │
│  │   └─ 20+ leaf SCOs → guide per leaf SCO                   │
│  ├─ Build JSON guide for each package                        │
│  ├─ Generate dependency fields linking packages              │
│  ├─ Generate recommendation rules (index.json) per package   │
│  ├─ Validate all guides against Zod schema                   │
│  └─ Build course-level overview guide (table of contents)    │
│                                                              │
│  Stage 5: OUTPUT                                             │
│  ├─ Write content.json files per package directory            │
│  ├─ Write index.json recommendation rule files               │
│  ├─ Write media asset manifest (for CDN upload)              │
│  ├─ Generate import report:                                  │
│  │   ├─ What was translated faithfully                       │
│  │   ├─ What was degraded (with reasons)                     │
│  │   ├─ What was dropped (with reasons)                      │
│  │   ├─ JavaScript-heavy SCOs flagged for manual review      │
│  │   └─ Suggested enhancements (interactive steps to add)    │
│  └─ Optionally: generate PR for interactive-tutorials repo   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Phased Implementation Plan

### Phase 0: Schema Foundation (2-3 weeks)

Extend the Pathfinder guide schema to support SCORM import needs. This work benefits the platform independently of SCORM import.

**Deliverables:**
- [ ] Add `metadata` field to guide schema (Dublin Core / LOM-compatible subset)
  - `description`, `keywords`, `language`, `author`, `difficulty`, `typicalLearningTime`, `rights`, `educationalContext`
  - `source` sub-field for provenance tracking (format, version, importedAt, originalIdentifier)
- [ ] Add `type` field to guide schema (`"guide"`, `"course"`, `"module"`) to distinguish container packages from content packages
- [ ] Validate that the existing `dependencies` design accommodates the import patterns described above
- [ ] Design the course/collection rendering in web display mode (table of contents page)

**Dependencies**: Requires alignment with the guide dependencies design work already in progress.

### Phase 1: SCORM Parser + Content Extractor (3-4 weeks)

Build the core SCORM package parser. This is a standalone tool (CLI) that reads a SCORM ZIP and produces a structured intermediate representation.

**Deliverables:**
- [ ] SCORM ZIP extraction and validation
- [ ] `imsmanifest.xml` parser (both SCORM 1.2 and 2004)
- [ ] Organization tree extraction (items, hierarchy, resource references)
- [ ] LOM metadata extraction
- [ ] Resource classification (SCO vs Asset)
- [ ] SCORM 2004 sequencing rule extraction (basic)
- [ ] HTML content extraction from SCOs (strip SCORM API calls, extract body content)
- [ ] Assessment interaction detection (identify quiz/question patterns in HTML/JS)
- [ ] Intermediate representation (JSON AST of the parsed SCORM package)

**Technology**: TypeScript (to align with the Pathfinder plugin codebase). Could be implemented as a Node.js CLI tool. XML parsing via a standard library (e.g., `fast-xml-parser`). HTML parsing via `cheerio` or `jsdom`.

### Phase 2: Content Transformer + Guide Assembler (3-4 weeks)

Transform the intermediate representation into Pathfinder guide packages.

**Deliverables:**
- [ ] HTML-to-Markdown converter (using `turndown` or similar)
- [ ] Image and video asset extraction with CDN upload manifest
- [ ] Assessment-to-block transformer:
  - `choice` / `true_false` → `quiz` block
  - `fill_in` → `input` block
  - Unsupported types → `markdown` block with degradation notice
- [ ] Organization tree → Pathfinder package tree:
  - Splitting strategy implementation (small/medium/large)
  - Dependency field generation (`depends`, `recommends`)
  - Course overview guide generation
- [ ] Sequencing rule → dependency constraint mapping
- [ ] LOM metadata → package `metadata` field mapping
- [ ] Schema validation of all generated guides
- [ ] Import report generator

### Phase 3: Integration + Recommendation Rules (2-3 weeks)

Integrate the import pipeline with the Pathfinder ecosystem.

**Deliverables:**
- [ ] Recommendation rule generation (`index.json` per package)
  - Auto-generate rules from SCORM metadata (keywords → URL matching, educational context → platform targeting)
- [ ] CDN asset upload integration
- [ ] PR generation for `interactive-tutorials` repo (optionally)
- [ ] Web display validation (ensure imported guides render correctly in web mode)
- [ ] End-to-end testing with real-world SCORM packages
  - Gather 5-10 diverse SCORM packages (different authoring tools, versions, complexity levels)
  - Validate import fidelity and report accuracy

### Phase 4: Enhanced Assessment Types (4-6 weeks, optional)

Add new block types to improve SCORM assessment fidelity.

**Deliverables:**
- [ ] `matching` block type (pair items from two lists)
- [ ] `ordering` block type (arrange items in correct sequence)
- [ ] `scale` block type (Likert / numeric scale)
- [ ] Schema, rendering, and validation for each new type
- [ ] Web display rendering for each new type
- [ ] Update the SCORM transformer to use new block types instead of markdown degradation

### Phase 5: Scoring + Completion Tracking (6-8 weeks, optional)

Add scoring and completion tracking to close the LMS capability gap. This is a significant platform investment.

**Deliverables:**
- [ ] Per-block scoring metadata (points, weight, objective)
- [ ] Guide-level scoring aggregation (passing score, weighted objectives)
- [ ] Completion state persistence (guide-level at minimum)
- [ ] Progress tracking API
- [ ] Reporting / analytics dashboard
- [ ] Resume support (guide-level: resume at first incomplete guide in chain)

---

## Design Constraints

### DC1: Imported Guides Have No Interactive Elements

SCORM content is self-contained HTML. It was authored without knowledge of Grafana's DOM, selectors, or application state. Therefore:
- Imported guides will have **zero** `interactive`, `multistep`, or `guided` blocks
- Imported guides will have **no** `reftarget` fields, no `requirements` referencing application state, no `objectives` checking Grafana conditions
- This is correct and expected — not a failure of the import

Imported guides are pure informational content: markdown, images, video, and quizzes. They function identically in web display mode and in-product mode (since there is no interactivity to disable).

Authors may later enhance imported guides with Pathfinder-native interactive elements using the Block Editor, treating the import as a scaffold.

### DC2: Lossy Translation Is Expected and Acceptable

SCORM-to-Pathfinder is a **lossy translation** by design. The import report should clearly document what was lost and why. Acceptable losses include:
- Custom JavaScript interactivity (opaque, cannot be translated)
- SCORM Runtime API integration (Pathfinder is not an LMS)
- Scoring and grading (unless Phase 5 is implemented)
- Complex sequencing logic beyond linear prerequisites
- Vendor-specific SCORM extensions

The import pipeline should never silently drop content. Every loss should be documented in the import report.

### DC3: SCORM 1.2 First, 2004 Second

SCORM 1.2 is simpler (no sequencing), more widely deployed, and covers the majority of existing SCORM content. The import pipeline should handle SCORM 1.2 completely before adding SCORM 2004 sequencing support. The SCORM 2004 content packaging model is similar enough that the parser handles both; the difference is in sequencing rule extraction.

### DC4: One Import, Multiple Packages

A single SCORM import always produces a **directory** of Pathfinder packages, not a single file. Even a simple SCORM package with one SCO produces at minimum one content guide. A complex course produces a tree of packages. The import tool should output a directory structure ready for PR into the `interactive-tutorials` repo.

### DC5: The Import Tool Is a CLI, Not a UI

The SCORM importer should be a command-line tool, not a web UI. This aligns with the Content-as-Code philosophy: imported content enters the pipeline via PR, just like authored content. The CLI takes a SCORM ZIP as input and produces a directory of Pathfinder packages plus an import report.

```bash
npx pathfinder-scorm-import \
  --input sales-training.zip \
  --output ./imported/sales-training/ \
  --cdn-base https://interactive-learning.grafana.net/guides/ \
  --splitting-strategy auto
```

### DC6: Preserve Provenance

Every imported guide must carry provenance metadata indicating its SCORM origin:

```json
{
  "metadata": {
    "source": {
      "format": "SCORM",
      "version": "1.2",
      "importedAt": "2026-02-07T00:00:00Z",
      "originalIdentifier": "com.acme.sales-training-101",
      "originalTitle": "Sales Training 101 (SCORM)",
      "importToolVersion": "1.0.0"
    }
  }
}
```

This enables downstream tooling to identify imported content, track drift from the original, and potentially re-import when the SCORM source is updated.

### DC7: Security — HTML Sanitization

SCORM packages can contain arbitrary HTML and JavaScript. Per the frontend security rules:
- All HTML content extracted from SCOs **must** be sanitized with DOMPurify before being stored in `html` blocks
- Prefer converting to `markdown` blocks where possible (inherently safe)
- Strip all `<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<base>`, `<form>` tags
- Strip all `on*` event handlers
- Validate all URLs (reject `javascript:` and `data:` schemes)
- Flag SCOs with heavy JavaScript for manual review in the import report

---

## Open Questions

### Q1: Where Does the Import Tool Live?

Options:
- **(A)** In `grafana-pathfinder-app` as a CLI tool (co-located with schema definitions)
- **(B)** In `interactive-tutorials` as a content pipeline tool (co-located with output)
- **(C)** In a new `pathfinder-scorm-import` repository

Recommendation: **(A)** — the tool depends heavily on the Zod schema for validation, and the schema lives in `grafana-pathfinder-app`. It can be a `scripts/` or `tools/` directory within the plugin repo.

### Q2: How to Handle Multi-Organization SCORM Packages?

A single SCORM package can contain multiple `<organization>` elements presenting the same content in different structures. Options:
- **(A)** Import only the default organization (simplest)
- **(B)** Import each organization as a separate package tree (most complete)
- **(C)** Let the user choose which organization to import via CLI flag

Recommendation: **(A)** by default, with **(C)** available as a flag.

### Q3: What Splitting Threshold?

When should a SCORM course become multiple Pathfinder guides vs. one guide with sections? The 5/20 thresholds in the pipeline description are initial guesses. This should be configurable and informed by real-world testing.

### Q4: How to Handle SCORM Packages from Different Authoring Tools?

SCORM packages from Articulate Storyline, Adobe Captivate, iSpring, Lectora, and other tools have vendor-specific quirks in their HTML structure, JavaScript patterns, and manifest formatting. The parser should be tested against packages from multiple authoring tools and handle common variations.

### Q5: Should the Import Tool Support xAPI / Tin Can?

xAPI (Experience API, also known as Tin Can) is the modern successor to SCORM's runtime API. It uses a different content packaging format (cmi5) and a different data model (statements). Supporting xAPI import would broaden the addressable market but is a separate effort. Worth considering for a future phase.

### Q6: Interaction Between Import and the Recommendation Engine

Imported SCORM content likely has no natural mapping to Grafana URL prefixes. Should the recommendation rules default to:
- **(A)** No recommendation rules (content is discoverable only through course navigation)
- **(B)** Broad rules based on SCORM metadata keywords (e.g., keyword "monitoring" → recommend on `/alerting` pages)
- **(C)** Manual rule authoring required post-import

Recommendation: **(A)** by default, with **(B)** as an optional flag. Non-Grafana content (like sales training) has no meaningful URL context.

---

## References

### SCORM Specifications
- [SCORM Content Packaging](https://scorm.com/scorm-explained/technical-scorm/content-packaging)
- [SCORM 2004 Manifest Structure](https://scorm.com/scorm-explained/technical-scorm/content-packaging/manifest-structure)
- [SCORM Run-Time Reference Guide](https://scorm.com/scorm-explained/technical-scorm/run-time/run-time-reference/)
- [SCORM 1.2 vs SCORM 2004 Comparison](https://scorm.com/scorm-explained/business-of-scorm/comparing-scorm-1-2-and-scorm-2004)
- [SCORM 2004 Sequencing Definition Model](https://scorm.com/scorm-explained/technical-scorm/sequencing/sequencing-definition-model)
- [SCORM 2004 4th Edition RTE Data Model](https://lms.technology/for/scorm/2004/4th_edition/standards/SCORM_2004_4ED_v1_1_RTE_20090814_files/part100.htm)

### Pathfinder Platform
- `context/assemblies/pathfinder.md` — Assembly architecture, flows, and glossary
- `context/repos/interactive-tutorials.md` — Guide repository context
- `context/repos/grafana-pathfinder-app.md` — Plugin context
- `repos/repos/interactive-tutorials/docs/json-guide-format.md` — Guide JSON format reference
- `repos/repos/interactive-tutorials/docs/interactive-types.md` — Block types reference
- `repos/repos/interactive-tutorials/docs/json-block-properties.md` — Block property reference
- `repos/repos/interactive-tutorials/docs/requirements-reference.md` — Requirements reference
- `repos/repos/grafana-pathfinder-app/src/types/json-guide.schema.ts` — Zod schema definitions
- `repos/repos/grafana-pathfinder-app/src/types/json-guide.types.ts` — TypeScript type definitions
- [Guide dependencies design](./guide-dependencies-design.md) — Debian dependency model for guides

### Related Standards
- [Dublin Core Metadata](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)
- [IEEE LOM (Learning Object Metadata)](https://standards.ieee.org/ieee/1484.12.1/7699/)
- [Debian Package Dependencies](https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html#depends)
- [xAPI / Tin Can / cmi5](https://xapi.com/)
- [QTI (Question and Test Interoperability)](https://www.imsglobal.org/spec/qti/v3p0/oview)

### Things to Follow Up On

- [Grafana documentation learning journey relationships](https://github.com/grafana/website/blob/master/content/docs/learning-journeys/journeys.yaml) -- this is how Jack defines dependencies between learning journeys
