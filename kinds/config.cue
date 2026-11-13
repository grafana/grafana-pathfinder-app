package kinds

// config holds the grafana-app-sdk code generation settings, read by
// `grafana-app-sdk generate` via the default `-c config` selector.
// Run it with `npm run generate:kinds`. Paths are relative to the project root.
config: {
	definitions: {
		manifestVersion: "v1alpha2"

		// The manifest tells Grafana which kinds and capabilities the app serves.
		// It is written into src/ so the frontend build copies it into dist/ as-is.
		manifestSchemas:  true
		path:             "src"
		manifestFileName: "app-sdk-manifest.json"
		encoding:         "json"
		// Per-CRD files are not used.
		genCRDs: false
	}

	kinds: {
		// Group generated Go packages by kind (pkg/generated/<kind>/<version>).
		grouping: "kind"
	}

	codegen: {
		goEnabled:                      true
		goGenPath:                      "pkg/generated/"
		enableK8sPostProcessing:        false
		enableOperatorStatusGeneration: true
	}
}
