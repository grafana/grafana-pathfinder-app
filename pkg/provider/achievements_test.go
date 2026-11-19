package provider

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

type testAchievementDefinitions struct{ snapshot *achievements.Snapshot }

func (d testAchievementDefinitions) Snapshot(context.Context) (*achievements.Snapshot, time.Duration) {
	return d.snapshot, 1500 * time.Millisecond
}
func achievementDefinitionsForTest(t *testing.T) testAchievementDefinitions {
	t.Helper()
	body, err := os.ReadFile("../achievements/testdata/bundle.json")
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := achievements.LoadBundle(body)
	if err != nil {
		t.Fatal(err)
	}
	return testAchievementDefinitions{snapshot: snapshot}
}
func achievementRequest(t *testing.T, op, subject, identityNS, routeNS, body string, defs AchievementDefinitions) *httptest.ResponseRecorder {
	t.Helper()
	ctx := context.Background()
	if subject != "" {
		ctx = authlib.WithAuthInfo(ctx, writerIdentity{completionIdentity{testIdentity: testIdentity{namespace: identityNS}, subject: subject}})
	}
	method := http.MethodGet
	if op == "events" {
		method = http.MethodPost
	}
	response := httptest.NewRecorder()
	err := achievementHandler(nil, defs, op)(ctx, response, &app.CustomRouteRequest{Method: method, Body: io.NopCloser(strings.NewReader(body)), ResourceIdentifier: resource.FullIdentifier{Namespace: routeNS}})
	if err != nil {
		t.Fatal(err)
	}
	return response
}
func TestAchievementRoutesRejectUntrustedPeopleBeforeResourceAccess(t *testing.T) {
	defs := achievementDefinitionsForTest(t)
	for _, tc := range []struct {
		name, subject, namespace string
		status                   int
	}{
		{"missing", "", "default", 401}, {"sibling", "user:1", "org-2", 403}, {"service", "service-account:1", "default", 403},
	} {
		for _, op := range []string{"events", "definitions", "my"} {
			t.Run(tc.name+op, func(t *testing.T) {
				response := achievementRequest(t, op, tc.subject, tc.namespace, "default", "{}", defs)
				want := tc.status
				if op == "my" {
					want = 200
					if !strings.Contains(response.Body.String(), `"available":false`) {
						t.Fatalf("exposed data: %s", response.Body.String())
					}
				}
				if response.Code != want {
					t.Fatalf("status %d: %s", response.Code, response.Body.String())
				}
			})
		}
	}
}
func TestAchievementDefinitionsColdStartAndEventValidation(t *testing.T) {
	for _, op := range []string{"events", "definitions", "my"} {
		response := achievementRequest(t, op, "user:1", "default", "default", "{}", testAchievementDefinitions{})
		if response.Code != 503 || response.Header().Get("Retry-After") != "2" {
			t.Fatalf("%s: %d %s", op, response.Code, response.Body.String())
		}
	}
	defs := achievementDefinitionsForTest(t)
	for _, body := range []string{"", "{} {}", strings.Repeat(" ", 4097) + "{}", `{"schemaVersion":1,"eventId":"test","entity":"unregistered","action":"done"}`} {
		response := achievementRequest(t, "events", "user:1", "default", "default", body, defs)
		if response.Code != 400 {
			t.Fatalf("status %d: %s", response.Code, response.Body.String())
		}
	}
	response := achievementRequest(t, "definitions", "user:1", "default", "default", "", defs)
	if response.Code != 200 || !strings.Contains(response.Body.String(), defs.snapshot.Version) {
		t.Fatalf("definitions: %d %s", response.Code, response.Body.String())
	}
}
func TestAchievementLimiterIsolatesNamespacesAndPeople(t *testing.T) {
	defs := achievementDefinitionsForTest(t)
	defs.snapshot.Catalog = &achievements.Catalog{}
	handler := achievementHandler(nil, defs, "events")
	// A valid event with no selected achievement never accesses persistence.
	body := fmt.Sprintf(`{"schemaVersion":1,"eventId":"event","entity":"guides","action":"completed","occurredAt":%q,"context":{"guideSource":"bundled","guideId":"one","guideCategory":"documentation"}}`, time.Now().UTC().Format(time.RFC3339))
	for _, tc := range []struct {
		ns, user    string
		count, want int
	}{{"default", "user:1", 30, 200}, {"default", "user:1", 1, 429}, {"org-2", "user:1", 1, 200}, {"default", "user:2", 1, 200}} {
		for i := 0; i < tc.count; i++ {
			ctx := authlib.WithAuthInfo(context.Background(), writerIdentity{completionIdentity{testIdentity: testIdentity{namespace: tc.ns}, subject: tc.user}})
			response := httptest.NewRecorder()
			err := handler(ctx, response, &app.CustomRouteRequest{Method: http.MethodPost, Body: io.NopCloser(strings.NewReader(body)), ResourceIdentifier: resource.FullIdentifier{Namespace: tc.ns}})
			if err != nil || response.Code != tc.want {
				t.Fatalf("%s %s: %d %s %v", tc.ns, tc.user, response.Code, response.Body.String(), err)
			}
		}
	}
}

func TestAchievementWrongMethodPreservesResponse(t *testing.T) {
	response := httptest.NewRecorder()
	err := achievementHandler(nil, nil, "events")(context.Background(), response, &app.CustomRouteRequest{Method: http.MethodGet})
	if err != nil || response.Code != 405 || response.Body.String() != "Method not allowed\n" {
		t.Fatalf("status=%d body=%s err=%v", response.Code, response.Body.String(), err)
	}
}
