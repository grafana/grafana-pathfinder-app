package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

// definitionsCDN is a TLS test server whose next answer the test sets.
type definitionsCDN struct {
	server  *httptest.Server
	fetches atomic.Int32
	release chan struct{}

	mu          sync.Mutex
	status      int
	body        string
	etag        string
	location    string
	ifNoneMatch []string
}

func newDefinitionsCDN(t *testing.T) *definitionsCDN {
	t.Helper()
	cdn := &definitionsCDN{status: http.StatusOK, body: achievementsTestBundleJSON, etag: `W/"one"`}
	cdn.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cdn.fetches.Add(1)
		if cdn.release != nil {
			<-cdn.release
		}
		cdn.mu.Lock()
		defer cdn.mu.Unlock()
		cdn.ifNoneMatch = append(cdn.ifNoneMatch, r.Header.Get("If-None-Match"))
		if r.URL.Path != "/"+achievements.DefinitionsPath {
			http.NotFound(w, r)
			return
		}
		if cdn.location != "" {
			w.Header().Set("Location", cdn.location)
		}
		if cdn.etag != "" {
			w.Header().Set("ETag", cdn.etag)
		}
		if cdn.status == http.StatusOK && cdn.etag != "" && r.Header.Get("If-None-Match") == cdn.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.WriteHeader(cdn.status)
		_, _ = w.Write([]byte(cdn.body))
	}))
	t.Cleanup(cdn.server.Close)
	return cdn
}

func (c *definitionsCDN) answer(status int, body, etag string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status, c.body, c.etag = status, body, etag
}

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func newTestDefinitionsSource(t *testing.T, cdn *definitionsCDN) (*definitionsSource, *testClock) {
	t.Helper()
	host, _ := url.Parse(cdn.server.URL)
	source, err := newDefinitionsSource(cdn.server.URL, achievements.DefinitionsPath, map[string]struct{}{host.Hostname(): {}}, cdn.server.Client())
	if err != nil {
		t.Fatal(err)
	}
	clock := &testClock{now: time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)}
	source.now = clock.Now
	return source, clock
}

// settle waits for a revalidation the last Snapshot call started.
func settle(t *testing.T, s *definitionsSource) {
	t.Helper()
	s.mu.Lock()
	flight := s.flight
	s.mu.Unlock()
	if flight == nil {
		return
	}
	select {
	case <-flight:
	case <-time.After(5 * time.Second):
		t.Fatal("revalidation did not finish")
	}
}

func TestDefinitionsSource_KeepsLastGoodAndRevalidates(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	source, clock := newTestDefinitionsSource(t, cdn)

	first, _ := source.Snapshot(context.Background())
	if first == nil || len(first.Catalog.Achievements) != 2 {
		t.Fatalf("cold start snapshot = %+v", first)
	}

	clock.advance(definitionsRevalidateAfter - time.Second)
	if got, _ := source.Snapshot(context.Background()); got != first || cdn.fetches.Load() != 1 {
		t.Fatalf("refetched before the revalidation interval: %d fetches", cdn.fetches.Load())
	}

	clock.advance(time.Second)
	source.Snapshot(context.Background())
	settle(t, source)
	if source.current.Load() != first || cdn.fetches.Load() != 2 {
		t.Fatalf("304 replaced the snapshot or did not revalidate: %d fetches", cdn.fetches.Load())
	}
	if got := cdn.ifNoneMatch; got[0] != "" || got[1] != `W/"one"` {
		t.Fatalf("If-None-Match = %q, want none on the cold fetch then the ETag", got)
	}
	clock.advance(definitionsRevalidateAfter - time.Second)
	source.Snapshot(context.Background())
	settle(t, source)
	if cdn.fetches.Load() != 2 {
		t.Fatalf("a 304 did not restart the revalidation interval: %d fetches", cdn.fetches.Load())
	}

	bad := []struct {
		name   string
		status int
		body   string
	}{
		{"upstream error", http.StatusBadGateway, "oops"},
		{"unparseable", http.StatusOK, "{"},
		{"another grammar", http.StatusOK, `{"grammar":"2.0"}`},
		{"over the size cap", http.StatusOK, `{"grammar":"1.0","pad":"` + strings.Repeat("x", achievements.MaxBundleBytes) + `"}`},
		{"redirect", http.StatusFound, ""},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			cdn.answer(tc.status, tc.body, `W/"`+tc.name+`"`)
			if tc.status == http.StatusFound {
				cdn.mu.Lock()
				cdn.location = cdn.server.URL + "/" + achievements.DefinitionsPath
				cdn.mu.Unlock()
			}
			clock.advance(definitionsBackoffMax + definitionsRevalidateAfter)
			before := cdn.fetches.Load()
			got, _ := source.Snapshot(context.Background())
			settle(t, source)
			if got != first || source.current.Load() != first {
				t.Fatal("a failed fetch replaced the last good snapshot")
			}
			if cdn.fetches.Load() != before+1 {
				t.Fatalf("fetches = %d, want one (no redirect followed)", cdn.fetches.Load()-before)
			}
		})
	}
}

func TestDefinitionsSource_ReplacesOnANewBundle(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	source, clock := newTestDefinitionsSource(t, cdn)
	first, _ := source.Snapshot(context.Background())

	cdn.answer(http.StatusOK, strings.Replace(achievementsTestBundleJSON, "Create dashboards.", "Build dashboards.", 1), `W/"two"`)
	clock.advance(definitionsRevalidateAfter)
	source.Snapshot(context.Background())
	settle(t, source)
	next := source.current.Load()
	if next == first || next.Version == first.Version || next.Display[0].Description != "Build dashboards." {
		t.Fatalf("snapshot not replaced: %+v", next.Display[0])
	}
}

func TestDefinitionsSource_ColdStartFailureIsRetryableWithBackoff(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	cdn.answer(http.StatusServiceUnavailable, "", "")
	source, clock := newTestDefinitionsSource(t, cdn)

	snap, retryAfter := source.Snapshot(context.Background())
	if snap != nil || retryAfter != definitionsBackoffMin {
		t.Fatalf("snapshot %v, retry after %v, want none and %v", snap, retryAfter, definitionsBackoffMin)
	}
	clock.advance(30 * time.Second)
	if snap, retryAfter = source.Snapshot(context.Background()); snap != nil || retryAfter != 30*time.Second || cdn.fetches.Load() != 1 {
		t.Fatalf("refetched inside the backoff: %d fetches, retry after %v", cdn.fetches.Load(), retryAfter)
	}

	clock.advance(30 * time.Second)
	if _, retryAfter = source.Snapshot(context.Background()); retryAfter != 2*definitionsBackoffMin {
		t.Fatalf("second failure retry after %v, want %v", retryAfter, 2*definitionsBackoffMin)
	}

	cdn.answer(http.StatusOK, achievementsTestBundleJSON, `W/"one"`)
	clock.advance(2 * definitionsBackoffMin)
	if snap, _ = source.Snapshot(context.Background()); snap == nil {
		t.Fatal("did not recover once the CDN answered")
	}

	cdn.answer(http.StatusBadGateway, "", "")
	clock.advance(definitionsRevalidateAfter)
	source.Snapshot(context.Background())
	settle(t, source)
	source.mu.Lock()
	backoff := source.retryAt.Sub(clock.Now())
	source.mu.Unlock()
	if backoff != definitionsBackoffMin {
		t.Fatalf("backoff after a recovery = %v, want it to start again at %v", backoff, definitionsBackoffMin)
	}
}

func TestDefinitionsBackoffDoublesToItsCap(t *testing.T) {
	for failures, want := range map[int]time.Duration{
		1: time.Minute, 2: 2 * time.Minute, 3: 4 * time.Minute, 4: 8 * time.Minute, 5: 10 * time.Minute, 60: 10 * time.Minute,
	} {
		if got := definitionsBackoff(failures); got != want {
			t.Errorf("definitionsBackoff(%d) = %v, want %v", failures, got, want)
		}
	}
}

func TestDefinitionsSource_ReadsAtMostTheSizeCap(t *testing.T) {
	var written atomic.Int64
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chunk := []byte(strings.Repeat("x", 64<<10))
		for range 1024 {
			n, err := w.Write(chunk)
			written.Add(int64(n))
			if err != nil {
				return
			}
		}
	}))
	defer server.Close()
	host, _ := url.Parse(server.URL)
	source, err := newDefinitionsSource(server.URL, achievements.DefinitionsPath, map[string]struct{}{host.Hostname(): {}}, server.Client())
	if err != nil {
		t.Fatal(err)
	}

	if _, _, err := source.fetch(""); err == nil || !strings.Contains(err.Error(), "size cap") {
		t.Fatalf("fetch error = %v, want the size cap", err)
	}
	server.Close()
	if n := written.Load(); n >= 32<<20 {
		t.Fatalf("server wrote %d bytes before the client stopped reading; the read is not bounded", n)
	}
}

func TestDefinitionsSource_ColdStartWaitIsBounded(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	cdn.release = make(chan struct{})
	source, _ := newTestDefinitionsSource(t, cdn)
	source.coldStartWait = 20 * time.Millisecond
	defer func() { close(cdn.release); settle(t, source) }()

	started := time.Now()
	if snap, retryAfter := source.Snapshot(context.Background()); snap != nil || retryAfter != time.Second {
		t.Fatalf("snapshot %v, retry after %v while the first fetch is in flight", snap, retryAfter)
	}
	if waited := time.Since(started); waited > definitionsColdStartWait {
		t.Fatalf("waited %v for a held fetch, want about the cold-start wait", waited)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	source.coldStartWait = time.Hour
	started = time.Now()
	if snap, retryAfter := source.Snapshot(ctx); snap != nil || retryAfter != time.Second {
		t.Fatalf("cancelled request: snapshot %v, retry after %v", snap, retryAfter)
	}
	if waited := time.Since(started); waited > time.Second {
		t.Fatalf("a cancelled request waited %v for the held fetch", waited)
	}
}

func TestDefinitionsSource_SingleFlight(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	cdn.release = make(chan struct{})
	source, _ := newTestDefinitionsSource(t, cdn)

	var wg sync.WaitGroup
	snaps := make([]*achievements.Snapshot, 8)
	for i := range snaps {
		wg.Add(1)
		go func() {
			defer wg.Done()
			snaps[i], _ = source.Snapshot(context.Background())
		}()
	}
	time.Sleep(50 * time.Millisecond)
	close(cdn.release)
	wg.Wait()
	if n := cdn.fetches.Load(); n != 1 {
		t.Fatalf("fetches = %d, want 1", n)
	}
	for i, s := range snaps {
		if s == nil || s != snaps[0] {
			t.Fatalf("caller %d got %p, want the shared snapshot", i, s)
		}
	}
}

func TestNewDefinitionsSource_RefusesAnythingButAnAllowlistedHTTPSHost(t *testing.T) {
	for _, base := range []string{
		"http://interactive-learning.grafana.net/",
		"https://evil.example/",
		"https://user:pass@interactive-learning.grafana.net/",
		"https://interactive-learning.grafana.net.evil.example/",
	} {
		if _, err := newDefinitionsSource(base, achievements.DefinitionsPath, allowedPackageRepositoryHosts, &http.Client{}); err == nil {
			t.Errorf("%s was accepted", base)
		}
	}
	source, err := processDefinitions()
	if err != nil {
		t.Fatal(err)
	}
	if source.url != achievementsCDNBase+achievements.DefinitionsPath || source.client.CheckRedirect == nil || source.client.Timeout != definitionsFetchTimeout {
		t.Fatalf("process source = %q, timeout %v", source.url, source.client.Timeout)
	}
}

func TestAchievementRoutes_DefinitionsUnavailableIsRetryableNotStructural(t *testing.T) {
	mem := newMemAchievements()
	app := newAchievementsTestApp(t, mem)
	app.definitions = staticDefinitions{retryAfter: 1500 * time.Millisecond}

	check := func(name string, rr *httptest.ResponseRecorder) {
		t.Helper()
		if rr.Code != http.StatusServiceUnavailable || errorToken(t, rr) != errDefinitionsUnavailable || rr.Header().Get("Retry-After") != "2" {
			t.Errorf("%s: status %d Retry-After %q body %s", name, rr.Code, rr.Header().Get("Retry-After"), rr.Body.String())
		}
	}
	check("events", postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("evt-1", "uid-a")))
	my, _ := getMyAchievements(t, app, achievementsTestUser)
	check("my", my)
	check("definitions", getAchievementDefinitions(t, app, achievementsTestUser, testGrafanaConfig()))
	if awards, progress := mem.rowsFor(achievementsTestUser); awards+progress != 0 {
		t.Error("an event was evaluated without definitions")
	}
}

type countingDefinitions struct{ calls atomic.Int32 }

func (c *countingDefinitions) Snapshot(context.Context) (*achievements.Snapshot, time.Duration) {
	c.calls.Add(1)
	return nil, time.Minute
}

// In the shipped state the structural answer must win, so a CDN outage cannot
// turn a disarming 404 into a retried 503.
func TestAchievementRoutes_StructuralAnswerComesBeforeTheDefinitionsRead(t *testing.T) {
	toggleOff := map[string]string{sdkconfig.AppURL: testSigningKeysURL()}
	for _, tc := range []struct {
		name      string
		cfg       map[string]string
		noBackend bool
	}{
		{name: "toggle off", cfg: toggleOff},
		{name: "no store adapter", cfg: testGrafanaConfig(), noBackend: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := newAchievementsTestApp(t, newMemAchievements())
			defs := &countingDefinitions{}
			app.definitions = defs
			if tc.noBackend {
				app.achievementsBackendFor = nil
			}

			r := completionRequestWithConfig(t, achievementsRoutePrefix+"/events", achievementsTestUser, tc.cfg)
			r.Method = http.MethodPost
			r.Body = io.NopCloser(strings.NewReader(dashboardEventBody("evt-1", "uid-a")))
			rr := httptest.NewRecorder()
			app.handleAchievementEvent(rr, r)
			if rr.Code != http.StatusNotFound || errorToken(t, rr) != "achievements-unavailable/"+reasonBackendUnavailable {
				t.Errorf("events: status %d body %s", rr.Code, rr.Body.String())
			}

			rr = httptest.NewRecorder()
			app.handleMyAchievements(rr, completionRequestWithConfig(t, achievementsRoutePrefix+"/my", achievementsTestUser, tc.cfg))
			var my myAchievementsResponse
			if err := json.Unmarshal(rr.Body.Bytes(), &my); err != nil || rr.Code != http.StatusOK || my.Capability.Available || my.Capability.Reason != reasonBackendUnavailable {
				t.Errorf("my: status %d body %s", rr.Code, rr.Body.String())
			}

			if !tc.noBackend {
				rr = getAchievementDefinitions(t, app, achievementsTestUser, tc.cfg)
				if rr.Code != http.StatusNotFound {
					t.Errorf("definitions: status %d body %s", rr.Code, rr.Body.String())
				}
			}
			if n := defs.calls.Load(); n != 0 {
				t.Fatalf("definitions read %d times before the structural answer", n)
			}
		})
	}
}

func getAchievementDefinitions(t *testing.T, app *App, sub string, cfg map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	app.handleAchievementDefinitions(rr, completionRequestWithConfig(t, achievementsRoutePrefix+"/definitions", sub, cfg))
	return rr
}

// guide-streak uses a construct this build cannot read: displayed, not earnable.
const achievementsTestBundleWithSkipJSON = `{"grammar":"1.0","registry":{"entities":{
  "guides":{"actions":{"completed":{"context":{"guideId":{"type":"string"}},
    "resources":[{"unit":"guide","id":["guideId"]}]}}}}},
 "catalog":{"achievements":[
  {"id":"guides-finished","title":"Guide finisher","description":"Finish guides.",
   "counter":{"unit":"guide","evidence":[{"entity":"guides","action":"completed","countBy":"resource"}]},
   "tiers":[{"id":"bronze","at":1,"art":"guides-finished-1"},{"id":"silver","at":5}]},
  {"id":"guide-streak","title":"Guide streak","description":"Finish a guide every day.",
   "streak":{"days":3},"tiers":[{"id":"bronze","art":"guide-streak-1"}]}
 ]},
 "art":["guides-finished-1","guide-streak-1"]}`

func appWithDefinitions(t *testing.T, bundle string) (*App, *achievements.Snapshot) {
	t.Helper()
	snap, err := achievements.LoadBundle([]byte(bundle))
	if err != nil {
		t.Fatal(err)
	}
	app := newAchievementsTestApp(t, nil)
	app.definitions = staticDefinitions{snap: snap}
	return app, snap
}

func TestAchievementDefinitions_DisplaysEveryPublishedDefinition(t *testing.T) {
	app, snap := appWithDefinitions(t, achievementsTestBundleWithSkipJSON)
	rr := getAchievementDefinitions(t, app, achievementsTestUser, testGrafanaConfig())
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var body achievementDefinitionsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Version != snap.Version || body.ArtBase != "https://interactive-learning.grafana.net/achievements/art/" {
		t.Fatalf("version %q artBase %q", body.Version, body.ArtBase)
	}
	if len(body.Achievements) != 2 {
		t.Fatalf("achievements = %+v", body.Achievements)
	}
	finished, streak := body.Achievements[0], body.Achievements[1]
	if finished.ID != "guides-finished" || !finished.Earnable || len(finished.Tiers) != 2 || finished.Tiers[0].Art != "guides-finished-1" {
		t.Errorf("guides-finished = %+v", finished)
	}
	if streak.ID != "guide-streak" || streak.Earnable || streak.Title != "Guide streak" {
		t.Errorf("guide-streak = %+v, want displayed and not earnable", streak)
	}
}

func TestAchievementDefinitions_HoldsNoPerUserData(t *testing.T) {
	app, _ := appWithDefinitions(t, achievementsTestBundleWithSkipJSON)
	a := getAchievementDefinitions(t, app, "user:1", testGrafanaConfig()).Body.String()
	b := getAchievementDefinitions(t, app, "", testGrafanaConfig()).Body.String()
	if a != b {
		t.Fatalf("answers differ by caller:\n%s\n%s", a, b)
	}
}

func TestAchievementDefinitions_StructurallyUnavailable(t *testing.T) {
	app, _ := appWithDefinitions(t, achievementsTestBundleJSON)
	rr := getAchievementDefinitions(t, app, achievementsTestUser, map[string]string{sdkconfig.AppURL: testSigningKeysURL()})
	if rr.Code != http.StatusNotFound || errorToken(t, rr) != "achievements-unavailable/"+reasonBackendUnavailable {
		t.Errorf("toggle off: status %d body %s", rr.Code, rr.Body.String())
	}

	app.definitions = nil
	rr = getAchievementDefinitions(t, app, achievementsTestUser, testGrafanaConfig())
	if rr.Code != http.StatusNotFound || errorToken(t, rr) != "achievements-unavailable/"+reasonBackendUnavailable {
		t.Errorf("no source: status %d body %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	r := completionRequest(t, achievementsRoutePrefix+"/definitions", achievementsTestUser)
	r.Method = http.MethodPost
	app.handleAchievementDefinitions(rr, r)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: status %d", rr.Code)
	}
}

func TestMyAchievements_NamesTheDefinitionsVersion(t *testing.T) {
	app := newAchievementsTestApp(t, newMemAchievements())
	_, body := getMyAchievements(t, app, achievementsTestUser)
	want := app.definitions.(staticDefinitions).snap.Version
	if body.DefinitionsVersion != want || len(want) != 16 {
		t.Fatalf("definitionsVersion = %q, want %q", body.DefinitionsVersion, want)
	}
	if _, err := strconv.ParseUint(want, 16, 64); err != nil {
		t.Fatalf("version %q is not hex", want)
	}
}

func captureAchievementDefinitionsDefault(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	app, _ := appWithDefinitions(t, achievementsTestBundleWithSkipJSON)
	return getAchievementDefinitions(t, app, achievementsTestUser, testGrafanaConfig())
}
