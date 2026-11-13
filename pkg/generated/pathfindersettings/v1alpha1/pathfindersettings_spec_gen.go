// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

// +k8s:openapi-gen=true
type Spec struct {
	// pathfinderEnabled is the org opt-out; absence enables Pathfinder unless the remote kill switch is off.
	PathfinderEnabled *bool `json:"pathfinderEnabled,omitempty"`
	// recommenderServiceUrl is the recommender API base URL. The client still
	// validates this against ALLOWED_RECOMMENDER_DOMAINS before use — an
	// arbitrary string here must not become an arbitrary fetch target.
	RecommenderServiceUrl *string `json:"recommenderServiceUrl,omitempty"`
	// tutorialUrl is an optional override for the bundled tutorial index.
	// Empty string means "use the built-in default".
	TutorialUrl *string `json:"tutorialUrl,omitempty"`
	// acceptedTermsAndConditions records acceptance or refusal of the
	// recommender terms. Absence uses the platform-specific client default.
	AcceptedTermsAndConditions *bool `json:"acceptedTermsAndConditions,omitempty"`
	// termsVersion is the terms version that was accepted, so a new version can
	// re-prompt.
	TermsVersion *string `json:"termsVersion,omitempty"`
	// enableAutoDetection turns on automatic detection of interactive elements.
	EnableAutoDetection *bool `json:"enableAutoDetection,omitempty"`
	// requirementsCheckTimeout is the per-requirement check budget in
	// milliseconds. Bounded to keep a bad value from hanging a guide.
	RequirementsCheckTimeout *uint64 `json:"requirementsCheckTimeout,omitempty"`
	// guidedStepTimeout is the per-step budget in milliseconds.
	GuidedStepTimeout *uint64 `json:"guidedStepTimeout,omitempty"`
	// disableAutoCollapse stops sections collapsing as they complete.
	DisableAutoCollapse *bool `json:"disableAutoCollapse,omitempty"`
	// interceptGlobalDocsLinks routes Grafana docs links into the panel.
	// Experimental opt-in.
	InterceptGlobalDocsLinks *bool `json:"interceptGlobalDocsLinks,omitempty"`
	// openPanelOnLaunch opens the docs panel on page load. Experimental opt-in;
	// may be overridden by a feature toggle.
	OpenPanelOnLaunch *bool `json:"openPanelOnLaunch,omitempty"`
	// enableLiveSessions controls collaborative sessions.
	EnableLiveSessions *bool `json:"enableLiveSessions,omitempty"`
	// peerjsHost is the PeerJS signalling host used by live sessions.
	PeerjsHost *string `json:"peerjsHost,omitempty"`
	// peerjsPort is the PeerJS signalling port. The exclusive upper bound
	// preserves the limit in generated OpenAPI; see AGENTS.md codegen notes.
	PeerjsPort *uint64 `json:"peerjsPort,omitempty"`
	// peerjsKey is the PeerJS application key. Not a secret: PeerJS keys scope a
	// signalling namespace, they do not authenticate. Anything genuinely secret
	// belongs in secureJsonData, which this kind deliberately does not hold.
	PeerjsKey *string `json:"peerjsKey,omitempty"`
	// peerjsSecure selects wss/https for the signalling connection.
	PeerjsSecure *bool `json:"peerjsSecure,omitempty"`
	// enableCodaTerminal shows the Coda terminal UI. The VM backend and its
	// credentials live in the separate grafana-coda-app plugin, which owns its
	// own settings.
	EnableCodaTerminal *bool `json:"enableCodaTerminal,omitempty"`
	// enableAiAutoHeal allows the AI write path to repair guides:
	// this writes on the user's behalf and requires explicit admin opt-in.
	EnableAiAutoHeal *bool `json:"enableAiAutoHeal,omitempty"`
	// enableTwoTabController enables the live-tab executor, which drives the
	// user's authenticated Grafana DOM and requires explicit admin opt-in.
	EnableTwoTabController *bool `json:"enableTwoTabController,omitempty"`
	// devModeEnabled is the instance-level gate for developer surfaces. A user
	// sees dev features only when this is true AND that user has opted in via
	// their browser-local, user-scoped storage. Replaces the old jsonData pair
	// (`devMode` + `devModeUserIds`); the per-user half moved out of this
	// tenant-scoped resource entirely.
	DevModeEnabled *bool `json:"devModeEnabled,omitempty"`
	// enableAssistantDevMode mocks Grafana Assistant availability so the
	// integration can be exercised on OSS. Only meaningful when devModeEnabled
	// is true and the viewing user has opted in.
	EnableAssistantDevMode *bool `json:"enableAssistantDevMode,omitempty"`
	// enableKioskMode enables the kiosk guide-catalogue presentation surface.
	EnableKioskMode *bool `json:"enableKioskMode,omitempty"`
	// kioskRulesUrl is an optional rules document for kiosk mode. Empty string
	// means "none".
	KioskRulesUrl *string `json:"kioskRulesUrl,omitempty"`
	// schemaVersion labels the spec format, separate from the CRD apiVersion.
	// Default 1 accepts sparse third-party creates that omit the version;
	// it does not prove the writer understood v1. No reader branches on it
	// today. Clients preserve it on updates; future migrations must not
	// use this default as evidence of explicit client version support.
	SchemaVersion int64 `json:"schemaVersion"`
}

// NewSpec creates a new Spec object.
func NewSpec() *Spec {
	return &Spec{
		SchemaVersion: 1,
	}
}

// OpenAPIModelName returns the OpenAPI model name for Spec.
func (Spec) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.pathfindersettings.v1alpha1.Spec"
}
