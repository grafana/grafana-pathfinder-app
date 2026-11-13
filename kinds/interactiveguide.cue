package kinds

// This is our interactive guide kind metadata, which we can re-use for each version
// that contains our interactive guide kind, even if they have differing schemas.
interactiveGuideKind: {
	// Kind is the human-readable name which is used for generated type names.
	kind: "InteractiveGuide"
	// The human-readable plural form of the "name" field.
	pluralName: "InteractiveGuides"
	// Scope is the scope of the API server resource.
	// "Namespaced" kinds have resources which live in specific namespaces.
	scope: "Namespaced"
	// folderScoped: false — this kind is not folder-based. This does not tighten
	// RBAC; it only drops folder access from the authz question, leaving
	// "access = has stack role" instead of "has stack role AND has folder access".
	folderScoped: false
	// Codegen provides information to the codegen tooling about what sort of code you want generated.
}

// interactiveguidev1alpha1 is our version `v1alpha1` interactive guide kind.
// We use the interactiveGuideKind info, and add in the schema for the InteractiveGuide kind for this specific version.
interactiveguidev1alpha1: interactiveGuideKind & {
	schema: {
		spec: {
			// schemaVersion is the version of the guide schema format
			schemaVersion?: string
			// id is the unique identifier for the guide
			id: string
			// title is the human-readable title of the guide
			title: string
			// status is the publication status of the guide
			// Valid values: "draft", "published"
			status?: string
			// manifest carries package-repository metadata (grouping, sequencing,
			// dependencies) so this guide can participate as a package alongside
			// bundled and CDN content. Absent for legacy content-only guides.
			manifest?: #Manifest
			// blocks is the array of content blocks that make up the guide
			blocks: [...#Block]
		}
	}
}

// ============ MANIFEST SCHEMA ============

// #Author identifies the person or team who owns a guide/path/journey.
#Author: {
	// name is the individual author's display name
	name?: string
	// team is the owning team name
	team?: string
}

// #DependencyClause is a single dependency clause: an OR-group of one or more
// alternative package IDs, following Debian's dependency syntax. A bare
// dependency is a singleton array (["some-id"]), not a bare string — the
// original `string | [...string]` disjunction rendered as
// `"type": ["string", "array"]` with `"oneOf": [{}, {}]` in the generated CRD
// schema, which is not valid Kubernetes JSONSchemaProps (type must be a single
// string) and would fail to apply.
#DependencyClause: [...string]

// #GuideStats is the guide's computed block statistics, stamped onto the
// manifest at build time. It is the denominator for completion percentages,
// and the reason it lives here rather than in additionalFields is so a
// consumer holding a resolved manifest reads the same path whether the guide
// came from bundled/CDN content or from this app platform.
//
// Every member is REQUIRED and none carries a default. A defaulted count of 0
// is indistinguishable from a guide genuinely measured as having no blocks, so
// a partial or malformed stamp would be silently accepted as real data and go
// on to divide by it. Requiring all five means a partial stamp is rejected
// (422) instead. The whole object stays optional on #Manifest — see there.
//
// Mirrors the app's emitted shape (grafana-pathfinder-app,
// src/types/guide-stats.schema.ts / src/lib/guide-stats/summary.ts).
#GuideStats: {
	// version is the version of the stamped stats object. Bump it when the
	// COUNTING RULE changes, or when these fields change shape — the rule being
	// the load-bearing trigger, because a rule change leaves the shapes untouched
	// while restating the denominator of every already-stamped manifest and every
	// percentage already recorded against it.
	//
	// NOT a content version: it says nothing about whether the guide changed.
	// Not resourceVersion either — it has nothing to do with the stored object.
	version: int & >=0
	// blockCount is the completion denominator: counted blocks, containers excluded.
	blockCount: int & >=0
	// sectionCount is the number of section containers. Authoring insight;
	// deliberately not in the denominator.
	sectionCount: int & >=0
	// completableBlockCount is the number of counted blocks carrying a completion
	// affordance.
	completableBlockCount: int & >=0
	// finalCompletablePosition is the position of the last completable block, 0
	// when there is none. Equal to blockCount when the final counted block is
	// completable, which is the signal that the guide needs no "Mark as complete"
	// button at its foot.
	finalCompletablePosition: int & >=0
}

// #Track is a named, independently-ordered guide sequence for a learning
// path — never a subset of milestones. See AGENTS.md's "#Track naming and scope".
#Track: {
	// trackId identifies this track within its manifest's tracks list.
	trackId: string
	// label is the human-facing name for this track.
	label: string
	// description is a short human-readable summary shown in listings.
	description?: string
	// guides is this track's own ordered list of member package IDs, same
	// shape as milestones. Non-empty per the RFC but unenforced here — see
	// AGENTS.md.
	guides: [...string]
}

// #Manifest carries package-repository metadata for grouping, sequencing, and
// (future) dependency-graph participation. Scoped intentionally: fields with no
// current consumer (recommender targeting, E2E test-environment routing) are
// left out until something in this app platform actually reads them.
#Manifest: {
	// type discriminates a standalone guide from an ordered group of guides.
	type: "guide" | "path" | "journey"
	// repository identifies the provenance of this package.
	repository: string | *"app-platform"
	// description is a short human-readable summary shown in listings.
	description?: string
	// milestones is the ordered list of member package IDs for "path"/"journey" types.
	milestones?: [...string]
	// tracks is a list of named, additional guide sequences alongside the
	// default sequence in milestones. See #Track. Meaningful only for
	// type: "path" (RFC §6.1) but not restricted to it at this schema
	// layer — see AGENTS.md's "#Track naming and scope".
	tracks?: [...#Track]
	// author identifies who owns this guide/path/journey.
	author?: #Author
	// category is a free-form grouping label for browsing/filtering.
	category?: string
	// depends is a CNF (AND of ORs) list of package IDs this package depends on.
	depends?: [...#DependencyClause]
	// stats is the guide's computed block statistics, stamped at build time.
	//
	// Optional with NO default: guides written before this field existed must
	// survive the addition and simply carry no stats until something saves them
	// again. Absent stats means "not measured"; it must never be forgeable into a
	// zero-valued measurement. When present, all five members are required — see
	// #GuideStats.
	stats?: #GuideStats
	// additionalFields is an escape hatch for manifest data not yet promoted to a
	// typed field above. #Manifest itself can't be made open-world — CUE's
	// pattern-constraint mechanism ([string]: _) only preserves unknown fields
	// (x-kubernetes-preserve-unknown-fields: true) when applied to a field's own
	// object type, not to the containing struct; applying it to #Manifest directly
	// silently widened other fields' types (e.g. `type` lost its enum) without
	// achieving passthrough. This mirrors grafana-app-sdk's own
	// SchemaWithOperatorState.status.additionalFields convention. Promoting a key
	// out of here into a real field on #Manifest is always additive and safe.
	additionalFields?: {
		[string]: _
	}
}

// ============ QUIZ SCHEMAS ============

// #QuizChoice defines a single choice in a quiz
#QuizChoice: {
	// id is the unique identifier for the choice
	id: string
	// text is the display text for the choice
	text: string
	// correct indicates if this is a correct answer
	correct?: bool
	// hint provides feedback when this choice is selected
	hint?: string
	// pinned keeps this choice at its authored index when the quiz is shuffled
	pinned?: bool
}

// ============ STEP SCHEMA ============

// #Step defines an individual step within multistep/guided blocks
#Step: {
	// id is a stable identifier for this step, used for cross-step references
	id?: string
	// action is the type of interaction for this step
	// Valid values: "highlight", "button", "formfill", "navigate", "hover", "noop", "popout"
	action: string
	// reftarget is the CSS selector or element reference (required for non-noop actions)
	reftarget?: string
	// targetvalue is the expected value for form inputs, or the popout target
	// ("sidebar" or "floating") for popout actions
	targetvalue?: string
	// targetstate is the desired end state for a toggle target. See the field of
	// the same name on #Block for the accepted values and why it is string-only.
	targetstate?: string
	// requirements are conditions that must be met before this step is available
	requirements?: [...string]
	// tooltip is text shown in a tooltip
	tooltip?: string
	// description provides additional context for the step
	description?: string
	// skippable indicates if the user can skip this step
	skippable?: bool
	// formHint provides guidance for form fill actions
	formHint?: string
	// validateInput indicates if input should be validated against targetvalue
	validateInput?: bool
	// lazyRender indicates if the target element is lazily rendered
	lazyRender?: bool
	// scrollContainer is the selector for the scrollable container
	scrollContainer?: string
}

// ============ CONDITIONAL SECTION CONFIG ============

// #ConditionalSectionConfig defines section configuration for conditional branches
#ConditionalSectionConfig: {
	// title is the section title for this branch
	title?: string
	// requirements are conditions for this branch
	requirements?: [...string]
	// objectives are learning objectives for this branch
	objectives?: [...string]
}

// ============ CHALLENGE SCHEMAS ============

// #ChallengeHint is a single progressive hint revealed on demand during a challenge
#ChallengeHint: {
	// text is the hint body shown to the user
	text: string
}

// ============ GROT GUIDE SCHEMAS ============

// #GrotGuideCta is a call-to-action button on the grot guide welcome screen
#GrotGuideCta: {
	// text is the button label
	text: string
	// screenId is the screen this CTA navigates to
	screenId: string
}

// #GrotGuideWelcome is the entry screen of a grot guide decision tree
#GrotGuideWelcome: {
	// title is the welcome heading
	title: string
	// body is the welcome prose
	body: string
	// ctas are the entry points into the decision tree
	ctas: [...#GrotGuideCta]
}

// #GrotGuideOption is a single branch from a grot guide question screen
#GrotGuideOption: {
	// text is the option label
	text: string
	// screenId is the screen this option navigates to
	screenId: string
}

// #GrotGuideLink is a related link rendered on a grot guide result screen
#GrotGuideLink: {
	// type is an optional link category hint
	type?: string
	// title is the link heading
	title: string
	// linkText is the visible anchor text
	linkText: string
	// href is the link target (http/https only)
	href: string
}

// #GrotGuideScreen is a single screen in a grot guide decision tree.
// Like #Block, it uses a "fat struct" pattern: `type` discriminates between
// question screens (which carry `options`) and result screens (which carry
// `body` and `links`).
#GrotGuideScreen: {
	// type is the screen type discriminator
	// Valid values: "question", "result"
	type: string
	// id is the screen identifier referenced by ctas and options
	id: string
	// title is the screen heading
	title: string
	// body is the result screen prose (result screens only)
	body?: string
	// options are the branches offered by a question screen (question screens only)
	options?: [...#GrotGuideOption]
	// links are related links shown on a result screen (result screens only)
	links?: [...#GrotGuideLink]
}

// ============ BLOCK FIELDS (fat struct pattern) ============

// _blockFields holds every field shared by #Block and #NestedBlock.
//
// It is a hidden field, so it is never emitted as a schema of its own — it
// exists so the two block structs are composed from one field list instead of
// two hand-maintained copies. Keeping them in lockstep matters: a field present
// on one but not the other is silently pruned by the API server depending only
// on how deeply the block was nested, with no 422 and no warning.
//
// The `type` field acts as a discriminator to determine which fields are
// relevant. This "fat struct" approach is what makes the schema compatible with
// Kubernetes CRD OpenAPI generation, which has no discriminated unions.
//
// This field list is the backend mirror of the app's block schema
// (grafana-pathfinder-app/src/types/json-guide.schema.ts, `KNOWN_FIELDS`).
// A field the app accepts but this list omits is written with a 200 and then
// dropped, so the two must be kept in sync.
_blockFields: {
	// type is the block type discriminator (required)
	// Valid values: "markdown", "html", "image", "video", "interactive",
	// "multistep", "guided", "quiz", "input", "section", "collapsible",
	// "assistant", "conditional", "terminal", "terminal-connect",
	// "challenge", "code-block", "grot-guide", "snippet-ref"
	type: string

	// === Common fields ===
	// content is used by markdown, html, interactive, multistep, guided,
	// terminal, terminal-connect and code-block blocks
	content?: string
	// requirements are conditions that must be met
	requirements?: [...string]
	// objectives are learning objectives completed by this block
	objectives?: [...string]
	// skippable indicates if the user can skip this block
	skippable?: bool
	// authorNote is an editor-only annotation. Accepted on every block type so
	// authoring tools can round-trip it; the editor strips it on export.
	authorNote?: string

	// === Assistant props (for markdown, interactive blocks) ===
	// assistantEnabled indicates if AI assistant is enabled for this block
	assistantEnabled?: bool
	// assistantId is the identifier for a specific assistant
	assistantId?: string
	// assistantType specifies the type of assistant
	// Valid values: "query", "config", "code", "text"
	assistantType?: string

	// === Image block fields ===
	// src is the URL of the image or video (http/https only)
	src?: string
	// alt is the alternative text for accessibility
	alt?: string
	// width is the display width in pixels
	width?: number
	// height is the display height in pixels
	height?: number

	// === Video block fields ===
	// provider specifies the video provider
	// Valid values: "youtube", "native", "vimeo"
	provider?: string
	// title is the video/section/challenge title
	title?: string
	// start is the playback start offset in seconds
	start?: number
	// end is the playback end offset in seconds
	end?: number

	// === Interactive block fields ===
	// action is the type of interaction
	// Valid values: "highlight", "button", "formfill", "navigate", "hover", "noop", "popout"
	action?: string
	// reftarget is the CSS selector or element reference
	reftarget?: string
	// targetvalue is the expected value for form inputs, or the popout target
	// ("sidebar" or "floating") for popout actions
	targetvalue?: string
	// targetstate is the desired end state for a toggle target, so the step
	// drives the control to that state instead of clicking it blindly.
	// Valid values: "true", "false", or "<attribute>:<value>".
	// String-only by contract: the app accepts a bare boolean when authoring and
	// coerces it before serializing, because a `bool | string` disjunction here
	// would render an unappliable CRD.
	targetstate?: string
	// tooltip is text shown in a tooltip
	tooltip?: string
	// hint provides guidance to the user
	hint?: string
	// formHint provides guidance for form fill actions
	formHint?: string
	// validateInput indicates if input should be validated
	validateInput?: bool
	// showMe enables the "show me" feature
	showMe?: bool
	// doIt enables the "do it for me" feature
	doIt?: bool
	// completeEarly allows completion before all steps are done
	completeEarly?: bool
	// verify is a condition to verify completion
	verify?: string
	// lazyRender indicates if the target element is lazily rendered
	lazyRender?: bool
	// scrollContainer is the selector for the scrollable container
	scrollContainer?: string
	// openGuide is the guide ID to open when this block completes
	openGuide?: string

	// === Multistep/Guided block fields ===
	// steps is the array of steps to complete
	steps?: [...#Step]
	// stepTimeout is the timeout in ms before auto-advancing (guided blocks)
	stepTimeout?: number

	// === Quiz block fields ===
	// question is the quiz question text
	question?: string
	// choices is the array of possible answers
	choices?: [...#QuizChoice]
	// multiSelect allows selecting multiple answers
	multiSelect?: bool
	// completionMode determines how completion is evaluated
	// Valid values: "correct-only", "max-attempts"
	completionMode?: string
	// maxAttempts limits the number of attempts
	maxAttempts?: number
	// shuffle randomizes choice display order (defaults to true in the app);
	// pinned choices keep their authored index
	shuffle?: bool

	// === Input block fields ===
	// prompt is the question or instruction for the user
	prompt?: string
	// inputType specifies the type of input control
	// Valid values: "text", "boolean", "datasource"
	inputType?: string
	// variableName is the identifier for storing the response
	variableName?: string
	// placeholder is hint text shown in empty input
	placeholder?: string
	// checkboxLabel is the label for boolean checkbox inputs
	checkboxLabel?: string
	// required indicates if input is mandatory
	required?: bool
	// pattern is a regex pattern for validation
	pattern?: string
	// validationMessage is shown when validation fails
	validationMessage?: string
	// datasourceFilter narrows a datasource input to one type (e.g. "loki", "prometheus")
	datasourceFilter?: string

	// === Section block fields ===
	// id is an optional identifier for the block
	id?: string
	// autoCollapse collapses the section once the user completes its contents
	autoCollapse?: bool

	// === Collapsible block fields ===
	// collapsed indicates the block starts collapsed
	collapsed?: bool

	// === Conditional block fields ===
	// conditions are expressions to evaluate
	conditions?: [...string]
	// description provides context about the conditional
	description?: string
	// display specifies how the conditional is rendered
	// Valid values: "inline", "section"
	display?: string
	// whenTrueSectionConfig configures the true branch as a section
	whenTrueSectionConfig?: #ConditionalSectionConfig
	// whenFalseSectionConfig configures the false branch as a section
	whenFalseSectionConfig?: #ConditionalSectionConfig

	// === Terminal block fields ===
	// command is the command to execute in the terminal
	command?: string

	// === Terminal-connect block fields ===
	// buttonText is the connect button label
	buttonText?: string
	// vmTemplate is the VM template to provision
	vmTemplate?: string
	// vmApp is the app to launch in the VM
	vmApp?: string
	// vmScenario is the scenario to run in the VM
	vmScenario?: string
	credentials?: [...{
		tool: string & =~"^gcx$"
	}]

	// === Challenge block fields ===
	// mode is the challenge execution model
	// Valid values: "coda", "standard"
	mode?: string
	// brief is the markdown problem statement
	brief?: string
	// setupCommands are bash commands run server-side after the VM is ready
	// (deprecated in the app in favour of setupScript)
	setupCommands?: [...string]
	// setupScript is a bash script run server-side after the VM is ready
	setupScript?: string
	// successCriteria is the requirement evaluated when the user checks their work
	successCriteria?: string
	// hintLevels are progressive hints revealed on demand
	hintLevels?: [...#ChallengeHint]
	// failureMessage is shown when the success check fails
	failureMessage?: string

	// === Code-block fields ===
	// language is the source language hint (e.g. promql, logql, sql)
	language?: string
	// code is the code inserted into the target editor
	code?: string

	// === Grot-guide block fields ===
	// welcome is the entry screen of the decision tree
	welcome?: #GrotGuideWelcome
	// screens are the question and result screens of the decision tree
	screens?: [...#GrotGuideScreen]

	// === Snippet-ref block fields ===
	// snippetId is the upstream snippet resolved at parse time
	snippetId?: string
}

// ============ NESTED BLOCK (for recursive structures) ============

// #NestedBlock is used for blocks within section/collapsible/assistant/conditional
// blocks to avoid infinite recursion in the schema. It carries the same fields as
// #Block; only its own child arrays are left untyped, which the CRD generator
// renders as `x-kubernetes-preserve-unknown-fields` so deeper nesting is passed
// through rather than pruned.
#NestedBlock: _blockFields & {
	// blocks contains nested blocks (for section/collapsible/assistant blocks)
	// Note: Uses recursive reference for nesting
	blocks?: [...]
	// whenTrue contains blocks shown when conditions are true
	whenTrue?: [...]
	// whenFalse contains blocks shown when conditions are false
	whenFalse?: [...]
}

// ============ BLOCK (fat struct pattern) ============

// #Block is the unified block schema using a "fat struct" pattern.
// The `type` field acts as a discriminator to determine which fields are relevant.
// This approach is compatible with Kubernetes CRD OpenAPI schema generation.
#Block: _blockFields & {
	// blocks contains nested blocks (for section/collapsible/assistant blocks)
	blocks?: [...#NestedBlock]
	// whenTrue contains blocks shown when conditions are true
	whenTrue?: [...#NestedBlock]
	// whenFalse contains blocks shown when conditions are false
	whenFalse?: [...#NestedBlock]
}
