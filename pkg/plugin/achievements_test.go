package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
	"github.com/grafana/grafana-plugin-sdk-go/experimental/featuretoggles"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

const achievementsTestBundleJSON = `{"grammar":"1.0","registry":{"entities":{
  "dashboards":{"actions":{"created":{
    "context":{"resourceId":{"type":"string"},"numPanels":{"type":"number"}},
    "resources":[{"unit":"dashboard","id":["resourceId"]}]}}},
  "guides":{"actions":{"completed":{
    "context":{"guideSource":{"type":"string"},"guideId":{"type":"string"},
               "guideCategory":{"type":"string","enum":["interactive","documentation","learning-journey"]}},
    "resources":[{"unit":"guide","id":["guideSource","guideId"]}]}}},
  "search":{"actions":{"performed":{"context":{}}}}
}},"catalog":{"achievements":[
  {"id":"dash-builder","title":"Dashboard builder","description":"Create dashboards.",
   "counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
   "tiers":[{"id":"bronze","at":1},{"id":"silver","at":3},{"id":"gold","at":5}]},
  {"id":"guide-routes","title":"Guide routes","description":"Finish the named guide.",
   "tiers":[{"id":"intro","or":[{"entity":"guides","action":"completed","where":[{"field":"guideId","op":"eq","value":"intro"}]}]}]}
]}}`

const achievementsTestUser = "user:1"

// memAchievements is an in-memory Store and Reader, keyed by person.
type memAchievements struct {
	mu       sync.Mutex
	progress map[string]achievements.Progress
	awards   map[string]achievements.Award
	version  int

	loadErr, listErr error
	truncated        bool
}

func newMemAchievements() *memAchievements {
	return &memAchievements{progress: map[string]achievements.Progress{}, awards: map[string]achievements.Award{}}
}

func (m *memAchievements) put(p achievements.Person, row achievements.Progress) achievements.Progress {
	m.version++
	row.Version = strconv.Itoa(m.version)
	m.progress[p.ID+"/"+row.AchievementID] = row
	return row
}

func (m *memAchievements) LoadProgress(_ context.Context, p achievements.Person, ids []string) (map[string]achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.loadErr != nil {
		return nil, m.loadErr
	}
	out := map[string]achievements.Progress{}
	for _, id := range ids {
		if row, ok := m.progress[p.ID+"/"+id]; ok {
			out[id] = row
		}
	}
	return out, nil
}

func (m *memAchievements) CreateProgress(_ context.Context, p achievements.Person, row achievements.Progress) (achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.progress[p.ID+"/"+row.AchievementID]; ok {
		return achievements.Progress{}, achievements.ErrExists
	}
	return m.put(p, row), nil
}

func (m *memAchievements) SaveProgress(_ context.Context, p achievements.Person, row achievements.Progress) (achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.progress[p.ID+"/"+row.AchievementID].Version != row.Version {
		return achievements.Progress{}, achievements.ErrConflict
	}
	return m.put(p, row), nil
}

func (m *memAchievements) CreateAward(_ context.Context, p achievements.Person, a achievements.Award) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := p.ID + "/" + a.AchievementID + "/" + a.TierID
	if _, ok := m.awards[key]; ok {
		return achievements.ErrExists
	}
	m.awards[key] = a
	return nil
}

func (m *memAchievements) ListMine(_ context.Context, p achievements.Person) (achievements.Rows, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.listErr != nil {
		return achievements.Rows{}, m.listErr
	}
	rows := achievements.Rows{AsOf: timeNow(), Truncated: m.truncated}
	for key, a := range m.awards {
		if strings.HasPrefix(key, p.ID+"/") {
			rows.Awards = append(rows.Awards, a)
		}
	}
	for key, row := range m.progress {
		if strings.HasPrefix(key, p.ID+"/") {
			rows.Progress = append(rows.Progress, row)
		}
	}
	return rows, nil
}

func (m *memAchievements) rowsFor(user string) (awards, progress int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key := range m.awards {
		if strings.HasPrefix(key, user+"/") {
			awards++
		}
	}
	for key := range m.progress {
		if strings.HasPrefix(key, user+"/") {
			progress++
		}
	}
	return awards, progress
}

func newAchievementsTestApp(t *testing.T, mem *memAchievements) *App {
	t.Helper()
	app := newTestAppWithOBO(t)
	app.definitions = staticDefinitions{snap: loadAchievementsTestBundle(t, achievementsTestBundleJSON)}
	app.achievementEventsRateLimiter = newUserRateLimiter(achievementEventsRateBurst, achievementEventsRateRefillPerSec)
	if mem != nil {
		app.achievementsBackendFor = func(*http.Request, achievements.Person, *achievements.Catalog) (achievementsBackend, string) {
			return achievementsBackend{store: mem, reader: mem}, ""
		}
	}
	return app
}

type staticDefinitions struct {
	snap       *achievements.Snapshot
	retryAfter time.Duration
}

func (s staticDefinitions) Snapshot(context.Context) (*achievements.Snapshot, time.Duration) {
	return s.snap, s.retryAfter
}

func loadAchievementsTestBundle(t *testing.T, data string) *achievements.Snapshot {
	t.Helper()
	snap, err := achievements.LoadBundle([]byte(data))
	if err != nil {
		t.Fatalf("bundle: %v", err)
	}
	if len(snap.Skipped) != 0 {
		t.Fatalf("bundle skipped %+v", snap.Skipped)
	}
	return snap
}

func achievementRequest(t *testing.T, method, target, sub, body string) *http.Request {
	t.Helper()
	r := completionRequest(t, target, sub)
	r.Method = method
	r.Body = io.NopCloser(strings.NewReader(body))
	return r
}

func dashboardEventBody(eventID, resourceID string) string {
	return fmt.Sprintf(`{"schemaVersion":1,"eventId":%q,"entity":"dashboards","action":"created","occurredAt":%q,"context":{"resourceId":%q,"numPanels":2}}`,
		eventID, timeNow().UTC().Format(time.RFC3339), resourceID)
}

func postAchievementEvent(t *testing.T, app *App, sub, body string) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	app.handleAchievementEvent(rr, achievementRequest(t, http.MethodPost, achievementsRoutePrefix+"/events", sub, body))
	return rr
}

func getMyAchievements(t *testing.T, app *App, sub string) (*httptest.ResponseRecorder, myAchievementsResponse) {
	t.Helper()
	rr := httptest.NewRecorder()
	app.handleMyAchievements(rr, achievementRequest(t, http.MethodGet, achievementsRoutePrefix+"/my", sub, ""))
	var body myAchievementsResponse
	if rr.Body.Len() > 0 {
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v (raw: %s)", err, rr.Body.String())
		}
	}
	return rr, body
}

func decodeEvents(t *testing.T, rr *httptest.ResponseRecorder) achievementEventsResponse {
	t.Helper()
	var body achievementEventsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v (raw: %s)", err, rr.Body.String())
	}
	return body
}

func errorToken(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error       string `json:"error"`
		Diagnostics *struct {
			Reason string `json:"reason"`
		} `json:"diagnostics"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v (raw: %s)", err, rr.Body.String())
	}
	if body.Diagnostics != nil && body.Diagnostics.Reason != "" {
		return body.Error + "/" + body.Diagnostics.Reason
	}
	return body.Error
}

func TestAchievementRoutesAreRegisteredUnderTheVersionedPrefix(t *testing.T) {
	if achievementsRoutePrefix != "/api/v1/achievements" {
		t.Fatalf("prefix = %q", achievementsRoutePrefix)
	}
	mux := http.NewServeMux()
	newAchievementsTestApp(t, newMemAchievements()).registerRoutes(mux)
	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "/api/v1/achievements/events"},
		{http.MethodGet, "/api/v1/achievements/my"},
		{http.MethodGet, "/api/v1/achievements/definitions"},
	} {
		req := httptest.NewRequest(route.method, route.path, nil)
		if _, pattern := mux.Handler(req); pattern == "" {
			t.Errorf("%s %s is not registered", route.method, route.path)
		}
	}
}

func TestAchievementEvent_AwardsOnceAndRepeatChangesNothing(t *testing.T) {
	withFrozenTime(t, time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC))
	mem := newMemAchievements()
	app := newAchievementsTestApp(t, mem)

	rr := postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("evt-1", "uid-a"))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rr.Code, rr.Body.String())
	}
	body := decodeEvents(t, rr)
	if body.EventID != "evt-1" || body.Retry || len(body.Decisions) != 1 {
		t.Fatalf("unexpected response %+v", body)
	}
	if d := body.Decisions[0]; d.AchievementID != "dash-builder" || d.Decision != achievements.KindAward || !slices.Equal(d.Awarded, []string{"bronze"}) || d.Units != 1 {
		t.Fatalf("decision = %+v", d)
	}
	if awards, progress := mem.rowsFor(achievementsTestUser); awards != 1 || progress != 1 {
		t.Fatalf("rows = %d awards, %d progress; want 1 and 1", awards, progress)
	}

	again := decodeEvents(t, postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("evt-1", "uid-a")))
	if d := again.Decisions[0]; d.Decision != achievements.KindIgnored || d.Reason != achievements.ReasonDuplicate {
		t.Fatalf("repeat decision = %+v", d)
	}
	if awards, progress := mem.rowsFor(achievementsTestUser); awards != 1 || progress != 1 {
		t.Fatalf("repeat changed rows: %d awards, %d progress", awards, progress)
	}
}

func TestAchievementEvent_NoSelectionIsAnEmptyArray(t *testing.T) {
	app := newAchievementsTestApp(t, newMemAchievements())
	body := fmt.Sprintf(`{"schemaVersion":1,"eventId":"e","entity":"search","action":"performed","occurredAt":%q}`, timeNow().UTC().Format(time.RFC3339))
	rr := postAchievementEvent(t, app, achievementsTestUser, body)
	if !strings.Contains(rr.Body.String(), `"decisions":[]`) {
		t.Fatalf("decisions must be an empty array, got %s", rr.Body.String())
	}
}

func TestAchievementEvent_IdentityComesFromTheTokenNotTheBody(t *testing.T) {
	mem := newMemAchievements()
	app := newAchievementsTestApp(t, mem)
	body := strings.Replace(dashboardEventBody("evt-1", "uid-a"), `"schemaVersion":1,`, `"schemaVersion":1,"userId":"user:2","orgId":9,`, 1)
	if rr := postAchievementEvent(t, app, achievementsTestUser, body); rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rr.Code, rr.Body.String())
	}
	if awards, _ := mem.rowsFor("user:2"); awards != 0 {
		t.Fatal("a body identity reached the store")
	}
	if awards, _ := mem.rowsFor(achievementsTestUser); awards != 1 {
		t.Fatal("the token's identity did not receive the award")
	}
}

func TestAchievementEvent_PrincipalGate(t *testing.T) {
	for _, sub := range []string{"service-account:7", "anonymous:0", "render:1", "api-key:3", "access-policy:x", "no-type-prefix", "user:1:extra"} {
		t.Run(sub, func(t *testing.T) {
			mem := newMemAchievements()
			app := newAchievementsTestApp(t, mem)

			rr := postAchievementEvent(t, app, sub, dashboardEventBody("evt-1", "uid-a"))
			if rr.Code != http.StatusForbidden || errorToken(t, rr) != "principal-not-supported" {
				t.Fatalf("events: status %d body %s", rr.Code, rr.Body.String())
			}
			if awards, progress := mem.rowsFor(sub); awards+progress != 0 {
				t.Fatal("a non-person wrote rows")
			}

			my, body := getMyAchievements(t, app, sub)
			if my.Code != http.StatusOK || body.Capability.Available || body.Capability.Reason != "principal-not-supported" {
				t.Fatalf("my: status %d capability %+v", my.Code, body.Capability)
			}
		})
	}
}

func TestAchievementEvent_Unauthenticated(t *testing.T) {
	app := newAchievementsTestApp(t, newMemAchievements())
	rr := postAchievementEvent(t, app, "", dashboardEventBody("evt-1", "uid-a"))
	if rr.Code != http.StatusUnauthorized || errorToken(t, rr) != "unauthenticated" {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	my, body := getMyAchievements(t, app, "")
	if my.Code != http.StatusOK || body.Capability.Available || body.Capability.Reason != reasonIdentityUnavailable {
		t.Fatalf("my: status %d capability %+v", my.Code, body.Capability)
	}
}

func TestAchievementEvent_InvalidEventsAre400(t *testing.T) {
	now := timeNow().UTC()
	at := func(d time.Duration) string { return now.Add(d).Format(time.RFC3339) }
	cases := map[string]string{
		"malformed json":     `{"schemaVersion":`,
		"trailing data":      dashboardEventBody("e", "u") + `{}`,
		"unknown schema":     `{"schemaVersion":2,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"` + at(0) + `"}`,
		"missing event id":   `{"schemaVersion":1,"entity":"dashboards","action":"created","occurredAt":"` + at(0) + `"}`,
		"long event id":      `{"schemaVersion":1,"eventId":"` + strings.Repeat("x", 65) + `","entity":"dashboards","action":"created","occurredAt":"` + at(0) + `"}`,
		"undeclared pair":    `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"completed","occurredAt":"` + at(0) + `"}`,
		"undeclared entity":  `{"schemaVersion":1,"eventId":"e","entity":"nope","action":"created","occurredAt":"` + at(0) + `"}`,
		"unlisted field":     `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"` + at(0) + `","context":{"title":"x"}}`,
		"wrong type":         `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"` + at(0) + `","context":{"numPanels":"2"}}`,
		"outside enum":       `{"schemaVersion":1,"eventId":"e","entity":"guides","action":"completed","occurredAt":"` + at(0) + `","context":{"guideCategory":"video"}}`,
		"nested value":       `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"` + at(0) + `","context":{"resourceId":{"a":1}}}`,
		"too old":            `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"` + at(-31*24*time.Hour) + `"}`,
		"too far ahead":      `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"` + at(6*time.Minute) + `"}`,
		"not a timestamp":    `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"yesterday"}`,
		"over 4 KiB":         `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"` + at(0) + `","context":{"resourceId":"` + strings.Repeat("x", 5000) + `"}}`,
		"empty body":         ``,
		"uppercase token":    `{"schemaVersion":1,"eventId":"e","entity":"Dashboards","action":"created","occurredAt":"` + at(0) + `"}`,
		"control char in id": `{"schemaVersion":1,"eventId":"a\u0000b","entity":"dashboards","action":"created","occurredAt":"` + at(0) + `"}`,
		"too many fields":    `{"schemaVersion":1,"eventId":"e","entity":"dashboards","action":"created","occurredAt":"` + at(0) + `","context":{"a":1,"b":1,"c":1,"d":1,"e":1,"f":1,"g":1,"h":1,"i":1,"j":1,"k":1,"l":1,"m":1}}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			mem := newMemAchievements()
			rr := postAchievementEvent(t, newAchievementsTestApp(t, mem), achievementsTestUser, body)
			if rr.Code != http.StatusBadRequest || errorToken(t, rr) != "invalid-event" {
				t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
			}
			if awards, progress := mem.rowsFor(achievementsTestUser); awards+progress != 0 {
				t.Fatal("an invalid event reached the store")
			}
		})
	}
}

func TestAchievementEvent_RateLimit(t *testing.T) {
	withFrozenTime(t, time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC))
	app := newAchievementsTestApp(t, newMemAchievements())
	for i := range int(achievementEventsRateBurst) {
		if rr := postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("e"+strconv.Itoa(i), "u")); rr.Code != http.StatusOK {
			t.Fatalf("request %d: status %d", i, rr.Code)
		}
	}
	rr := postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("over", "u"))
	if rr.Code != http.StatusTooManyRequests || errorToken(t, rr) != "rate-limited" {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Retry-After") != "2" {
		t.Fatalf("Retry-After = %q, want 2", rr.Header().Get("Retry-After"))
	}
	if rr := postAchievementEvent(t, app, "user:2", dashboardEventBody("other", "u")); rr.Code != http.StatusOK {
		t.Fatalf("another user was limited: status %d", rr.Code)
	}
}

func TestAchievementEvent_StoreFailureIsARetryDecision(t *testing.T) {
	mem := newMemAchievements()
	mem.loadErr = fmt.Errorf("store down")
	rr := postAchievementEvent(t, newAchievementsTestApp(t, mem), achievementsTestUser, dashboardEventBody("evt-1", "uid-a"))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	body := decodeEvents(t, rr)
	if !body.Retry || body.Decisions[0].Reason != achievements.ReasonStoreUnavailable {
		t.Fatalf("response = %+v", body)
	}
}

func TestAchievementRoutes_StructurallyUnavailable(t *testing.T) {
	t.Run("no backend configured", func(t *testing.T) {
		app := newAchievementsTestApp(t, nil)
		rr := postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("e", "u"))
		if rr.Code != http.StatusNotFound || errorToken(t, rr) != "achievements-unavailable/"+reasonBackendUnavailable {
			t.Fatalf("events: status %d body %s", rr.Code, rr.Body.String())
		}
		my, body := getMyAchievements(t, app, achievementsTestUser)
		if my.Code != http.StatusOK || body.Capability.Available || body.Capability.Reason != reasonBackendUnavailable {
			t.Fatalf("my: status %d capability %+v", my.Code, body.Capability)
		}
		if body.Awards == nil || body.Progress == nil || body.Legacy == nil {
			t.Fatal("unavailable answer must still carry empty arrays")
		}
	})
	t.Run("backend reason is echoed", func(t *testing.T) {
		app := newAchievementsTestApp(t, newMemAchievements())
		app.achievementsBackendFor = func(*http.Request, achievements.Person, *achievements.Catalog) (achievementsBackend, string) {
			return achievementsBackend{}, reasonOBOUnavailable
		}
		rr := postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("e", "u"))
		if rr.Code != http.StatusNotFound || errorToken(t, rr) != "achievements-unavailable/"+reasonOBOUnavailable {
			t.Fatalf("events: status %d body %s", rr.Code, rr.Body.String())
		}
		_, body := getMyAchievements(t, app, achievementsTestUser)
		if body.Capability.Available || body.Capability.Reason != reasonOBOUnavailable {
			t.Fatalf("capability %+v", body.Capability)
		}
	})
	t.Run("aggregation toggle off", func(t *testing.T) {
		app := newAchievementsTestApp(t, newMemAchievements())
		r := completionRequestWithConfig(t, achievementsRoutePrefix+"/my", achievementsTestUser, map[string]string{sdkconfig.AppURL: testSigningKeysURL()})
		rr := httptest.NewRecorder()
		app.handleMyAchievements(rr, r)
		var body myAchievementsResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Capability.Available || body.Capability.Reason != reasonBackendUnavailable {
			t.Fatalf("capability %+v", body.Capability)
		}
	})
}

// Without OBO credentials the routes must disarm even while the definitions are down.
func TestAchievementRoutes_NoOBORefusesBeforeReadingDefinitions(t *testing.T) {
	app := newAchievementsTestApp(t, newMemAchievements())
	app.oboExchanger = nil
	app.definitions = staticDefinitions{retryAfter: time.Minute}

	rr := postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("e", "u"))
	if rr.Code != http.StatusNotFound || errorToken(t, rr) != "achievements-unavailable/"+reasonOBOUnavailable {
		t.Fatalf("events: status %d body %s", rr.Code, rr.Body.String())
	}
	my, body := getMyAchievements(t, app, achievementsTestUser)
	if my.Code != http.StatusOK || body.Capability.Available || body.Capability.Reason != reasonOBOUnavailable {
		t.Fatalf("my: status %d capability %+v", my.Code, body.Capability)
	}
}

// A 401 here would retry queued events instead of disarming the session.
func TestAchievementEvent_StandingConditionsDisarm(t *testing.T) {
	deadJWKS, _ := startJWKSServer(t)
	deadJWKS.Close()

	cases := []struct {
		name       string
		cfg        map[string]string
		keysDown   bool
		wantReason string
	}{
		{
			name:       "no app URL leaves identity unverifiable",
			cfg:        map[string]string{featuretoggles.EnabledFeatures: completionRecordsAggregationToggle},
			wantReason: reasonIdentityUnverifiable,
		},
		{
			name: "no reachable signing-keys source",
			cfg: map[string]string{
				featuretoggles.EnabledFeatures: completionRecordsAggregationToggle,
				sdkconfig.AppURL:               deadJWKS.URL,
			},
			keysDown:   true,
			wantReason: reasonSigningKeysUnreachable,
		},
		{
			name:       "aggregation toggle off",
			cfg:        map[string]string{sdkconfig.AppURL: testSigningKeysURL()},
			wantReason: reasonBackendUnavailable,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.keysDown {
				withSigningKeysURL(t, deadJWKS.URL+"/v1/keys")
			}
			mem := newMemAchievements()
			app := newAchievementsTestApp(t, mem)
			builds := 0
			app.achievementsBackendFor = func(*http.Request, achievements.Person, *achievements.Catalog) (achievementsBackend, string) {
				builds++
				return achievementsBackend{store: mem, reader: mem}, ""
			}

			r := completionRequestWithConfig(t, achievementsRoutePrefix+"/events", achievementsTestUser, tc.cfg)
			r.Method = http.MethodPost
			r.Body = io.NopCloser(strings.NewReader(dashboardEventBody("evt-1", "uid-a")))
			rr := httptest.NewRecorder()
			app.handleAchievementEvent(rr, r)

			if rr.Code != http.StatusNotFound || errorToken(t, rr) != "achievements-unavailable/"+tc.wantReason {
				t.Fatalf("status %d body %s, want 404 achievements-unavailable/%s", rr.Code, rr.Body.String(), tc.wantReason)
			}
			if builds != 0 {
				t.Errorf("backend built %d times, want 0", builds)
			}
			if awards, progress := mem.rowsFor(achievementsTestUser); awards+progress != 0 {
				t.Error("a disarmed request wrote rows")
			}
		})
	}
}

func TestMyAchievements_ShapesOnlyTheCallersRows(t *testing.T) {
	withFrozenTime(t, time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC))
	mem := newMemAchievements()
	app := newAchievementsTestApp(t, mem)
	for i := range 2 {
		postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("e"+strconv.Itoa(i), "uid-"+strconv.Itoa(i)))
	}
	postAchievementEvent(t, app, "user:2", dashboardEventBody("o", "uid-z"))
	milestone := fmt.Sprintf(`{"schemaVersion":1,"eventId":"m","entity":"guides","action":"completed","occurredAt":%q,"context":{"guideId":"intro"}}`, timeNow().UTC().Format(time.RFC3339))
	postAchievementEvent(t, app, achievementsTestUser, milestone)

	rr, body := getMyAchievements(t, app, achievementsTestUser)
	if rr.Code != http.StatusOK || !body.Capability.Available || body.Capability.Reason != "" {
		t.Fatalf("status %d capability %+v", rr.Code, body.Capability)
	}
	if body.AsOf != "2026-11-02T09:00:00Z" || body.Truncated {
		t.Fatalf("asOf %q truncated %v", body.AsOf, body.Truncated)
	}
	if len(body.Awards) != 2 || body.Awards[0].AchievementID != "dash-builder" || body.Awards[0].TierID != "bronze" || body.Awards[0].Entity != "dashboards" ||
		body.Awards[1].AchievementID != "guide-routes" {
		t.Fatalf("awards = %+v", body.Awards)
	}
	if len(body.Progress) != 1 || body.Progress[0].AchievementID != "dash-builder" || body.Progress[0].Units != 2 ||
		body.Progress[0].Next == nil || *body.Progress[0].Next != 3 {
		t.Fatalf("progress = %+v (a milestone must not appear)", body.Progress)
	}
	if !strings.Contains(rr.Body.String(), `"legacy":[]`) {
		t.Fatalf("legacy must be an empty array: %s", rr.Body.String())
	}
}

func TestMyAchievements_FinalTierHasNoNextAndTruncationPasses(t *testing.T) {
	mem := newMemAchievements()
	mem.truncated = true
	app := newAchievementsTestApp(t, mem)
	for i := range 5 {
		postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("e"+strconv.Itoa(i), "uid-"+strconv.Itoa(i)))
	}
	_, body := getMyAchievements(t, app, achievementsTestUser)
	if !body.Truncated || len(body.Progress) != 1 || body.Progress[0].Next != nil || body.Progress[0].Units != 5 {
		t.Fatalf("body = %+v", body)
	}
	if len(body.Awards) != 3 {
		t.Fatalf("every tier has its own award row, got %+v", body.Awards)
	}
}

func TestMyAchievements_AwardsFollowCatalogRankWithUnknownTiersLast(t *testing.T) {
	mem := newMemAchievements()
	for _, tier := range []string{"gold", "platinum", "bronze", "silver"} {
		mem.awards[achievementsTestUser+"/dash-builder/"+tier] = achievements.Award{AchievementID: "dash-builder", TierID: tier, Entity: "dashboards", EarnedAt: timeNow()}
	}
	_, body := getMyAchievements(t, newAchievementsTestApp(t, mem), achievementsTestUser)
	var got []string
	for _, a := range body.Awards {
		got = append(got, a.TierID)
	}
	if strings.Join(got, ",") != "bronze,silver,gold,platinum" {
		t.Fatalf("award order = %v, want catalog rank with a tier the catalog does not know last", got)
	}
}

func TestMyAchievements_NextSkipsATierAwardedBeforeTheRowRecordedIt(t *testing.T) {
	mem := newMemAchievements()
	mem.put(achievements.Person{ID: achievementsTestUser}, achievements.Progress{AchievementID: "dash-builder", TierIDs: []string{}, Units: []string{"u1"}, SchemaVersion: 1})
	mem.awards[achievementsTestUser+"/dash-builder/bronze"] = achievements.Award{AchievementID: "dash-builder", TierID: "bronze", Entity: "dashboards", EarnedAt: timeNow()}
	_, body := getMyAchievements(t, newAchievementsTestApp(t, mem), achievementsTestUser)
	if len(body.Progress) != 1 || body.Progress[0].Next == nil || *body.Progress[0].Next != 3 {
		t.Fatalf("progress = %+v, want next at silver's threshold 3", body.Progress)
	}
}

func TestMyAchievements_EmptyRowsAreEmptyArrays(t *testing.T) {
	rr, _ := getMyAchievements(t, newAchievementsTestApp(t, newMemAchievements()), "user:nobody")
	for _, want := range []string{`"awards":[]`, `"progress":[]`, `"legacy":[]`, `"truncated":false`} {
		if !strings.Contains(rr.Body.String(), want) {
			t.Errorf("missing %s in %s", want, rr.Body.String())
		}
	}
}

func TestMyAchievements_ReadFailures(t *testing.T) {
	t.Run("terminal upstream", func(t *testing.T) {
		mem := newMemAchievements()
		mem.listErr = &appPlatformUpstreamError{status: http.StatusNotFound, msg: "gone"}
		rr, body := getMyAchievements(t, newAchievementsTestApp(t, mem), achievementsTestUser)
		if rr.Code != http.StatusOK || body.Capability.Available || body.Capability.Reason != reasonBackendUnavailable {
			t.Fatalf("status %d capability %+v", rr.Code, body.Capability)
		}
	})
	t.Run("transient", func(t *testing.T) {
		mem := newMemAchievements()
		mem.listErr = fmt.Errorf("timeout")
		rr, _ := getMyAchievements(t, newAchievementsTestApp(t, mem), achievementsTestUser)
		if rr.Code != http.StatusServiceUnavailable || rr.Header().Get("Retry-After") == "" || !strings.HasPrefix(errorToken(t, rr), "achievements-unavailable") {
			t.Fatalf("status %d retry-after %q body %s", rr.Code, rr.Header().Get("Retry-After"), rr.Body.String())
		}
	})
}

func TestAchievementRoutes_WrongMethod(t *testing.T) {
	app := newAchievementsTestApp(t, newMemAchievements())
	rr := httptest.NewRecorder()
	app.handleAchievementEvent(rr, achievementRequest(t, http.MethodGet, achievementsRoutePrefix+"/events", achievementsTestUser, ""))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("events GET: status %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	app.handleMyAchievements(rr, achievementRequest(t, http.MethodPost, achievementsRoutePrefix+"/my", achievementsTestUser, ""))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("my POST: status %d", rr.Code)
	}
}

func TestNewAppReadsThePublishedDefinitionsLazily(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	source, ok := app.definitions.(*definitionsSource)
	if !ok || app.achievementEventsRateLimiter == nil {
		t.Fatalf("definitions = %T, limiter %v", app.definitions, app.achievementEventsRateLimiter)
	}
	if source.url != "https://interactive-learning.grafana.net/achievements/v1/definitions.json" {
		t.Errorf("definitions URL = %q", source.url)
	}
	if source.current.Load() != nil || source.flight != nil {
		t.Error("NewApp fetched definitions; the first request should")
	}
	if app.achievementsBackendFor == nil {
		t.Fatal("NewApp left the achievements store unwired")
	}
}

func captureAchievementEventsTierUp(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	app := newAchievementsTestApp(t, newMemAchievements())
	var last *httptest.ResponseRecorder
	for i := range 3 {
		last = postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("event-"+strconv.Itoa(i), "uid-"+strconv.Itoa(i)))
	}
	return last
}

func captureAchievementEventsMilestoneAward(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	body := fmt.Sprintf(`{"schemaVersion":1,"eventId":"event-m","entity":"guides","action":"completed","occurredAt":%q,"context":{"guideId":"intro"}}`, timeNow().UTC().Format(time.RFC3339))
	return postAchievementEvent(t, newAchievementsTestApp(t, newMemAchievements()), achievementsTestUser, body)
}

func captureAchievementEventsNoSelection(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	body := fmt.Sprintf(`{"schemaVersion":1,"eventId":"event-s","entity":"search","action":"performed","occurredAt":%q}`, timeNow().UTC().Format(time.RFC3339))
	return postAchievementEvent(t, newAchievementsTestApp(t, newMemAchievements()), achievementsTestUser, body)
}

func captureAchievementEventsRetry(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	mem := newMemAchievements()
	mem.loadErr = fmt.Errorf("store down")
	return postAchievementEvent(t, newAchievementsTestApp(t, mem), achievementsTestUser, dashboardEventBody("event-r", "uid-r"))
}

func captureMyAchievements(t *testing.T, mem *memAchievements, sub string, events ...string) *httptest.ResponseRecorder {
	t.Helper()
	app := newAchievementsTestApp(t, mem)
	for _, body := range events {
		postAchievementEvent(t, app, achievementsTestUser, body)
	}
	rr := httptest.NewRecorder()
	app.handleMyAchievements(rr, achievementRequest(t, http.MethodGet, achievementsRoutePrefix+"/my", sub, ""))
	return rr
}

func captureMyAchievementsDefault(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	milestone := fmt.Sprintf(`{"schemaVersion":1,"eventId":"event-m","entity":"guides","action":"completed","occurredAt":%q,"context":{"guideId":"intro"}}`, timeNow().UTC().Format(time.RFC3339))
	return captureMyAchievements(t, newMemAchievements(), achievementsTestUser,
		dashboardEventBody("event-0", "uid-0"), dashboardEventBody("event-1", "uid-1"), dashboardEventBody("event-2", "uid-2"), milestone)
}

func captureMyAchievementsEmpty(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	return captureMyAchievements(t, newMemAchievements(), "user:nobody", dashboardEventBody("event-0", "uid-0"))
}

func captureMyAchievementsTruncated(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	mem := newMemAchievements()
	mem.truncated = true
	return captureMyAchievements(t, mem, achievementsTestUser, dashboardEventBody("event-0", "uid-0"))
}

func captureMyAchievementsUnavailable(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	return captureMyAchievements(t, nil, achievementsTestUser)
}
