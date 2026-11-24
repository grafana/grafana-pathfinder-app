package services

import (
	"context"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"reflect"
	"testing"
)

func TestBundledCatalogueResolvesOSSAndCloudAssignments(t *testing.T) {
	source := BundledPathGuides(log.DefaultLogger, LoadLocalCatalogue, func(context.Context, string) ([]string, error) {
		t.Fatal("inline path required network")
		return nil, nil
	})
	for id, want := range map[string][]string{
		"getting-started":       {"welcome-to-grafana", "prometheus-grafana-101", "first-dashboard"},
		"cloud-getting-started": {"first-dashboard-cloud"},
	} {
		got, found, err := source(context.Background(), id, "", "bundled")
		if err != nil || !found || !reflect.DeepEqual(got, GuideIdentities(want, "bundled")) {
			t.Fatalf("%s: %v %v %v", id, got, found, err)
		}
	}
}
