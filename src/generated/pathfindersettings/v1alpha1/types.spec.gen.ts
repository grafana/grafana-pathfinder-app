// Code generated - EDITING IS FUTILE. DO NOT EDIT.

export interface Spec {
	// pathfinderEnabled is the org opt-out; absence enables Pathfinder unless the remote kill switch is off.
	pathfinderEnabled?: boolean;
	// recommenderServiceUrl is the recommender API base URL. The client still
	// validates this against ALLOWED_RECOMMENDER_DOMAINS before use — an
	// arbitrary string here must not become an arbitrary fetch target.
	recommenderServiceUrl?: string;
	// tutorialUrl is an optional override for the bundled tutorial index.
	// Empty string means "use the built-in default".
	tutorialUrl?: string;
	// acceptedTermsAndConditions records acceptance or refusal of the
	// recommender terms. Absence uses the platform-specific client default.
	acceptedTermsAndConditions?: boolean;
	// termsVersion is the terms version that was accepted, so a new version can
	// re-prompt.
	termsVersion?: string;
	// enableAutoDetection turns on automatic detection of interactive elements.
	enableAutoDetection?: boolean;
	// requirementsCheckTimeout is the per-requirement check budget in
	// milliseconds. Bounded to keep a bad value from hanging a guide.
	requirementsCheckTimeout?: number;
	// guidedStepTimeout is the per-step budget in milliseconds.
	guidedStepTimeout?: number;
	// disableAutoCollapse stops sections collapsing as they complete.
	disableAutoCollapse?: boolean;
	// interceptGlobalDocsLinks routes Grafana docs links into the panel.
	// Experimental opt-in.
	interceptGlobalDocsLinks?: boolean;
	// openPanelOnLaunch opens the docs panel on page load. Experimental opt-in;
	// may be overridden by a feature toggle.
	openPanelOnLaunch?: boolean;
	// enableLiveSessions controls collaborative sessions.
	enableLiveSessions?: boolean;
	// peerjsHost is the PeerJS signalling host used by live sessions.
	peerjsHost?: string;
	// peerjsPort is the PeerJS signalling port. The exclusive upper bound
	// preserves the limit in generated OpenAPI; see AGENTS.md codegen notes.
	peerjsPort?: number;
	// peerjsKey is the PeerJS application key. Not a secret: PeerJS keys scope a
	// signalling namespace, they do not authenticate. Anything genuinely secret
	// belongs in secureJsonData, which this kind deliberately does not hold.
	peerjsKey?: string;
	// peerjsSecure selects wss/https for the signalling connection.
	peerjsSecure?: boolean;
	// enableCodaTerminal shows the Coda terminal UI. The VM backend and its
	// credentials live in the separate grafana-coda-app plugin, which owns its
	// own settings.
	enableCodaTerminal?: boolean;
	// enableAiAutoHeal allows the AI write path to repair guides:
	// this writes on the user's behalf and requires explicit admin opt-in.
	enableAiAutoHeal?: boolean;
	// enableTwoTabController enables the live-tab executor, which drives the
	// user's authenticated Grafana DOM and requires explicit admin opt-in.
	enableTwoTabController?: boolean;
	// devModeEnabled is the instance-level gate for developer surfaces. A user
	// sees dev features only when this is true AND that user has opted in via
	// their browser-local, user-scoped storage. Replaces the old jsonData pair
	// (`devMode` + `devModeUserIds`); the per-user half moved out of this
	// tenant-scoped resource entirely.
	devModeEnabled?: boolean;
	// enableAssistantDevMode mocks Grafana Assistant availability so the
	// integration can be exercised on OSS. Only meaningful when devModeEnabled
	// is true and the viewing user has opted in.
	enableAssistantDevMode?: boolean;
	// enableKioskMode enables the kiosk guide-catalogue presentation surface.
	enableKioskMode?: boolean;
	// kioskRulesUrl is an optional rules document for kiosk mode. Empty string
	// means "none".
	kioskRulesUrl?: string;
	// schemaVersion labels the spec format, separate from the CRD apiVersion.
	// Default 1 accepts sparse third-party creates that omit the version;
	// it does not prove the writer understood v1. No reader branches on it
	// today. Clients preserve it on updates; future migrations must not
	// use this default as evidence of explicit client version support.
	schemaVersion: number;
}

export const defaultSpec = (): Spec => ({
	schemaVersion: 1,
});

