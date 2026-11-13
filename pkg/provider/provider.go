package provider

import (
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"

	assignmentv1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/assignment/v1alpha1"
	completionrecordv1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/completionrecord/v1alpha1"
	interactiveguidev1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/interactiveguide/v1alpha1"
	"github.com/grafana/grafana-pathfinder-app/pkg/generated/manifestdata"
	pathfindersettingsv1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/pathfindersettings/v1alpha1"
)

// New returns the app.Provider that main.go hands to the app-sdk plugin runner.
func New() app.Provider {
	return simple.NewAppProvider(manifestdata.LocalManifest(), nil, newApp)
}

// newApp builds the app.App from the resolved config. Attach a Validator,
// Mutator, or Reconciler to a kind here as it is needed.
func newApp(cfg app.Config) (app.App, error) {
	return simple.NewApp(simple.AppConfig{
		Name:       "pathfinder-backend", // matches the name in manifest.cue
		KubeConfig: cfg.KubeConfig,
		ManagedKinds: []simple.AppManagedKind{
			{Kind: interactiveguidev1alpha1.Kind()},
			{Kind: completionrecordv1alpha1.Kind()},
			{Kind: pathfindersettingsv1alpha1.Kind()},
			{Kind: assignmentv1alpha1.Kind()},
		},
	})
}
