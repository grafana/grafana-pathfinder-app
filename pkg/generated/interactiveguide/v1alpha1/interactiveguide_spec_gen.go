// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

// #Manifest carries package-repository metadata for grouping, sequencing, and
// (future) dependency-graph participation. Scoped intentionally: fields with no
// current consumer (recommender targeting, E2E test-environment routing) are
// left out until something in this app platform actually reads them.
// +k8s:openapi-gen=true
type Manifest struct {
	// type discriminates a standalone guide from an ordered group of guides.
	Type ManifestType `json:"type"`
	// repository identifies the provenance of this package.
	Repository string `json:"repository"`
	// description is a short human-readable summary shown in listings.
	Description *string `json:"description,omitempty"`
	// milestones is the ordered list of member package IDs for "path"/"journey" types.
	Milestones []string `json:"milestones,omitempty"`
	// tracks is a list of named, additional guide sequences alongside the
	// default sequence in milestones. See #Track. Meaningful only for
	// type: "path" (RFC §6.1) but not restricted to it at this schema
	// layer — see AGENTS.md's "#Track naming and scope".
	Tracks []Track `json:"tracks,omitempty"`
	// author identifies who owns this guide/path/journey.
	Author *Author `json:"author,omitempty"`
	// category is a free-form grouping label for browsing/filtering.
	Category *string `json:"category,omitempty"`
	// depends is a CNF (AND of ORs) list of package IDs this package depends on.
	Depends []DependencyClause `json:"depends,omitempty"`
	// stats is the guide's computed block statistics, stamped at build time.
	//
	// Optional with NO default: guides written before this field existed must
	// survive the addition and simply carry no stats until something saves them
	// again. Absent stats means "not measured"; it must never be forgeable into a
	// zero-valued measurement. When present, all five members are required — see
	// #GuideStats.
	Stats *GuideStats `json:"stats,omitempty"`
	// additionalFields is an escape hatch for manifest data not yet promoted to a
	// typed field above. #Manifest itself can't be made open-world — CUE's
	// pattern-constraint mechanism ([string]: _) only preserves unknown fields
	// (x-kubernetes-preserve-unknown-fields: true) when applied to a field's own
	// object type, not to the containing struct; applying it to #Manifest directly
	// silently widened other fields' types (e.g. `type` lost its enum) without
	// achieving passthrough. This mirrors grafana-app-sdk's own
	// SchemaWithOperatorState.status.additionalFields convention. Promoting a key
	// out of here into a real field on #Manifest is always additive and safe.
	AdditionalFields map[string]interface{} `json:"additionalFields,omitempty"`
}

// NewManifest creates a new Manifest object.
func NewManifest() *Manifest {
	return &Manifest{
		Repository: "app-platform",
	}
}

// OpenAPIModelName returns the OpenAPI model name for Manifest.
func (Manifest) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.Manifest"
}

// #Track is a named, independently-ordered guide sequence for a learning
// path — never a subset of milestones. See AGENTS.md's "#Track naming and scope".
// +k8s:openapi-gen=true
type Track struct {
	// trackId identifies this track within its manifest's tracks list.
	TrackId string `json:"trackId"`
	// label is the human-facing name for this track.
	Label string `json:"label"`
	// description is a short human-readable summary shown in listings.
	Description *string `json:"description,omitempty"`
	// guides is this track's own ordered list of member package IDs, same
	// shape as milestones. Non-empty per the RFC but unenforced here — see
	// AGENTS.md.
	Guides []string `json:"guides"`
}

// NewTrack creates a new Track object.
func NewTrack() *Track {
	return &Track{
		Guides: []string{},
	}
}

// OpenAPIModelName returns the OpenAPI model name for Track.
func (Track) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.Track"
}

// #Author identifies the person or team who owns a guide/path/journey.
// +k8s:openapi-gen=true
type Author struct {
	// name is the individual author's display name
	Name *string `json:"name,omitempty"`
	// team is the owning team name
	Team *string `json:"team,omitempty"`
}

// NewAuthor creates a new Author object.
func NewAuthor() *Author {
	return &Author{}
}

// OpenAPIModelName returns the OpenAPI model name for Author.
func (Author) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.Author"
}

// #DependencyClause is a single dependency clause: an OR-group of one or more
// alternative package IDs, following Debian's dependency syntax. A bare
// dependency is a singleton array (["some-id"]), not a bare string — the
// original `string | [...string]` disjunction rendered as
// `"type": ["string", "array"]` with `"oneOf": [{}, {}]` in the generated CRD
// schema, which is not valid Kubernetes JSONSchemaProps (type must be a single
// string) and would fail to apply.
// +k8s:openapi-gen=true
type DependencyClause []string

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
// +k8s:openapi-gen=true
type GuideStats struct {
	// version is the version of the stamped stats object. Bump it when the
	// COUNTING RULE changes, or when these fields change shape — the rule being
	// the load-bearing trigger, because a rule change leaves the shapes untouched
	// while restating the denominator of every already-stamped manifest and every
	// percentage already recorded against it.
	//
	// NOT a content version: it says nothing about whether the guide changed.
	// Not resourceVersion either — it has nothing to do with the stored object.
	Version int64 `json:"version"`
	// blockCount is the completion denominator: counted blocks, containers excluded.
	BlockCount int64 `json:"blockCount"`
	// sectionCount is the number of section containers. Authoring insight;
	// deliberately not in the denominator.
	SectionCount int64 `json:"sectionCount"`
	// completableBlockCount is the number of counted blocks carrying a completion
	// affordance.
	CompletableBlockCount int64 `json:"completableBlockCount"`
	// finalCompletablePosition is the position of the last completable block, 0
	// when there is none. Equal to blockCount when the final counted block is
	// completable, which is the signal that the guide needs no "Mark as complete"
	// button at its foot.
	FinalCompletablePosition int64 `json:"finalCompletablePosition"`
}

// NewGuideStats creates a new GuideStats object.
func NewGuideStats() *GuideStats {
	return &GuideStats{}
}

// OpenAPIModelName returns the OpenAPI model name for GuideStats.
func (GuideStats) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.GuideStats"
}

// #Block is the unified block schema using a "fat struct" pattern.
// The `type` field acts as a discriminator to determine which fields are relevant.
// This approach is compatible with Kubernetes CRD OpenAPI schema generation.
// +k8s:openapi-gen=true
type Block struct {
	// type is the block type discriminator (required)
	// Valid values: "markdown", "html", "image", "video", "interactive",
	// "multistep", "guided", "quiz", "input", "section", "collapsible",
	// "assistant", "conditional", "terminal", "terminal-connect",
	// "challenge", "code-block", "grot-guide", "snippet-ref"
	Type string `json:"type"`
	// === Common fields ===
	// content is used by markdown, html, interactive, multistep, guided,
	// terminal, terminal-connect and code-block blocks
	Content *string `json:"content,omitempty"`
	// requirements are conditions that must be met
	Requirements []string `json:"requirements,omitempty"`
	// objectives are learning objectives completed by this block
	Objectives []string `json:"objectives,omitempty"`
	// skippable indicates if the user can skip this block
	Skippable *bool `json:"skippable,omitempty"`
	// authorNote is an editor-only annotation. Accepted on every block type so
	// authoring tools can round-trip it; the editor strips it on export.
	AuthorNote *string `json:"authorNote,omitempty"`
	// === Assistant props (for markdown, interactive blocks) ===
	// assistantEnabled indicates if AI assistant is enabled for this block
	AssistantEnabled *bool `json:"assistantEnabled,omitempty"`
	// assistantId is the identifier for a specific assistant
	AssistantId *string `json:"assistantId,omitempty"`
	// assistantType specifies the type of assistant
	// Valid values: "query", "config", "code", "text"
	AssistantType *string `json:"assistantType,omitempty"`
	// === Image block fields ===
	// src is the URL of the image or video (http/https only)
	Src *string `json:"src,omitempty"`
	// alt is the alternative text for accessibility
	Alt *string `json:"alt,omitempty"`
	// width is the display width in pixels
	Width *float64 `json:"width,omitempty"`
	// height is the display height in pixels
	Height *float64 `json:"height,omitempty"`
	// === Video block fields ===
	// provider specifies the video provider
	// Valid values: "youtube", "native", "vimeo"
	Provider *string `json:"provider,omitempty"`
	// title is the video/section/challenge title
	Title *string `json:"title,omitempty"`
	// start is the playback start offset in seconds
	Start *float64 `json:"start,omitempty"`
	// end is the playback end offset in seconds
	End *float64 `json:"end,omitempty"`
	// === Interactive block fields ===
	// action is the type of interaction
	// Valid values: "highlight", "button", "formfill", "navigate", "hover", "noop", "popout"
	Action *string `json:"action,omitempty"`
	// reftarget is the CSS selector or element reference
	Reftarget *string `json:"reftarget,omitempty"`
	// targetvalue is the expected value for form inputs, or the popout target
	// ("sidebar" or "floating") for popout actions
	Targetvalue *string `json:"targetvalue,omitempty"`
	// targetstate is the desired end state for a toggle target, so the step
	// drives the control to that state instead of clicking it blindly.
	// Valid values: "true", "false", or "<attribute>:<value>".
	// String-only by contract: the app accepts a bare boolean when authoring and
	// coerces it before serializing, because a `bool | string` disjunction here
	// would render an unappliable CRD.
	Targetstate *string `json:"targetstate,omitempty"`
	// tooltip is text shown in a tooltip
	Tooltip *string `json:"tooltip,omitempty"`
	// hint provides guidance to the user
	Hint *string `json:"hint,omitempty"`
	// formHint provides guidance for form fill actions
	FormHint *string `json:"formHint,omitempty"`
	// validateInput indicates if input should be validated
	ValidateInput *bool `json:"validateInput,omitempty"`
	// showMe enables the "show me" feature
	ShowMe *bool `json:"showMe,omitempty"`
	// doIt enables the "do it for me" feature
	DoIt *bool `json:"doIt,omitempty"`
	// completeEarly allows completion before all steps are done
	CompleteEarly *bool `json:"completeEarly,omitempty"`
	// verify is a condition to verify completion
	Verify *string `json:"verify,omitempty"`
	// lazyRender indicates if the target element is lazily rendered
	LazyRender *bool `json:"lazyRender,omitempty"`
	// scrollContainer is the selector for the scrollable container
	ScrollContainer *string `json:"scrollContainer,omitempty"`
	// openGuide is the guide ID to open when this block completes
	OpenGuide *string `json:"openGuide,omitempty"`
	// === Multistep/Guided block fields ===
	// steps is the array of steps to complete
	Steps []Step `json:"steps,omitempty"`
	// stepTimeout is the timeout in ms before auto-advancing (guided blocks)
	StepTimeout *float64 `json:"stepTimeout,omitempty"`
	// === Quiz block fields ===
	// question is the quiz question text
	Question *string `json:"question,omitempty"`
	// choices is the array of possible answers
	Choices []QuizChoice `json:"choices,omitempty"`
	// multiSelect allows selecting multiple answers
	MultiSelect *bool `json:"multiSelect,omitempty"`
	// completionMode determines how completion is evaluated
	// Valid values: "correct-only", "max-attempts"
	CompletionMode *string `json:"completionMode,omitempty"`
	// maxAttempts limits the number of attempts
	MaxAttempts *float64 `json:"maxAttempts,omitempty"`
	// shuffle randomizes choice display order (defaults to true in the app);
	// pinned choices keep their authored index
	Shuffle *bool `json:"shuffle,omitempty"`
	// === Input block fields ===
	// prompt is the question or instruction for the user
	Prompt *string `json:"prompt,omitempty"`
	// inputType specifies the type of input control
	// Valid values: "text", "boolean", "datasource"
	InputType *string `json:"inputType,omitempty"`
	// variableName is the identifier for storing the response
	VariableName *string `json:"variableName,omitempty"`
	// placeholder is hint text shown in empty input
	Placeholder *string `json:"placeholder,omitempty"`
	// checkboxLabel is the label for boolean checkbox inputs
	CheckboxLabel *string `json:"checkboxLabel,omitempty"`
	// required indicates if input is mandatory
	Required *bool `json:"required,omitempty"`
	// pattern is a regex pattern for validation
	Pattern *string `json:"pattern,omitempty"`
	// validationMessage is shown when validation fails
	ValidationMessage *string `json:"validationMessage,omitempty"`
	// datasourceFilter narrows a datasource input to one type (e.g. "loki", "prometheus")
	DatasourceFilter *string `json:"datasourceFilter,omitempty"`
	// === Section block fields ===
	// id is an optional identifier for the block
	Id *string `json:"id,omitempty"`
	// autoCollapse collapses the section once the user completes its contents
	AutoCollapse *bool `json:"autoCollapse,omitempty"`
	// === Collapsible block fields ===
	// collapsed indicates the block starts collapsed
	Collapsed *bool `json:"collapsed,omitempty"`
	// === Conditional block fields ===
	// conditions are expressions to evaluate
	Conditions []string `json:"conditions,omitempty"`
	// description provides context about the conditional
	Description *string `json:"description,omitempty"`
	// display specifies how the conditional is rendered
	// Valid values: "inline", "section"
	Display *string `json:"display,omitempty"`
	// whenTrueSectionConfig configures the true branch as a section
	WhenTrueSectionConfig *ConditionalSectionConfig `json:"whenTrueSectionConfig,omitempty"`
	// whenFalseSectionConfig configures the false branch as a section
	WhenFalseSectionConfig *ConditionalSectionConfig `json:"whenFalseSectionConfig,omitempty"`
	// === Terminal block fields ===
	// command is the command to execute in the terminal
	Command *string `json:"command,omitempty"`
	// === Terminal-connect block fields ===
	// buttonText is the connect button label
	ButtonText *string `json:"buttonText,omitempty"`
	// vmTemplate is the VM template to provision
	VmTemplate *string `json:"vmTemplate,omitempty"`
	// vmApp is the app to launch in the VM
	VmApp *string `json:"vmApp,omitempty"`
	// vmScenario is the scenario to run in the VM
	VmScenario  *string                    `json:"vmScenario,omitempty"`
	Credentials []V1alpha1BlockCredentials `json:"credentials,omitempty"`
	// === Challenge block fields ===
	// mode is the challenge execution model
	// Valid values: "coda", "standard"
	Mode *string `json:"mode,omitempty"`
	// brief is the markdown problem statement
	Brief *string `json:"brief,omitempty"`
	// setupCommands are bash commands run server-side after the VM is ready
	// (deprecated in the app in favour of setupScript)
	SetupCommands []string `json:"setupCommands,omitempty"`
	// setupScript is a bash script run server-side after the VM is ready
	SetupScript *string `json:"setupScript,omitempty"`
	// successCriteria is the requirement evaluated when the user checks their work
	SuccessCriteria *string `json:"successCriteria,omitempty"`
	// hintLevels are progressive hints revealed on demand
	HintLevels []ChallengeHint `json:"hintLevels,omitempty"`
	// failureMessage is shown when the success check fails
	FailureMessage *string `json:"failureMessage,omitempty"`
	// === Code-block fields ===
	// language is the source language hint (e.g. promql, logql, sql)
	Language *string `json:"language,omitempty"`
	// code is the code inserted into the target editor
	Code *string `json:"code,omitempty"`
	// === Grot-guide block fields ===
	// welcome is the entry screen of the decision tree
	Welcome *GrotGuideWelcome `json:"welcome,omitempty"`
	// screens are the question and result screens of the decision tree
	Screens []GrotGuideScreen `json:"screens,omitempty"`
	// blocks contains nested blocks (for section/collapsible/assistant blocks)
	Blocks []NestedBlock `json:"blocks,omitempty"`
	// whenTrue contains blocks shown when conditions are true
	WhenTrue []NestedBlock `json:"whenTrue,omitempty"`
	// === Snippet-ref block fields ===
	// snippetId is the upstream snippet resolved at parse time
	SnippetId *string `json:"snippetId,omitempty"`
	// whenFalse contains blocks shown when conditions are false
	WhenFalse []NestedBlock `json:"whenFalse,omitempty"`
}

// NewBlock creates a new Block object.
func NewBlock() *Block {
	return &Block{}
}

// OpenAPIModelName returns the OpenAPI model name for Block.
func (Block) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.Block"
}

// #Step defines an individual step within multistep/guided blocks
// +k8s:openapi-gen=true
type Step struct {
	// id is a stable identifier for this step, used for cross-step references
	Id *string `json:"id,omitempty"`
	// action is the type of interaction for this step
	// Valid values: "highlight", "button", "formfill", "navigate", "hover", "noop", "popout"
	Action string `json:"action"`
	// reftarget is the CSS selector or element reference (required for non-noop actions)
	Reftarget *string `json:"reftarget,omitempty"`
	// targetvalue is the expected value for form inputs, or the popout target
	// ("sidebar" or "floating") for popout actions
	Targetvalue *string `json:"targetvalue,omitempty"`
	// targetstate is the desired end state for a toggle target. See the field of
	// the same name on #Block for the accepted values and why it is string-only.
	Targetstate *string `json:"targetstate,omitempty"`
	// requirements are conditions that must be met before this step is available
	Requirements []string `json:"requirements,omitempty"`
	// tooltip is text shown in a tooltip
	Tooltip *string `json:"tooltip,omitempty"`
	// description provides additional context for the step
	Description *string `json:"description,omitempty"`
	// skippable indicates if the user can skip this step
	Skippable *bool `json:"skippable,omitempty"`
	// formHint provides guidance for form fill actions
	FormHint *string `json:"formHint,omitempty"`
	// validateInput indicates if input should be validated against targetvalue
	ValidateInput *bool `json:"validateInput,omitempty"`
	// lazyRender indicates if the target element is lazily rendered
	LazyRender *bool `json:"lazyRender,omitempty"`
	// scrollContainer is the selector for the scrollable container
	ScrollContainer *string `json:"scrollContainer,omitempty"`
}

// NewStep creates a new Step object.
func NewStep() *Step {
	return &Step{}
}

// OpenAPIModelName returns the OpenAPI model name for Step.
func (Step) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.Step"
}

// #QuizChoice defines a single choice in a quiz
// +k8s:openapi-gen=true
type QuizChoice struct {
	// id is the unique identifier for the choice
	Id string `json:"id"`
	// text is the display text for the choice
	Text string `json:"text"`
	// correct indicates if this is a correct answer
	Correct *bool `json:"correct,omitempty"`
	// hint provides feedback when this choice is selected
	Hint *string `json:"hint,omitempty"`
	// pinned keeps this choice at its authored index when the quiz is shuffled
	Pinned *bool `json:"pinned,omitempty"`
}

// NewQuizChoice creates a new QuizChoice object.
func NewQuizChoice() *QuizChoice {
	return &QuizChoice{}
}

// OpenAPIModelName returns the OpenAPI model name for QuizChoice.
func (QuizChoice) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.QuizChoice"
}

// #ConditionalSectionConfig defines section configuration for conditional branches
// +k8s:openapi-gen=true
type ConditionalSectionConfig struct {
	// title is the section title for this branch
	Title *string `json:"title,omitempty"`
	// requirements are conditions for this branch
	Requirements []string `json:"requirements,omitempty"`
	// objectives are learning objectives for this branch
	Objectives []string `json:"objectives,omitempty"`
}

// NewConditionalSectionConfig creates a new ConditionalSectionConfig object.
func NewConditionalSectionConfig() *ConditionalSectionConfig {
	return &ConditionalSectionConfig{}
}

// OpenAPIModelName returns the OpenAPI model name for ConditionalSectionConfig.
func (ConditionalSectionConfig) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.ConditionalSectionConfig"
}

// #ChallengeHint is a single progressive hint revealed on demand during a challenge
// +k8s:openapi-gen=true
type ChallengeHint struct {
	// text is the hint body shown to the user
	Text string `json:"text"`
}

// NewChallengeHint creates a new ChallengeHint object.
func NewChallengeHint() *ChallengeHint {
	return &ChallengeHint{}
}

// OpenAPIModelName returns the OpenAPI model name for ChallengeHint.
func (ChallengeHint) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.ChallengeHint"
}

// #GrotGuideWelcome is the entry screen of a grot guide decision tree
// +k8s:openapi-gen=true
type GrotGuideWelcome struct {
	// title is the welcome heading
	Title string `json:"title"`
	// body is the welcome prose
	Body string `json:"body"`
	// ctas are the entry points into the decision tree
	Ctas []GrotGuideCta `json:"ctas"`
}

// NewGrotGuideWelcome creates a new GrotGuideWelcome object.
func NewGrotGuideWelcome() *GrotGuideWelcome {
	return &GrotGuideWelcome{
		Ctas: []GrotGuideCta{},
	}
}

// OpenAPIModelName returns the OpenAPI model name for GrotGuideWelcome.
func (GrotGuideWelcome) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.GrotGuideWelcome"
}

// #GrotGuideCta is a call-to-action button on the grot guide welcome screen
// +k8s:openapi-gen=true
type GrotGuideCta struct {
	// text is the button label
	Text string `json:"text"`
	// screenId is the screen this CTA navigates to
	ScreenId string `json:"screenId"`
}

// NewGrotGuideCta creates a new GrotGuideCta object.
func NewGrotGuideCta() *GrotGuideCta {
	return &GrotGuideCta{}
}

// OpenAPIModelName returns the OpenAPI model name for GrotGuideCta.
func (GrotGuideCta) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.GrotGuideCta"
}

// #GrotGuideScreen is a single screen in a grot guide decision tree.
// Like #Block, it uses a "fat struct" pattern: `type` discriminates between
// question screens (which carry `options`) and result screens (which carry
// `body` and `links`).
// +k8s:openapi-gen=true
type GrotGuideScreen struct {
	// type is the screen type discriminator
	// Valid values: "question", "result"
	Type string `json:"type"`
	// id is the screen identifier referenced by ctas and options
	Id string `json:"id"`
	// title is the screen heading
	Title string `json:"title"`
	// body is the result screen prose (result screens only)
	Body *string `json:"body,omitempty"`
	// options are the branches offered by a question screen (question screens only)
	Options []GrotGuideOption `json:"options,omitempty"`
	// links are related links shown on a result screen (result screens only)
	Links []GrotGuideLink `json:"links,omitempty"`
}

// NewGrotGuideScreen creates a new GrotGuideScreen object.
func NewGrotGuideScreen() *GrotGuideScreen {
	return &GrotGuideScreen{}
}

// OpenAPIModelName returns the OpenAPI model name for GrotGuideScreen.
func (GrotGuideScreen) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.GrotGuideScreen"
}

// #GrotGuideOption is a single branch from a grot guide question screen
// +k8s:openapi-gen=true
type GrotGuideOption struct {
	// text is the option label
	Text string `json:"text"`
	// screenId is the screen this option navigates to
	ScreenId string `json:"screenId"`
}

// NewGrotGuideOption creates a new GrotGuideOption object.
func NewGrotGuideOption() *GrotGuideOption {
	return &GrotGuideOption{}
}

// OpenAPIModelName returns the OpenAPI model name for GrotGuideOption.
func (GrotGuideOption) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.GrotGuideOption"
}

// #GrotGuideLink is a related link rendered on a grot guide result screen
// +k8s:openapi-gen=true
type GrotGuideLink struct {
	// type is an optional link category hint
	Type *string `json:"type,omitempty"`
	// title is the link heading
	Title string `json:"title"`
	// linkText is the visible anchor text
	LinkText string `json:"linkText"`
	// href is the link target (http/https only)
	Href string `json:"href"`
}

// NewGrotGuideLink creates a new GrotGuideLink object.
func NewGrotGuideLink() *GrotGuideLink {
	return &GrotGuideLink{}
}

// OpenAPIModelName returns the OpenAPI model name for GrotGuideLink.
func (GrotGuideLink) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.GrotGuideLink"
}

// #NestedBlock is used for blocks within section/collapsible/assistant/conditional
// blocks to avoid infinite recursion in the schema. It carries the same fields as
// #Block; only its own child arrays are left untyped, which the CRD generator
// renders as `x-kubernetes-preserve-unknown-fields` so deeper nesting is passed
// through rather than pruned.
// +k8s:openapi-gen=true
type NestedBlock struct {
	// type is the block type discriminator (required)
	// Valid values: "markdown", "html", "image", "video", "interactive",
	// "multistep", "guided", "quiz", "input", "section", "collapsible",
	// "assistant", "conditional", "terminal", "terminal-connect",
	// "challenge", "code-block", "grot-guide", "snippet-ref"
	Type string `json:"type"`
	// === Common fields ===
	// content is used by markdown, html, interactive, multistep, guided,
	// terminal, terminal-connect and code-block blocks
	Content *string `json:"content,omitempty"`
	// requirements are conditions that must be met
	Requirements []string `json:"requirements,omitempty"`
	// objectives are learning objectives completed by this block
	Objectives []string `json:"objectives,omitempty"`
	// skippable indicates if the user can skip this block
	Skippable *bool `json:"skippable,omitempty"`
	// authorNote is an editor-only annotation. Accepted on every block type so
	// authoring tools can round-trip it; the editor strips it on export.
	AuthorNote *string `json:"authorNote,omitempty"`
	// === Assistant props (for markdown, interactive blocks) ===
	// assistantEnabled indicates if AI assistant is enabled for this block
	AssistantEnabled *bool `json:"assistantEnabled,omitempty"`
	// assistantId is the identifier for a specific assistant
	AssistantId *string `json:"assistantId,omitempty"`
	// assistantType specifies the type of assistant
	// Valid values: "query", "config", "code", "text"
	AssistantType *string `json:"assistantType,omitempty"`
	// === Image block fields ===
	// src is the URL of the image or video (http/https only)
	Src *string `json:"src,omitempty"`
	// alt is the alternative text for accessibility
	Alt *string `json:"alt,omitempty"`
	// width is the display width in pixels
	Width *float64 `json:"width,omitempty"`
	// height is the display height in pixels
	Height *float64 `json:"height,omitempty"`
	// === Video block fields ===
	// provider specifies the video provider
	// Valid values: "youtube", "native", "vimeo"
	Provider *string `json:"provider,omitempty"`
	// title is the video/section/challenge title
	Title *string `json:"title,omitempty"`
	// start is the playback start offset in seconds
	Start *float64 `json:"start,omitempty"`
	// end is the playback end offset in seconds
	End *float64 `json:"end,omitempty"`
	// === Interactive block fields ===
	// action is the type of interaction
	// Valid values: "highlight", "button", "formfill", "navigate", "hover", "noop", "popout"
	Action *string `json:"action,omitempty"`
	// reftarget is the CSS selector or element reference
	Reftarget *string `json:"reftarget,omitempty"`
	// targetvalue is the expected value for form inputs, or the popout target
	// ("sidebar" or "floating") for popout actions
	Targetvalue *string `json:"targetvalue,omitempty"`
	// targetstate is the desired end state for a toggle target, so the step
	// drives the control to that state instead of clicking it blindly.
	// Valid values: "true", "false", or "<attribute>:<value>".
	// String-only by contract: the app accepts a bare boolean when authoring and
	// coerces it before serializing, because a `bool | string` disjunction here
	// would render an unappliable CRD.
	Targetstate *string `json:"targetstate,omitempty"`
	// tooltip is text shown in a tooltip
	Tooltip *string `json:"tooltip,omitempty"`
	// hint provides guidance to the user
	Hint *string `json:"hint,omitempty"`
	// formHint provides guidance for form fill actions
	FormHint *string `json:"formHint,omitempty"`
	// validateInput indicates if input should be validated
	ValidateInput *bool `json:"validateInput,omitempty"`
	// showMe enables the "show me" feature
	ShowMe *bool `json:"showMe,omitempty"`
	// doIt enables the "do it for me" feature
	DoIt *bool `json:"doIt,omitempty"`
	// completeEarly allows completion before all steps are done
	CompleteEarly *bool `json:"completeEarly,omitempty"`
	// verify is a condition to verify completion
	Verify *string `json:"verify,omitempty"`
	// lazyRender indicates if the target element is lazily rendered
	LazyRender *bool `json:"lazyRender,omitempty"`
	// scrollContainer is the selector for the scrollable container
	ScrollContainer *string `json:"scrollContainer,omitempty"`
	// openGuide is the guide ID to open when this block completes
	OpenGuide *string `json:"openGuide,omitempty"`
	// === Multistep/Guided block fields ===
	// steps is the array of steps to complete
	Steps []Step `json:"steps,omitempty"`
	// stepTimeout is the timeout in ms before auto-advancing (guided blocks)
	StepTimeout *float64 `json:"stepTimeout,omitempty"`
	// === Quiz block fields ===
	// question is the quiz question text
	Question *string `json:"question,omitempty"`
	// choices is the array of possible answers
	Choices []QuizChoice `json:"choices,omitempty"`
	// multiSelect allows selecting multiple answers
	MultiSelect *bool `json:"multiSelect,omitempty"`
	// completionMode determines how completion is evaluated
	// Valid values: "correct-only", "max-attempts"
	CompletionMode *string `json:"completionMode,omitempty"`
	// maxAttempts limits the number of attempts
	MaxAttempts *float64 `json:"maxAttempts,omitempty"`
	// shuffle randomizes choice display order (defaults to true in the app);
	// pinned choices keep their authored index
	Shuffle *bool `json:"shuffle,omitempty"`
	// === Input block fields ===
	// prompt is the question or instruction for the user
	Prompt *string `json:"prompt,omitempty"`
	// inputType specifies the type of input control
	// Valid values: "text", "boolean", "datasource"
	InputType *string `json:"inputType,omitempty"`
	// variableName is the identifier for storing the response
	VariableName *string `json:"variableName,omitempty"`
	// placeholder is hint text shown in empty input
	Placeholder *string `json:"placeholder,omitempty"`
	// checkboxLabel is the label for boolean checkbox inputs
	CheckboxLabel *string `json:"checkboxLabel,omitempty"`
	// required indicates if input is mandatory
	Required *bool `json:"required,omitempty"`
	// pattern is a regex pattern for validation
	Pattern *string `json:"pattern,omitempty"`
	// validationMessage is shown when validation fails
	ValidationMessage *string `json:"validationMessage,omitempty"`
	// datasourceFilter narrows a datasource input to one type (e.g. "loki", "prometheus")
	DatasourceFilter *string `json:"datasourceFilter,omitempty"`
	// === Section block fields ===
	// id is an optional identifier for the block
	Id *string `json:"id,omitempty"`
	// autoCollapse collapses the section once the user completes its contents
	AutoCollapse *bool `json:"autoCollapse,omitempty"`
	// === Collapsible block fields ===
	// collapsed indicates the block starts collapsed
	Collapsed *bool `json:"collapsed,omitempty"`
	// === Conditional block fields ===
	// conditions are expressions to evaluate
	Conditions []string `json:"conditions,omitempty"`
	// description provides context about the conditional
	Description *string `json:"description,omitempty"`
	// display specifies how the conditional is rendered
	// Valid values: "inline", "section"
	Display *string `json:"display,omitempty"`
	// whenTrueSectionConfig configures the true branch as a section
	WhenTrueSectionConfig *ConditionalSectionConfig `json:"whenTrueSectionConfig,omitempty"`
	// whenFalseSectionConfig configures the false branch as a section
	WhenFalseSectionConfig *ConditionalSectionConfig `json:"whenFalseSectionConfig,omitempty"`
	// === Terminal block fields ===
	// command is the command to execute in the terminal
	Command *string `json:"command,omitempty"`
	// === Terminal-connect block fields ===
	// buttonText is the connect button label
	ButtonText *string `json:"buttonText,omitempty"`
	// vmTemplate is the VM template to provision
	VmTemplate *string `json:"vmTemplate,omitempty"`
	// vmApp is the app to launch in the VM
	VmApp *string `json:"vmApp,omitempty"`
	// vmScenario is the scenario to run in the VM
	VmScenario  *string                          `json:"vmScenario,omitempty"`
	Credentials []V1alpha1NestedBlockCredentials `json:"credentials,omitempty"`
	// === Challenge block fields ===
	// mode is the challenge execution model
	// Valid values: "coda", "standard"
	Mode *string `json:"mode,omitempty"`
	// brief is the markdown problem statement
	Brief *string `json:"brief,omitempty"`
	// setupCommands are bash commands run server-side after the VM is ready
	// (deprecated in the app in favour of setupScript)
	SetupCommands []string `json:"setupCommands,omitempty"`
	// setupScript is a bash script run server-side after the VM is ready
	SetupScript *string `json:"setupScript,omitempty"`
	// successCriteria is the requirement evaluated when the user checks their work
	SuccessCriteria *string `json:"successCriteria,omitempty"`
	// hintLevels are progressive hints revealed on demand
	HintLevels []ChallengeHint `json:"hintLevels,omitempty"`
	// failureMessage is shown when the success check fails
	FailureMessage *string `json:"failureMessage,omitempty"`
	// === Code-block fields ===
	// language is the source language hint (e.g. promql, logql, sql)
	Language *string `json:"language,omitempty"`
	// code is the code inserted into the target editor
	Code *string `json:"code,omitempty"`
	// === Grot-guide block fields ===
	// welcome is the entry screen of the decision tree
	Welcome *GrotGuideWelcome `json:"welcome,omitempty"`
	// screens are the question and result screens of the decision tree
	Screens []GrotGuideScreen `json:"screens,omitempty"`
	// blocks contains nested blocks (for section/collapsible/assistant blocks)
	// Note: Uses recursive reference for nesting
	Blocks []interface{} `json:"blocks,omitempty"`
	// whenTrue contains blocks shown when conditions are true
	WhenTrue []interface{} `json:"whenTrue,omitempty"`
	// === Snippet-ref block fields ===
	// snippetId is the upstream snippet resolved at parse time
	SnippetId *string `json:"snippetId,omitempty"`
	// whenFalse contains blocks shown when conditions are false
	WhenFalse []interface{} `json:"whenFalse,omitempty"`
}

// NewNestedBlock creates a new NestedBlock object.
func NewNestedBlock() *NestedBlock {
	return &NestedBlock{}
}

// OpenAPIModelName returns the OpenAPI model name for NestedBlock.
func (NestedBlock) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.NestedBlock"
}

// +k8s:openapi-gen=true
type Spec struct {
	// schemaVersion is the version of the guide schema format
	SchemaVersion *string `json:"schemaVersion,omitempty"`
	// id is the unique identifier for the guide
	Id string `json:"id"`
	// title is the human-readable title of the guide
	Title string `json:"title"`
	// status is the publication status of the guide
	// Valid values: "draft", "published"
	Status *string `json:"status,omitempty"`
	// manifest carries package-repository metadata (grouping, sequencing,
	// dependencies) so this guide can participate as a package alongside
	// bundled and CDN content. Absent for legacy content-only guides.
	Manifest *Manifest `json:"manifest,omitempty"`
	// blocks is the array of content blocks that make up the guide
	Blocks []Block `json:"blocks"`
}

// NewSpec creates a new Spec object.
func NewSpec() *Spec {
	return &Spec{
		Blocks: []Block{},
	}
}

// OpenAPIModelName returns the OpenAPI model name for Spec.
func (Spec) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.Spec"
}

// +k8s:openapi-gen=true
type V1alpha1BlockCredentials struct {
	Tool string `json:"tool"`
}

// NewV1alpha1BlockCredentials creates a new V1alpha1BlockCredentials object.
func NewV1alpha1BlockCredentials() *V1alpha1BlockCredentials {
	return &V1alpha1BlockCredentials{}
}

// OpenAPIModelName returns the OpenAPI model name for V1alpha1BlockCredentials.
func (V1alpha1BlockCredentials) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.V1alpha1BlockCredentials"
}

// +k8s:openapi-gen=true
type V1alpha1NestedBlockCredentials struct {
	Tool string `json:"tool"`
}

// NewV1alpha1NestedBlockCredentials creates a new V1alpha1NestedBlockCredentials object.
func NewV1alpha1NestedBlockCredentials() *V1alpha1NestedBlockCredentials {
	return &V1alpha1NestedBlockCredentials{}
}

// OpenAPIModelName returns the OpenAPI model name for V1alpha1NestedBlockCredentials.
func (V1alpha1NestedBlockCredentials) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.V1alpha1NestedBlockCredentials"
}

// +k8s:openapi-gen=true
type ManifestType string

const (
	ManifestTypeGuide   ManifestType = "guide"
	ManifestTypePath    ManifestType = "path"
	ManifestTypeJourney ManifestType = "journey"
)

// OpenAPIModelName returns the OpenAPI model name for ManifestType.
func (ManifestType) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.interactiveguide.v1alpha1.ManifestType"
}
