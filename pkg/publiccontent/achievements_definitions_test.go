package publiccontent

import (
	"context"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

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

// unreadableBundle still carries dash-builder and search.performed, both of
// which the test bundle evaluates, but in forms this build cannot read.
func unreadableBundle(t *testing.T) string {
	t.Helper()
	b := strings.Replace(achievementsTestBundleJSON, `"counter":{"unit":"dashboard"`, `"streak":{"days":3},"counter":{"unit":"dashboard"`, 1)
	b = strings.Replace(b, `"performed":{"context":{}}`, `"performed":{"context":{"q":{"type":"nope"}}}`, 1)
	if b == achievementsTestBundleJSON || !strings.Contains(b, `"streak"`) || !strings.Contains(b, `"nope"`) {
		t.Fatal("unreadable bundle fixture no longer matches the test bundle")
	}
	return b
}

// absentBundle leaves out guide-routes and the search entity altogether.
func absentBundle(t *testing.T) string {
	t.Helper()
	b := strings.Replace(achievementsTestBundleJSON, `,
  "search":{"actions":{"performed":{"context":{}}}}`, "", 1)
	from, to := strings.Index(b, `,
  {"id":"guide-routes"`), strings.LastIndex(b, `
]}}`)
	if from < 0 || to < from || strings.Contains(b, `"search"`) {
		t.Fatal("absent bundle fixture no longer matches the test bundle")
	}
	return b[:from] + b[to:]
}

// allUnreadableBundle carries both definitions in a form this build cannot read.
func allUnreadableBundle(t *testing.T) string {
	t.Helper()
	b := strings.Replace(achievementsTestBundleJSON, `"counter":{"unit":"dashboard"`, `"streak":{"days":3},"counter":{"unit":"dashboard"`, 1)
	b = strings.Replace(b, `"tiers":[{"id":"intro"`, `"streak":{"days":3},"tiers":[{"id":"intro"`, 1)
	if strings.Count(b, `"streak"`) != 2 {
		t.Fatal("all-unreadable bundle fixture no longer matches the test bundle")
	}
	return b
}

func emptyCatalogBundle(t *testing.T) string {
	t.Helper()
	at := strings.Index(achievementsTestBundleJSON, `"catalog":`)
	if at < 0 {
		t.Fatal("empty bundle fixture no longer matches the test bundle")
	}
	return achievementsTestBundleJSON[:at] + `"catalog":{"achievements":[]}}`
}

// grownBundle adds an achievement and a registry action and keeps the rest.
func grownBundle(t *testing.T) string {
	t.Helper()
	b := strings.Replace(achievementsTestBundleJSON, `"search":{"actions":{"performed":{"context":{}}}}`,
		`"search":{"actions":{"performed":{"context":{}}}},
  "alert-rules":{"actions":{"created":{"context":{}}}}`, 1)
	b = strings.Replace(b, `
]}}`, `,
  {"id":"alert-starter","title":"Alert starter","description":"Create an alert rule.",
   "counter":{"unit":"occurrence","evidence":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]},
   "tiers":[{"id":"bronze","at":1}]}
]}}`, 1)
	if !strings.Contains(b, `"alert-starter"`) || !strings.Contains(b, `"alert-rules"`) {
		t.Fatal("grown bundle fixture no longer matches the test bundle")
	}
	return b
}

func warnFields(l *diagnosticLogger) map[string]interface{} {
	fields := map[string]interface{}{}
	for i := 0; i+1 < len(l.fields); i += 2 {
		fields[l.fields[i].(string)] = l.fields[i+1]
	}
	return fields
}

func TestDefinitionsSource_RejectsAnUnreadableRefresh(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	source, clock := newTestDefinitionsSource(t, cdn)
	logger := &diagnosticLogger{capturingLogger: newCapturingLogger()}
	source.logger = logger
	first, _ := source.Snapshot(context.Background())

	unreadable := unreadableBundle(t)
	rejected, err := achievements.LoadBundle([]byte(unreadable))
	if err != nil || len(rejected.Skipped) != 2 {
		t.Fatalf("the unreadable bundle must load with two skips: %v %+v", err, rejected)
	}
	cdn.answer(http.StatusOK, unreadable, `W/"unreadable"`)
	clock.advance(definitionsRevalidateAfter)
	source.Snapshot(context.Background())
	settle(t, source)

	if source.current.Load() != first {
		t.Fatal("a refresh with unreadable evaluable entries replaced the last good copy")
	}
	if !logger.warnedWith(msgDefinitionsRefreshRejected) {
		t.Fatal("no rejection warning")
	}
	fields := warnFields(logger)
	if fields["reason"] != "unreadable-entries" || fields["definitionsVersion"] != first.Version || fields["rejectedDefinitionsVersion"] != rejected.Version ||
		!slices.Equal(fields["unreadableAchievements"].([]string), []string{"dash-builder"}) ||
		!slices.Equal(fields["unreadableActions"].([]string), []string{"search.performed"}) {
		t.Fatalf("rejection fields = %#v", fields)
	}
	source.mu.Lock()
	backoff, etag := source.retryAt.Sub(clock.Now()), source.etag
	source.mu.Unlock()
	if backoff != definitionsBackoffMin || etag != `W/"one"` {
		t.Fatalf("a rejected refresh must back off like a failed fetch and keep the old ETag: backoff %v, etag %q", backoff, etag)
	}

	clock.advance(definitionsBackoffMin)
	source.Snapshot(context.Background())
	settle(t, source)
	source.mu.Lock()
	backoff = source.retryAt.Sub(clock.Now())
	source.mu.Unlock()
	if source.current.Load() != first || backoff != 2*definitionsBackoffMin {
		t.Fatalf("second rejection: replaced %v, backoff %v, want kept and %v", source.current.Load() != first, backoff, 2*definitionsBackoffMin)
	}

	cdn.answer(http.StatusOK, grownBundle(t), `W/"grown"`)
	clock.advance(2 * definitionsBackoffMin)
	source.Snapshot(context.Background())
	settle(t, source)
	recovered := source.current.Load()
	if recovered == first || len(recovered.Catalog.Achievements) != 3 {
		t.Fatalf("a good bundle after a rejection was not swapped in: %+v", recovered.Catalog)
	}
	source.mu.Lock()
	failures, retryAt := source.failures, source.retryAt
	source.mu.Unlock()
	if failures != 0 || !retryAt.IsZero() {
		t.Fatalf("recovery left failures %d, retryAt %v", failures, retryAt)
	}
}

func TestDefinitionsSource_RejectsABundleWithNoEvaluableDefinition(t *testing.T) {
	for name, bundle := range map[string]func(*testing.T) string{
		"empty catalog":  emptyCatalogBundle,
		"all unreadable": allUnreadableBundle,
	} {
		t.Run(name, func(t *testing.T) {
			cdn := newDefinitionsCDN(t)
			source, clock := newTestDefinitionsSource(t, cdn)
			logger := &diagnosticLogger{capturingLogger: newCapturingLogger()}
			source.logger = logger
			first, _ := source.Snapshot(context.Background())

			cdn.answer(http.StatusOK, bundle(t), `W/"`+name+`"`)
			clock.advance(definitionsRevalidateAfter)
			source.Snapshot(context.Background())
			settle(t, source)
			if source.current.Load() != first {
				t.Fatal("a bundle with no evaluable definition replaced the copy")
			}
			if fields := warnFields(logger); fields["reason"] != "no-evaluable-definitions" {
				t.Fatalf("rejection fields = %#v", fields)
			}
		})
	}
}

func TestDefinitionsSource_AcceptsADeliberateRemoval(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	source, clock := newTestDefinitionsSource(t, cdn)
	logger := &diagnosticLogger{capturingLogger: newCapturingLogger()}
	source.logger = logger
	first, _ := source.Snapshot(context.Background())

	cdn.answer(http.StatusOK, absentBundle(t), `W/"absent"`)
	clock.advance(definitionsRevalidateAfter)
	source.Snapshot(context.Background())
	settle(t, source)
	next := source.current.Load()
	if next == first || logger.warnedWith(msgDefinitionsRefreshRejected) {
		t.Fatal("a bundle that leaves entries out was rejected")
	}
	if len(next.Catalog.Achievements) != 1 || next.Catalog.Achievements[0].ID != "dash-builder" {
		t.Fatalf("catalog = %+v", next.Catalog.Achievements)
	}
	if _, ok := next.Registry.Entities["search"]; ok {
		t.Fatal("the removed search entity is still registered")
	}
}

func TestDefinitionsSource_AcceptsARefreshThatOnlyAddsOrKeeps(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	source, clock := newTestDefinitionsSource(t, cdn)
	logger := &diagnosticLogger{capturingLogger: newCapturingLogger()}
	source.logger = logger
	first, _ := source.Snapshot(context.Background())

	cdn.answer(http.StatusOK, grownBundle(t), `W/"grown"`)
	clock.advance(definitionsRevalidateAfter)
	source.Snapshot(context.Background())
	settle(t, source)
	next := source.current.Load()
	if next == first || len(next.Catalog.Achievements) != 3 || logger.warnedWith(msgDefinitionsRefreshRejected) {
		t.Fatalf("a growing refresh was not accepted: %d achievements", len(next.Catalog.Achievements))
	}
	if _, ok := next.Registry.Entities["alert-rules"].Actions["created"]; !ok {
		t.Fatal("the added registry action is missing")
	}
}

func TestDefinitionsSource_FirstLoadTakesABundleWithSkips(t *testing.T) {
	cdn := newDefinitionsCDN(t)
	cdn.answer(http.StatusOK, unreadableBundle(t), `W/"unreadable"`)
	source, _ := newTestDefinitionsSource(t, cdn)
	snap, _ := source.Snapshot(context.Background())
	if snap == nil || len(snap.Skipped) == 0 {
		t.Fatalf("with no copy loaded, a bundle with skips must still load: %+v", snap)
	}
}

func TestUnreadableEvaluable(t *testing.T) {
	good := loadAchievementsTestBundle(t, achievementsTestBundleJSON)
	load := func(bundle string) *achievements.Snapshot {
		t.Helper()
		snap, err := achievements.LoadBundle([]byte(bundle))
		if err != nil {
			t.Fatal(err)
		}
		return snap
	}
	ids, actions := unreadableEvaluable(good, load(unreadableBundle(t)))
	if !slices.Equal(ids, []string{"dash-builder"}) || !slices.Equal(actions, []string{"search.performed"}) {
		t.Fatalf("unreadable = %v, %v", ids, actions)
	}
	if ids, actions := unreadableEvaluable(good, load(absentBundle(t))); len(ids)+len(actions) != 0 {
		t.Fatalf("a removal counted as unreadable: %v, %v", ids, actions)
	}
	if ids, actions := unreadableEvaluable(load(unreadableBundle(t)), good); len(ids)+len(actions) != 0 {
		t.Fatalf("gaining entries counted as unreadable: %v, %v", ids, actions)
	}

	noID := strings.Replace(absentBundle(t), `{"id":"dash-builder",`, `{"id":7,`, 1)
	if ids, _ := unreadableEvaluable(good, load(noID)); !slices.Equal(ids, []string{"dash-builder", "guide-routes"}) {
		t.Fatalf("with an achievement skipped by no readable id, absent definitions must count as unreadable: %v", ids)
	}
	entity := strings.Replace(achievementsTestBundleJSON, `"search":{"actions":{"performed":{"context":{}}}}`, `"search":{"actions":7}`, 1)
	if _, actions := unreadableEvaluable(good, load(entity)); !slices.Equal(actions, []string{"search.performed"}) {
		t.Fatalf("an unreadable entity must count its evaluable actions: %v", actions)
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

const achievementsTestBundleJSON = `{"grammar":"1.0","registry":{"entities":{
  "dashboards":{"actions":{"created":{
    "context":{"resourceId":{"type":"string"},"numPanels":{"type":"number"}},
    "resources":[{"unit":"dashboard","id":["resourceId"]}],
    "sources":[{"interaction":"grafana_dashboard_created","emitter":"grafana","versions":">=13.2.0",
      "when":[{"property":"result","op":"eq","value":"success"}],
      "context":{"resourceId":"uid","numPanels":"numPanels"},"owner":"@grafana/dashboards-squad"}]}}},
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

func loadAchievementsTestBundle(t *testing.T, body string) *achievements.Snapshot {
	t.Helper()
	snapshot, err := achievements.LoadBundle([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

type capturingLogger struct {
	lines *[]capturedLine
}

type capturedLine struct {
	level string
	msg   string
}

func newCapturingLogger() capturingLogger {
	return capturingLogger{lines: &[]capturedLine{}}
}

func (l capturingLogger) record(level, msg string) {
	*l.lines = append(*l.lines, capturedLine{level: level, msg: msg})
}

// warnedWith reports whether any captured warn line's message contains substr.
func (l capturingLogger) warnedWith(substr string) bool {
	for _, line := range *l.lines {
		if line.level == "warn" && strings.Contains(line.msg, substr) {
			return true
		}
	}
	return false
}

func (l capturingLogger) Debug(msg string, _ ...interface{}) { l.record("debug", msg) }
func (l capturingLogger) Info(msg string, _ ...interface{})  { l.record("info", msg) }
func (l capturingLogger) Warn(msg string, _ ...interface{})  { l.record("warn", msg) }
func (l capturingLogger) Error(msg string, _ ...interface{}) { l.record("error", msg) }
func (l capturingLogger) With(_ ...interface{}) log.Logger   { return l }
func (l capturingLogger) Level() log.Level                   { return log.Debug }
func (l capturingLogger) FromContext(_ context.Context) log.Logger {
	return l
}

type diagnosticLogger struct {
	capturingLogger
	fields []interface{}
}

func (l *diagnosticLogger) Warn(msg string, fields ...interface{}) {
	l.capturingLogger.Warn(msg, fields...)
	l.fields = fields
}

func (l *diagnosticLogger) FromContext(context.Context) log.Logger { return l }

const liveSourceBlock = `,
    "sources":[{"interaction":"grafana_dashboard_created","emitter":"grafana","versions":">=13.2.0",
      "when":[{"property":"result","op":"eq","value":"success"}],
      "context":{"resourceId":"uid","numPanels":"numPanels"},"owner":"@grafana/dashboards-squad"}]`

func TestDefinitionsSource_RejectsARefreshThatBreaksALiveSource(t *testing.T) {
	if !strings.Contains(achievementsTestBundleJSON, liveSourceBlock) {
		t.Fatal("the test bundle no longer carries the live source this test edits")
	}
	cdn := newDefinitionsCDN(t)
	source, clock := newTestDefinitionsSource(t, cdn)
	logger := &diagnosticLogger{capturingLogger: newCapturingLogger()}
	source.logger = logger
	first, _ := source.Snapshot(context.Background())

	broken := strings.Replace(achievementsTestBundleJSON, `"owner":"@grafana/dashboards-squad"`, `"owner":"nobody"`, 1)
	cdn.answer(http.StatusOK, broken, `W/"broken-source"`)
	clock.advance(definitionsRevalidateAfter)
	source.Snapshot(context.Background())
	settle(t, source)
	if source.current.Load() != first || !logger.warnedWith(msgDefinitionsRefreshRejected) {
		t.Fatal("a refresh that cannot read a live source replaced the last good copy")
	}
	if got := warnFields(logger)["unreadableSources"]; !slices.Equal(got.([]string), []string{"grafana_dashboard_created"}) {
		t.Fatalf("unreadableSources = %v", got)
	}

	removed := strings.Replace(achievementsTestBundleJSON, liveSourceBlock, "", 1)
	cdn.answer(http.StatusOK, removed, `W/"removed-source"`)
	clock.advance(definitionsBackoffMax + definitionsRevalidateAfter)
	source.Snapshot(context.Background())
	settle(t, source)
	if next := source.current.Load(); next == first || len(next.Registry.SourceNames()) != 0 {
		t.Fatal("a refresh that deliberately removes a source was not swapped in")
	}
}

func TestUnreadableSources_CountsAnUnnamedSkipAgainstEveryMissingSource(t *testing.T) {
	good := loadAchievementsTestBundle(t, achievementsTestBundleJSON)
	unnamed, err := achievements.LoadBundle([]byte(strings.Replace(achievementsTestBundleJSON, `"interaction":"grafana_dashboard_created"`, `"interaction":7`, 1)))
	if err != nil {
		t.Fatal(err)
	}
	if got := unreadableSources(good, unnamed); !slices.Equal(got, []string{"grafana_dashboard_created"}) {
		t.Fatalf("unreadableSources = %v", got)
	}
	if got := unreadableSources(good, good); len(got) != 0 {
		t.Fatalf("an unchanged bundle reported %v", got)
	}
}
