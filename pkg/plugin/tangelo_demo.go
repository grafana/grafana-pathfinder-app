//go:build tangelodemo

package plugin

import (
	"context"
	"net/http"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Local demo build only (demo/tangelo/DEMO.md); never part of a release build.
//
// A local Docker Grafana serves no App Platform completion records, so the
// durable write cannot succeed there and the Tangelo webhook, which follows it,
// would never fire. This build swaps in an in-memory store for that write and
// lets jsonData.tangeloCompletionEndpoint redirect the webhook to a fake
// receiver.
func init() {
	tangeloEndpointOverrideAllowed = true
	completionCreatorOverride = &demoCompletionStore{seen: map[string]bool{}}
}

type demoCompletionStore struct {
	mu   sync.Mutex
	seen map[string]bool
}

func (s *demoCompletionStore) Create(_ context.Context, namespace string, obj completionRecordObject) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.seen[obj.Metadata.Name] {
		return &appPlatformUpstreamError{status: http.StatusConflict}
	}
	s.seen[obj.Metadata.Name] = true
	log.DefaultLogger.Info("demo completion store: record accepted",
		"namespace", namespace, "guideId", obj.Spec.GuideID, "name", obj.Metadata.Name)
	return nil
}
