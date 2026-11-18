package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

const achievementOtherUser = "user:99"

// namedOnlyAPI fails any request that is not addressed to one object, so a
// namespace-wide LIST cannot pass for a name-addressed read.
type namedOnlyAPI struct {
	t   *testing.T
	api *fakeAchievementAPI

	mu    sync.Mutex
	paths []string
}

func (n *namedOnlyAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	prefix := "/apis/" + achievementGroupVersion + "/namespaces/" + achievementTestNamespace + "/"
	resource, name, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, prefix), "/")
	if r.Method == http.MethodGet && name == "" {
		n.t.Errorf("namespace-wide %s %s", r.Method, r.URL.Path)
		http.Error(w, "list is not granted", http.StatusForbidden)
		return
	}
	n.mu.Lock()
	n.paths = append(n.paths, r.Method+" "+resource+"/"+name)
	n.mu.Unlock()
	n.api.ServeHTTP(w, r)
}

func (n *namedOnlyAPI) gets(resource string) []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	var out []string
	for _, p := range n.paths {
		if rest, ok := strings.CutPrefix(p, "GET "+resource+"/"); ok {
			out = append(out, rest)
		}
	}
	return out
}

func newAchievementTestReader(t *testing.T) (*achievementNameReader, *namedOnlyAPI) {
	t.Helper()
	named := &namedOnlyAPI{t: t, api: newFakeAchievementAPI(t)}
	srv := httptest.NewServer(named)
	t.Cleanup(srv.Close)
	client := newAppPlatformListClient(srv.URL, &stubMinter{token: achievementTestToken}, "id-token", log.DefaultLogger)
	store := newAchievementStore(client, achievementWriter{Namespace: achievementTestNamespace, OrgID: 1}, func() time.Time { return achievementTestNow })
	catalog := loadAchievementsTestBundle(t, achievementsTestBundleJSON).Catalog
	return &achievementNameReader{store: store, catalog: catalog, now: func() time.Time { return achievementTestNow }}, named
}

func seedAchievementProgress(api *fakeAchievementAPI, user, achievementID string, tierIDs ...string) {
	if tierIDs == nil {
		tierIDs = []string{}
	}
	api.seed(achievementProgressResource, achievementProgressName(user, achievementID), map[string]any{
		"achievementId": achievementID, "tierIds": tierIDs, "units": []string{"unit-a"},
		"updatedAt": "2026-11-02T08:30:00Z", "userId": user, "orgId": 1, "stackNamespace": achievementTestNamespace, "schemaVersion": 1,
	})
}

func seedAchievementAward(api *fakeAchievementAPI, user, achievementID, tierID string) {
	api.seed(achievementAwardResource, achievementAwardName(user, achievementID, tierID), map[string]any{
		"achievementId": achievementID, "tierId": tierID, "entity": "dashboards", "earnedAt": "2026-11-02T08:30:00Z",
		"userId": user, "orgId": 1, "stackNamespace": achievementTestNamespace, "schemaVersion": 1,
	})
}

func awardKeys(rows achievements.Rows) []string {
	keys := make([]string, 0, len(rows.Awards))
	for _, a := range rows.Awards {
		keys = append(keys, a.AchievementID+"/"+a.TierID)
	}
	return keys
}

func TestAchievementNameReader_ReadsOnlyTheCallersRowsByName(t *testing.T) {
	reader, named := newAchievementTestReader(t)
	seedAchievementProgress(named.api, achievementTestPerson.ID, "dash-builder", "bronze")
	seedAchievementAward(named.api, achievementTestPerson.ID, "dash-builder", "bronze")
	seedAchievementProgress(named.api, achievementOtherUser, "dash-builder", "bronze", "silver")
	seedAchievementAward(named.api, achievementOtherUser, "dash-builder", "silver")
	seedAchievementProgress(named.api, achievementOtherUser, "guide-routes", "intro")
	seedAchievementAward(named.api, achievementOtherUser, "guide-routes", "intro")

	rows, err := reader.ListMine(context.Background(), achievementTestPerson)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(awardKeys(rows), ","); got != "dash-builder/bronze" {
		t.Errorf("awards = %s, want only the caller's", got)
	}
	if len(rows.Progress) != 1 || rows.Progress[0].AchievementID != "dash-builder" || rows.Progress[0].Units[0] != "unit-a" {
		t.Errorf("progress = %+v", rows.Progress)
	}
	if !rows.AsOf.Equal(achievementTestNow) || rows.Truncated {
		t.Errorf("asOf %v truncated %v", rows.AsOf, rows.Truncated)
	}

	wantProgress := map[string]bool{
		achievementProgressName(achievementTestPerson.ID, "dash-builder"): true,
		achievementProgressName(achievementTestPerson.ID, "guide-routes"): true,
	}
	wantAwards := map[string]bool{}
	for _, tier := range []string{"bronze", "silver", "gold"} {
		wantAwards[achievementAwardName(achievementTestPerson.ID, "dash-builder", tier)] = true
	}
	wantAwards[achievementAwardName(achievementTestPerson.ID, "guide-routes", "intro")] = true
	for resource, want := range map[string]map[string]bool{achievementProgressResource: wantProgress, achievementAwardResource: wantAwards} {
		got := named.gets(resource)
		if len(got) != len(want) {
			t.Errorf("%s GETs = %v, want one per name in %v", resource, got, want)
		}
		for _, name := range got {
			if !want[name] {
				t.Errorf("GET %s/%s is not one of the caller's names", resource, name)
			}
		}
	}
}

// The evaluator creates an award before it saves the progress row naming it,
// so a failed save leaves the award with a row that is behind or absent.
func TestAchievementNameReader_FindsAwardsTheProgressRowDoesNotName(t *testing.T) {
	t.Run("row behind", func(t *testing.T) {
		reader, named := newAchievementTestReader(t)
		seedAchievementProgress(named.api, achievementTestPerson.ID, "dash-builder", "bronze")
		seedAchievementAward(named.api, achievementTestPerson.ID, "dash-builder", "bronze")
		seedAchievementAward(named.api, achievementTestPerson.ID, "dash-builder", "silver")

		rows, err := reader.ListMine(context.Background(), achievementTestPerson)
		if err != nil {
			t.Fatal(err)
		}
		if got := strings.Join(awardKeys(rows), ","); got != "dash-builder/bronze,dash-builder/silver" {
			t.Errorf("awards = %s", got)
		}
		if len(rows.Progress) != 1 || strings.Join(rows.Progress[0].TierIDs, ",") != "bronze" {
			t.Errorf("progress = %+v, want the row as stored", rows.Progress)
		}
	})
	t.Run("row missing", func(t *testing.T) {
		reader, named := newAchievementTestReader(t)
		seedAchievementAward(named.api, achievementTestPerson.ID, "guide-routes", "intro")

		rows, err := reader.ListMine(context.Background(), achievementTestPerson)
		if err != nil {
			t.Fatal(err)
		}
		if got := strings.Join(awardKeys(rows), ","); got != "guide-routes/intro" {
			t.Errorf("awards = %s", got)
		}
		if len(rows.Progress) != 0 {
			t.Errorf("progress = %+v, want none", rows.Progress)
		}
	})
}

func TestAchievementNameReader_ReadsTiersTheCatalogNoLongerDefines(t *testing.T) {
	reader, named := newAchievementTestReader(t)
	seedAchievementProgress(named.api, achievementTestPerson.ID, "dash-builder", "bronze", "platinum", "retired")
	seedAchievementAward(named.api, achievementTestPerson.ID, "dash-builder", "bronze")
	seedAchievementAward(named.api, achievementTestPerson.ID, "dash-builder", "platinum")

	rows, err := reader.ListMine(context.Background(), achievementTestPerson)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(awardKeys(rows), ","); got != "dash-builder/bronze,dash-builder/platinum" {
		t.Errorf("awards = %s, want the held tier the catalog lacks and no award for one never created", got)
	}
	if got := len(named.gets(achievementAwardResource)); got != 6 {
		t.Errorf("award GETs = %d, want 6: three catalog tiers, two the catalog lacks, one for guide-routes, each once", got)
	}
}

func TestAchievementNameReader_Unavailable(t *testing.T) {
	cases := []struct {
		name   string
		fail   string
		status int
	}{
		{"progress read fails", "GET " + achievementProgressResource, http.StatusServiceUnavailable},
		{"award read fails", "GET " + achievementAwardResource, http.StatusServiceUnavailable},
		{"award read forbidden", "GET " + achievementAwardResource, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reader, named := newAchievementTestReader(t)
			seedAchievementProgress(named.api, achievementTestPerson.ID, "dash-builder", "bronze")
			seedAchievementAward(named.api, achievementTestPerson.ID, "dash-builder", "bronze")
			named.api.mu.Lock()
			named.api.failNext[tc.fail] = tc.status
			named.api.mu.Unlock()

			_, err := reader.ListMine(context.Background(), achievementTestPerson)
			if status, ok := upstreamStatusOf(err); !ok || status != tc.status {
				t.Fatalf("err = %v, want upstream %d", err, tc.status)
			}
		})
	}
	t.Run("kind not served", func(t *testing.T) {
		reader, named := newAchievementTestReader(t)
		named.api.mu.Lock()
		delete(named.api.schemas, achievementAwardResource)
		named.api.mu.Unlock()
		if _, err := reader.ListMine(context.Background(), achievementTestPerson); err == nil {
			t.Fatal("a group that does not serve awards read as holding none")
		}
	})
	t.Run("award stored under the caller's name for someone else", func(t *testing.T) {
		reader, named := newAchievementTestReader(t)
		named.api.seed(achievementAwardResource, achievementAwardName(achievementTestPerson.ID, "dash-builder", "bronze"), map[string]any{
			"achievementId": "dash-builder", "tierId": "bronze", "entity": "dashboards", "earnedAt": "2026-11-02T08:30:00Z",
			"userId": achievementOtherUser, "orgId": 1, "stackNamespace": achievementTestNamespace, "schemaVersion": 1,
		})
		if _, err := reader.ListMine(context.Background(), achievementTestPerson); !errors.Is(err, errAchievementRowMismatch) {
			t.Fatalf("err = %v, want errAchievementRowMismatch", err)
		}
	})
}

func achievementsBackendRequest(t *testing.T, cfg map[string]string, token string) *http.Request {
	t.Helper()
	r, _ := http.NewRequest(http.MethodGet, achievementsRoutePrefix+"/my", nil)
	r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, token)
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{OrgID: 3, Namespace: testNamespace}) //nolint:staticcheck // the CRD stamps the numeric orgId the plugin context still carries
	ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(cfg))
	return r.WithContext(ctx)
}

func TestBuildAchievementsBackend_Unavailable(t *testing.T) {
	catalog := loadAchievementsTestBundle(t, achievementsTestBundleJSON).Catalog
	token := makeValidIDToken(t, achievementsTestUser)
	person := achievements.Person{ID: achievementsTestUser}

	_, reason := newTestApp(t).buildAchievementsBackend(achievementsBackendRequest(t, testGrafanaConfig(), token), person, catalog)
	if reason != reasonOBOUnavailable {
		t.Errorf("no OBO: reason %q, want %q", reason, reasonOBOUnavailable)
	}
	_, reason = newTestAppWithOBO(t).buildAchievementsBackend(achievementsBackendRequest(t, map[string]string{sdkconfig.AppURL: testSigningKeysURL()}, token), person, catalog)
	if reason != reasonBackendUnavailable {
		t.Errorf("toggle off: reason %q, want %q", reason, reasonBackendUnavailable)
	}
}

// The handler has verified the token by the time the builder runs; an expired
// token here proves the builder does not verify it a second time.
func TestBuildAchievementsBackend_TakesTheVerifiedPersonAndStampsTheProfile(t *testing.T) {
	catalog := loadAchievementsTestBundle(t, achievementsTestBundleJSON).Catalog
	expired := makeIDTokenWithProfile(t, achievementsTestUser, time.Now().Add(-time.Hour).Unix(), "ada", "Ada L")
	built, reason := newTestAppWithOBO(t).buildAchievementsBackend(achievementsBackendRequest(t, testGrafanaConfig(), expired), achievements.Person{ID: achievementsTestUser}, catalog)
	if reason != "" {
		t.Fatalf("reason %q", reason)
	}
	store, ok := built.store.(*achievementStore)
	if !ok {
		t.Fatalf("store = %T", built.store)
	}
	want := achievementWriter{Namespace: testNamespace, OrgID: 3, UserLogin: "ada", UserDisplayName: "Ada L"}
	if store.writer != want {
		t.Errorf("writer = %+v, want %+v", store.writer, want)
	}
	reader, ok := built.reader.(*achievementNameReader)
	if !ok || reader.store != store || reader.catalog != catalog {
		t.Errorf("reader = %#v, want the request's store and catalog", built.reader)
	}
}

func TestAchievementRoutes_WiredBackendAwardsAndReadsBack(t *testing.T) {
	withFrozenTime(t, time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC))
	api := newFakeAchievementAPI(t)
	var listed bool
	mux := http.NewServeMux()
	mux.HandleFunc(auth.SigningKeysPath, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(jwksBody(testSigningKeyID, testSigningKey()))
	})
	mux.HandleFunc("/mint", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"data":{"token":%q}}`, achievementTestToken)
	})
	mux.HandleFunc("/apis/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.Count(strings.TrimPrefix(r.URL.Path, "/apis/"+achievementGroupVersion+"/namespaces/"), "/") < 2 {
			listed = true
		}
		api.ServeHTTP(w, r)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	app := newAchievementsTestApp(t, nil)
	exchanger, err := auth.New("cap-token", server.URL+"/mint")
	if err != nil {
		t.Fatal(err)
	}
	app.oboExchanger = exchanger
	app.achievementsBackendFor = app.buildAchievementsBackend
	cfg := testGrafanaConfig()
	cfg[sdkconfig.AppURL] = server.URL
	token := makeValidIDTokenWithProfile(t, achievementsTestUser, "ada", "Ada L")
	send := func(method, path, body string) *httptest.ResponseRecorder {
		r := achievementsBackendRequest(t, cfg, token)
		r.Method, r.URL.Path = method, achievementsRoutePrefix+path
		r.Body = http.NoBody
		if body != "" {
			r.Body = io.NopCloser(strings.NewReader(body))
		}
		rr := httptest.NewRecorder()
		if method == http.MethodPost {
			app.handleAchievementEvent(rr, r)
		} else {
			app.handleMyAchievements(rr, r)
		}
		return rr
	}

	rr := send(http.MethodPost, "/events", dashboardEventBody("evt-1", "uid-a"))
	if rr.Code != http.StatusOK {
		t.Fatalf("event: status %d body %s", rr.Code, rr.Body.String())
	}
	if events := decodeEvents(t, rr); events.Retry || len(events.Decisions) != 1 || strings.Join(events.Decisions[0].Awarded, ",") != "bronze" {
		t.Fatalf("event = %+v", events)
	}
	award := api.spec(achievementAwardResource, achievementAwardName(achievementsTestUser, "dash-builder", "bronze"))
	if award["userId"] != achievementsTestUser || award["userLogin"] != "ada" || award["userDisplayName"] != "Ada L" || award["orgId"] != 3.0 {
		t.Errorf("stored award = %+v", award)
	}

	rr = send(http.MethodGet, "/my", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("my: status %d body %s", rr.Code, rr.Body.String())
	}
	var my myAchievementsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &my); err != nil {
		t.Fatal(err)
	}
	if !my.Capability.Available || len(my.Awards) != 1 || my.Awards[0].TierID != "bronze" || len(my.Progress) != 1 || my.Progress[0].Units != 1 {
		t.Fatalf("my = %+v", my)
	}
	if listed {
		t.Error("the wired routes issued a namespace-wide read")
	}
}
