package kinds

// manifest defines the app manifest for pathfinder-backend.
manifest: {
	// appName is the unique name of your app. It is used to reference the app from other config objects,
	// and to generate the group used by your app in the app platform API.
	appName: "pathfinder-backend"
	// appDisplayName is the human-readable name shown to users (e.g. in the role
	// picker). Unlike appName it can contain any printable characters; it defaults
	// to appName, which is not presentable.
	appDisplayName: "Pathfinder"
	// groupOverride can be used to specify a non-appName-based API group.
	// By default, an app's API group is LOWER(REPLACE(appName, '-', '')).ext.grafana.com,
	// but there are cases where this needs to be changed.
	// Keep in mind that changing this after an app is deployed can cause problems with clients and/or kind data.
	groupOverride: "pathfinderbackend.ext.grafana.app"

	// roles defines custom RBAC roles provisioned to every stack. Each role is
	// single-purpose; Basic-role inheritance (admin ⊃ editor ⊃ viewer) means each
	// binding below only declares its delta. title/description are user-visible.
	roles: {
		"pathfinder-backend:reader": {
			title:       "Pathfinder Reader"
			description: "Read interactive guides"
			kinds: [{kind: "InteractiveGuide", permissionSet: "viewer"}]
		}
		"pathfinder-backend:completion-writer": {
			title:       "Pathfinder Completion Writer"
			description: "Record guide completions"
			kinds: [{kind: "CompletionRecord", permissionSet: "editor"}]
		}
		"pathfinder-backend:guide-editor": {
			title:       "Pathfinder Guide Editor"
			description: "Author interactive guides"
			kinds: [{kind: "InteractiveGuide", permissionSet: "editor"}]
		}
		"pathfinder-backend:settings-reader": {
			title:       "Pathfinder Settings Reader"
			description: "Read Interactive learning configuration"
			kinds: [{kind: "PathfinderSettings", permissionSet: "viewer"}]
		}
		"pathfinder-backend:settings-editor": {
			title:       "Pathfinder Settings Editor"
			description: "Change Interactive learning configuration"
			kinds: [{kind: "PathfinderSettings", permissionSet: "editor"}]
		}
		"pathfinder-backend:assignment-reader": {
			title:       "Pathfinder Assignment Reader"
			description: "Read assignments"
			kinds: [{kind: "Assignment", permissionSet: "viewer"}]
		}
		// editor grants delete on Assignment, which is more than intended —
		// an Assignment must never be deleted, only withdrawn. That
		// invariant is awaiting more granular scoping in app-platform
		"pathfinder-backend:assignment-writer": {
			title:       "Pathfinder Assignment Writer"
			description: "Create and update assignments"
			kinds: [{kind: "Assignment", permissionSet: "editor"}]
		}
	}
	// roleBindings binds the roles above to Basic groups. Effective grants:
	// viewer → read InteractiveGuide + read/write CompletionRecord
	// + read PathfinderSettings + read/write Assignment;
	// editor → inherits viewer + write InteractiveGuide;
	// admin → inherits editor + write PathfinderSettings.
	//
	// Settings are admin-only to write: unlike guides, they change behaviour for
	// every user on the stack, so `settings-editor` binds to admin rather than
	// editor. Read binds at viewer because every surface in the plugin must
	// resolve configuration before it can render.
	roleBindings: {
		viewer: ["pathfinder-backend:reader", "pathfinder-backend:completion-writer", "pathfinder-backend:settings-reader", "pathfinder-backend:assignment-writer"]
		editor: ["pathfinder-backend:guide-editor"]
		admin: ["pathfinder-backend:settings-editor"]
	}

	// versions is a map of versions supported by your app. Version names should follow the format "v<integer>" or
	// "v<integer>(alpha|beta)<integer>". Each version contains the kinds your app manages for that version.
	// If your app needs access to kinds managed by another app, use permissions.accessKinds to allow your app access.
	versions: {
	    "v1alpha1": v1alpha1
	}
	// extraPermissions contains any additional permissions your app may require to function.
	// Your app will always have all permissions for each kind it manages (the items defined in 'kinds').
	extraPermissions: {
		// If your app needs access to additional kinds supplied by other apps, you can list them here
		accessKinds: [
			// Here is an example for your app accessing the playlist kind for reads and watch
			// {
			//	group: "playlist.grafana.app"
			//	resource: "playlists"
			//	actions: ["get","list","watch"]
			// }
		]
	}
}

// v1alpha1 is the v1alpha1 version of the app's API.
// It includes kinds which the v1alpha1 API serves, and (future) custom routes served globally from the v1alpha1 version.
v1alpha1: {
    // kinds is the list of kinds served by this version
    kinds: [interactiveguidev1alpha1, completionrecordv1alpha1, pathfindersettingsv1alpha1, assignmentv1alpha1]
    // [OPTIONAL]
    // served indicates whether this particular version is served by the API server.
    // served should be set to false before a version is removed from the manifest entirely.
    // served defaults to true if not present.
    served: true
    // [OPTIONAL]
    // Codegen is a trait that tells the grafana-app-sdk, or other code generation tooling, how to process this kind.
    // If not present, default values within the codegen trait are used.
    // If you wish to specify codegen per-version, put this section in the version's object
    // (for example, <no value>v1alpha1) instead.
    codegen: {
        // [OPTIONAL]
        // ts contains TypeScript code generation properties for the kind
        ts: {
            // [OPTIONAL]
            // enabled indicates whether the CLI should generate front-end TypeScript code for the kind.
            // Defaults to true if not present.
            enabled: false
        }
        // [OPTIONAL]
        // go contains go code generation properties for the kind
        go: {
            // [OPTIONAL]
            // enabled indicates whether the CLI should generate back-end go code for the kind.
            // Defaults to true if not present.
            enabled: true
        }
    }
}