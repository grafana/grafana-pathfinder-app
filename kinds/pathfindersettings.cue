package kinds

// pathfinderSettingsKind is the kind metadata for PathfinderSettings, reusable
// across versions.
//
// Why this kind exists
//
// Pathfinder's admin configuration used to live in the Grafana plugin settings
// record (`plugin_setting.json_data`, written via
// `POST /api/plugins/grafana-pathfinder-app/settings`). That single org-wide blob
// is also the target of Grafana Cloud plugin provisioning, and Grafana's write
// semantics are replace-not-merge (`pluginsettings.updatePluginSetting` assigns
// `JsonData` wholesale). Two independent writers on one mutable document with no
// field-level ownership produced a documented class of bug in both directions:
//
//   - the config page wiping the Cloud-provisioned `stackId`, which silently
//     disabled the OBO token exchanger and made private guides vanish
//     (grafana-pathfinder-app #1514);
//   - the provisioner re-asserting its own `jsonData` on every instance restart,
//     resetting the record to `{stackId}` and dropping every admin setting.
//
// Moving admin settings here gives them their own resource with their own RBAC,
// so provisioning cannot replace org overrides. OSS clients retain a legacy
// jsonData fallback until the kind is served.
pathfinderSettingsKind: {
	kind:       "PathfinderSettings"
	pluralName: "PathfinderSettings"
	scope:      "Namespaced"
	// folderScoped: false — settings are per-stack, not filed anywhere. This does
	// not tighten RBAC; it only drops folder access from the authz question,
	// leaving "access = has stack role" instead of "has stack role AND has folder
	// access". Matches InteractiveGuide and CompletionRecord.
	folderScoped: false
	codegen: {
		ts: {
			enabled: true
		}
		go: {
			enabled: true
		}
	}
}

// pathfindersettingsv1alpha1 is the v1alpha1 version of the PathfinderSettings kind.
//
// Singleton by convention: exactly one resource per namespace, named "default".
// The kind is Namespaced and App Platform namespaces are per-stack, so one
// resource per namespace == one settings row per stack. This mirrors the Grafana
// Assistant model of a single `tenant_settings` row per tenant. Nothing in the
// schema can enforce "only one"; the client always reads and writes the name
// "default"; resources with any other name are ignored by Pathfinder.
//
// Enforcement note (manifest-only deploy posture, see PR #64): in production this
// kind is served by a shared generic apiserver directly from the generated CRD
// schema. The hand-written Go handlers in pkg/plugin are NOT in the production
// request path. The CUE schema below is therefore the ONLY enforcement surface
// that ships, so every invariant we can express is pushed into it: value domains
// and bounds. Tenant defaults belong to the client and OpenFeature.
//
// Tenant fields are sparse overrides: absence follows client defaults and system
// feature flags rather than storing their evaluated values. An explicit false
// remains an override, including a recorded refusal of terms and conditions.
// PUT replaces the whole spec: clients must GET the current resource, preserve
// unmodified and unknown fields, overlay their changes, and send the read
// metadata.resourceVersion. On 409, re-read before deciding what to write; never
// retry with a fresh version attached to an old full spec.
//
// Deliberately excluded:
//   - stackId and secureJsonData.accessToken are provisioned by SSS in plugin
//     settings. Credentials must not enter this viewer-readable resource.
//   - devModeOptIn and legacy devModeUserIds are per-user state; the frontend
//     scopes opt-in to the browser, Grafana subpath, org, and user.
//   - evaluated runtime defaults and OpenFeature decisions are system-owned and
//     must not be copied into tenant overrides.
pathfindersettingsv1alpha1: pathfinderSettingsKind & {
	schema: {
		spec: {
			// pathfinderEnabled is the org opt-out; absence enables Pathfinder unless the remote kill switch is off.
			pathfinderEnabled?: bool

			// recommenderServiceUrl is the recommender API base URL. The client still
			// validates this against ALLOWED_RECOMMENDER_DOMAINS before use — an
			// arbitrary string here must not become an arbitrary fetch target.
			recommenderServiceUrl?: string
			// tutorialUrl is an optional override for the bundled tutorial index.
			// Empty string means "use the built-in default".
			tutorialUrl?: string

			// acceptedTermsAndConditions records acceptance or refusal of the
			// recommender terms. Absence uses the platform-specific client default.
			acceptedTermsAndConditions?: bool
			// termsVersion is the terms version that was accepted, so a new version can
			// re-prompt.
			termsVersion?: string

			// enableAutoDetection turns on automatic detection of interactive elements.
			enableAutoDetection?: bool
			// requirementsCheckTimeout is the per-requirement check budget in
			// milliseconds. Bounded to keep a bad value from hanging a guide.
			requirementsCheckTimeout?: int64 & >=100 & <=60000
			// guidedStepTimeout is the per-step budget in milliseconds.
			guidedStepTimeout?: int64 & >=1000 & <=600000
			// disableAutoCollapse stops sections collapsing as they complete.
			disableAutoCollapse?: bool

			// interceptGlobalDocsLinks routes Grafana docs links into the panel.
			// Experimental opt-in.
			interceptGlobalDocsLinks?: bool
			// openPanelOnLaunch opens the docs panel on page load. Experimental opt-in;
			// may be overridden by a feature toggle.
			openPanelOnLaunch?: bool

			// enableLiveSessions controls collaborative sessions.
			enableLiveSessions?: bool
			// peerjsHost is the PeerJS signalling host used by live sessions.
			peerjsHost?: string
			// peerjsPort is the PeerJS signalling port. The exclusive upper bound
			// preserves the limit in generated OpenAPI; see AGENTS.md codegen notes.
			peerjsPort?: int64 & >=1 & <65536
			// peerjsKey is the PeerJS application key. Not a secret: PeerJS keys scope a
			// signalling namespace, they do not authenticate. Anything genuinely secret
			// belongs in secureJsonData, which this kind deliberately does not hold.
			peerjsKey?: string
			// peerjsSecure selects wss/https for the signalling connection.
			peerjsSecure?: bool

			// enableCodaTerminal shows the Coda terminal UI. The VM backend and its
			// credentials live in the separate grafana-coda-app plugin, which owns its
			// own settings.
			enableCodaTerminal?: bool
			// enableAiAutoHeal allows the AI write path to repair guides:
			// this writes on the user's behalf and requires explicit admin opt-in.
			enableAiAutoHeal?: bool
			// enableTwoTabController enables the live-tab executor, which drives the
			// user's authenticated Grafana DOM and requires explicit admin opt-in.
			enableTwoTabController?: bool

			// devModeEnabled is the instance-level gate for developer surfaces. A user
			// sees dev features only when this is true AND that user has opted in via
			// their browser-local, user-scoped storage. Replaces the old jsonData pair
			// (`devMode` + `devModeUserIds`); the per-user half moved out of this
			// tenant-scoped resource entirely.
			devModeEnabled?: bool
			// enableAssistantDevMode mocks Grafana Assistant availability so the
			// integration can be exercised on OSS. Only meaningful when devModeEnabled
			// is true and the viewing user has opted in.
			enableAssistantDevMode?: bool
			// enableKioskMode enables the kiosk guide-catalogue presentation surface.
			enableKioskMode?: bool
			// kioskRulesUrl is an optional rules document for kiosk mode. Empty string
			// means "none".
			kioskRulesUrl?: string

			// schemaVersion labels the spec format, separate from the CRD apiVersion.
			// Default 1 accepts sparse third-party creates that omit the version;
			// it does not prove the writer understood v1. No reader branches on it
			// today. Clients preserve it on updates; future migrations must not
			// use this default as evidence of explicit client version support.
			schemaVersion: int & >=1 | *1
		}
	}
}
