package achievements

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

const dashboardCreatedSource = `{"interaction":"grafana_dashboard_created","emitter":"grafana","versions":">=13.2.0",
  "when":[{"property":"result","op":"eq","value":"success"}],
  "context":{"resourceId":"uid","numPanels":"numPanels"},"owner":"@grafana/dashboards-squad"}`

const dashboardSavedSource = `{"interaction":"grafana_dashboard_saved","emitter":"grafana","versions":">=14.0.0",
  "when":[{"property":"isNew","op":"eq","value":true}],
  "context":{"resourceId":"dashboardUid"},"owner":"@grafana/dashboards-squad","silent":true}`

func sourcesRegistryJSON(dashboardSources, alertSources string) string {
	return `{"entities":{
  "dashboards":{"actions":{"created":{
    "context":{"resourceId":{"type":"string"},"numPanels":{"type":"number"}},
    "resources":[{"unit":"dashboard","id":["resourceId"]}],
    "sources":[` + dashboardSources + `]}}},
  "alert-rules":{"actions":{"created":{"context":{"ruleType":{"type":"string"}},"sources":[` + alertSources + `]}}},
  "guides":{"actions":{"completed":{"context":{"guideId":{"type":"string"}},"resources":[{"unit":"guide","id":["guideId"]}]}}}
}}`
}

const alertCreatedSource = `{"interaction":"grafana_alerting_rule_created","emitter":"grafana-alerting-app","versions":">=1.0.0",
  "when":[{"property":"formAction","op":"in","value":["create","duplicate"]}],
  "context":{"ruleType":"ruleType"},"owner":"@grafana/alerting-squad"}`

func mustSourcesRegistry(t *testing.T) *Registry {
	t.Helper()
	r, err := loadRegistry([]byte(sourcesRegistryJSON(dashboardCreatedSource+","+dashboardSavedSource, alertCreatedSource)))
	if err != nil {
		t.Fatalf("sources registry: %v", err)
	}
	return r
}

func TestLoadRegistryReadsSources(t *testing.T) {
	r := mustSourcesRegistry(t)
	a, _ := r.action("dashboards", "created")
	if len(a.Sources) != 2 || a.Sources[0].Interaction != "grafana_dashboard_created" || !a.Sources[1].Silent {
		t.Fatalf("sources = %+v", a.Sources)
	}
	got := r.Subscriptions(Stack{})
	want := []SourceSubscription{
		{Interaction: "grafana_alerting_rule_created", Properties: []string{"formAction", "ruleType"},
			When: []SourceCondition{{Property: "formAction", Op: "in", Value: []any{"create", "duplicate"}}}},
		{Interaction: "grafana_dashboard_created", Properties: []string{"numPanels", "result", "uid"},
			When: []SourceCondition{{Property: "result", Op: "eq", Value: "success"}}},
		{Interaction: "grafana_dashboard_saved", Properties: []string{"dashboardUid", "isNew"},
			When: []SourceCondition{{Property: "isNew", Op: "eq", Value: true}}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("subscriptions:\n got %+v\nwant %+v", got, want)
	}
}

func TestLoadRegistryRejectsInvalidSources(t *testing.T) {
	src := func(mutate string) string {
		return strings.Replace(dashboardCreatedSource, `"owner":"@grafana/dashboards-squad"`, mutate, 1)
	}
	cases := []struct{ name, dashboards, alerts, want string }{
		{"unknown key", src(`"owner":"@grafana/dashboards-squad","expression":"uid"`), "", `unknown field "expression"`},
		{"undeclared context field", src(`"owner":"@grafana/dashboards-squad","context":{"title":"title"}`), "", `context field "title" is not declared`},
		{"object mapping", src(`"owner":"@grafana/dashboards-squad","context":{"resourceId":{"from":"uid"}}`), "", "cannot unmarshal object"},
		{"number mapping", src(`"owner":"@grafana/dashboards-squad","context":{"numPanels":2}`), "", "cannot unmarshal number"},
		{"property name", src(`"owner":"@grafana/dashboards-squad","context":{"resourceId":"dashboard.uid"}`), "", `context field "resourceId" must name one event property`},
		{"no owner", src(`"silent":false`), "", "owner must be a team handle"},
		{"owner shape", src(`"owner":"dashboards"`), "", "owner must be a team handle"},
		{"interaction", strings.Replace(dashboardCreatedSource, "grafana_dashboard_created", "grafana dashboard created", 1), "", "interaction must be an Echo interaction name"},
		{"emitter", strings.Replace(dashboardCreatedSource, `"emitter":"grafana"`, `"emitter":"Grafana Labs"`, 1), "", `emitter must be "grafana" or a plugin id`},
		{"no versions", strings.Replace(dashboardCreatedSource, `"versions":">=13.2.0",`, "", 1), "", "versions must be 1 to 4"},
		{"version expression", strings.Replace(dashboardCreatedSource, `>=13.2.0`, `^13.2.0 || >=14`, 1), "", "is not one of >="},
		{"pre-release version", strings.Replace(dashboardCreatedSource, `>=13.2.0`, `>=13.2.0-0`, 1), "", "is not one of >="},
		{"when op", strings.Replace(dashboardCreatedSource, `"op":"eq"`, `"op":"gte"`, 1), "", `op "gte" is not eq or in`},
		{"when value", strings.Replace(dashboardCreatedSource, `"value":"success"`, `"value":{"ok":true}`, 1), "", "eq takes a string, number, or boolean"},
		{"when in scalar", strings.Replace(dashboardCreatedSource, `"op":"eq","value":"success"`, `"op":"in","value":"success"`, 1), "", "in takes a list of 1 to 16"},
		{"when property", strings.Replace(dashboardCreatedSource, `"property":"result"`, `"property":"re sult"`, 1), "", "property must match"},
		{"same interaction twice", dashboardCreatedSource, strings.Replace(alertCreatedSource, "grafana_alerting_rule_created", "grafana_dashboard_created", 1), "declared by 2 sources"},
		{"several sources and no resource", dashboardCreatedSource, alertCreatedSource + "," + strings.Replace(alertCreatedSource, "rule_created", "rule_saved", 1), "several sources must count by resource"},
		{"resource id not mapped", strings.Replace(dashboardCreatedSource, `"context":{"resourceId":"uid","numPanels":"numPanels"}`, `"context":{"numPanels":"numPanels"}`, 1), "", `context must map "resourceId", an id field of the pair's default resource "dashboard"`},
		{"sources not a list", "", "", "resources and sources lists"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := sourcesRegistryJSON(tc.dashboards, tc.alerts)
			if tc.name == "sources not a list" {
				data = `{"entities":{"a":{"actions":{"b":{"context":{},"sources":{"interaction":"x"}}}}}}`
			}
			_, err := loadRegistry([]byte(data))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestASourceWithNoMappingListsAnEmptyPropertyList(t *testing.T) {
	bare := `{"interaction":"grafana_alerting_grafana_rule_creation_new_success","emitter":"grafana","versions":">=13.2.0","owner":"@grafana/alerting-squad"}`
	r, err := loadRegistry([]byte(sourcesRegistryJSON(dashboardCreatedSource, bare)))
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(r.Subscriptions(Stack{}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `{"interaction":"grafana_alerting_grafana_rule_creation_new_success","properties":[]}`) {
		t.Errorf("subscriptions = %s, want an empty properties array, never null", data)
	}
}

func TestLoadBundleSkipsOnlyTheSourcesItCannotRead(t *testing.T) {
	bad := strings.Replace(dashboardSavedSource, `"owner":"@grafana/dashboards-squad"`, `"owner":"nobody"`, 1)
	clash := strings.Replace(alertCreatedSource, "grafana_alerting_rule_created", "grafana_dashboard_created", 1)
	registry := sourcesRegistryJSON(dashboardCreatedSource+","+bad+`,{"interaction":7}`, clash)
	data := []byte(`{"grammar":"1.0","registry":` + registry + `,"catalog":{"achievements":[
  {"id":"dash-builder","title":"T","description":"D.","counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},"tiers":[{"id":"bronze","at":1}]}]}}`)
	s, err := LoadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, skip := range s.Skipped {
		got = append(got, skip.What+" "+skip.ID)
	}
	want := []string{"source grafana_dashboard_saved", "source dashboards.created#2", "source grafana_dashboard_created", "source grafana_dashboard_created"}
	if strings.Join(got, "; ") != strings.Join(want, "; ") {
		t.Errorf("skipped:\n got %v\nwant %v", got, want)
	}
	if _, ok := s.Registry.action("dashboards", "created"); !ok {
		t.Error("a bad source took its pair down")
	}
	if subs := s.Registry.Subscriptions(Stack{}); len(subs) != 0 {
		t.Errorf("subscriptions = %+v, want none: the clash drops every claim", subs)
	}
	if len(s.Catalog.Achievements) != 1 {
		t.Errorf("evaluable = %d, want dash-builder", len(s.Catalog.Achievements))
	}
}

func TestCatalogRejectsOccurrenceCountsOnAPairWithSeveralSources(t *testing.T) {
	r := mustSourcesRegistry(t)
	catalog := `{"achievements":[{"id":"dash-count","title":"T","description":"D.",
  "counter":{"unit":"occurrence","evidence":[{"entity":"dashboards","action":"created","countBy":"occurrence"}]},
  "tiers":[{"id":"bronze","at":1}]}]}`
	_, err := loadCatalog([]byte(catalog), r)
	if err == nil || !strings.Contains(err.Error(), "has 2 sources, so count it by resource") {
		t.Fatalf("err = %v", err)
	}
	single := `{"achievements":[{"id":"alert-count","title":"T","description":"D.",
  "counter":{"unit":"occurrence","evidence":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]},
  "tiers":[{"id":"bronze","at":1}]}]}`
	if _, err := loadCatalog([]byte(single), r); err != nil {
		t.Fatalf("one source may count by occurrence: %v", err)
	}
}

func sourceEvent(id, source string, props map[string]any) EventRequest {
	return EventRequest{SchemaVersion: 1, EventID: id, Source: source, OccurredAt: fixedNow.UTC().Format(time.RFC3339), Properties: props}
}

func TestNewEventMapsASourceToItsPair(t *testing.T) {
	r := mustSourcesRegistry(t)
	ev, err := r.NewEvent(sourceEvent("e1", "grafana_dashboard_created", map[string]any{"uid": "abc", "numPanels": float64(3), "result": "success"}), fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"resourceId": "abc", "numPanels": float64(3)}
	if ev.ID != "e1" || ev.Entity != "dashboards" || ev.Action != "created" || !reflect.DeepEqual(ev.Context, want) {
		t.Fatalf("event = %+v", ev)
	}

	ev, err = r.NewEvent(sourceEvent("e2", "grafana_dashboard_created", map[string]any{"result": "success"}), fixedNow)
	if err != nil || len(ev.Context) != 0 {
		t.Fatalf("a property the event lacks is left out of the context: %+v %v", ev, err)
	}
}

func TestNewEventRejectsSourceEvents(t *testing.T) {
	r := mustSourcesRegistry(t)
	ok := map[string]any{"uid": "abc", "result": "success"}
	cases := []struct {
		name string
		req  EventRequest
		want string
	}{
		{"unknown source", sourceEvent("e", "grafana_dashboard_deleted", ok), `source "grafana_dashboard_deleted" is not declared`},
		{"no source name", sourceEvent("e", "", ok), `source "" is not declared`},
		{"unlisted property", sourceEvent("e", "grafana_dashboard_created", map[string]any{"uid": "abc", "result": "success", "title": "Prod"}), `property "title" is not one source`},
		{"object property", sourceEvent("e", "grafana_dashboard_created", map[string]any{"uid": map[string]any{"v": 1}, "result": "success"}), `property "uid" is not a string`},
		{"null property", sourceEvent("e", "grafana_dashboard_created", map[string]any{"uid": nil, "result": "success"}), `property "uid" is not a string`},
		{"mapped type mismatch", sourceEvent("e", "grafana_dashboard_created", map[string]any{"uid": "abc", "numPanels": "3", "result": "success"}), `context field "numPanels" is not a number`},
		{"pair and source", func() EventRequest {
			req := sourceEvent("e", "grafana_dashboard_created", ok)
			req.Entity, req.Action = "dashboards", "created"
			return req
		}(), "a pair or a source, not both"},
		{"bad event id", sourceEvent("", "grafana_dashboard_created", ok), "eventId must be"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := r.NewEvent(tc.req, fixedNow)
			if !errors.Is(err, ErrInvalidEvent) || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want an invalid event mentioning %q", err, tc.want)
			}
		})
	}
}

func TestNewEventDoesNotCountAVariantOutsideWhen(t *testing.T) {
	r := mustSourcesRegistry(t)
	for name, props := range map[string]map[string]any{
		"other value":      {"uid": "abc", "result": "failure"},
		"missing property": {"uid": "abc"},
		"outside in list":  {"formAction": "update"},
	} {
		t.Run(name, func(t *testing.T) {
			source := "grafana_dashboard_created"
			if _, isAlert := props["formAction"]; isAlert {
				source = "grafana_alerting_rule_created"
			}
			_, err := r.NewEvent(sourceEvent("e", source, props), fixedNow)
			if !errors.Is(err, ErrNotCounted) || errors.Is(err, ErrInvalidEvent) {
				t.Errorf("err = %v, want ErrNotCounted", err)
			}
		})
	}
	if _, err := r.NewEvent(sourceEvent("e", "grafana_alerting_rule_created", map[string]any{"formAction": "duplicate"}), fixedNow); err != nil {
		t.Errorf("an in-list variant counts: %v", err)
	}
}

func TestTwoSourcesForOnePairCountOneUnit(t *testing.T) {
	r := mustSourcesRegistry(t)
	catalog, err := loadCatalog([]byte(`{"achievements":[{"id":"dash-builder","title":"T","description":"D.",
  "counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
  "tiers":[{"id":"bronze","at":1},{"id":"silver","at":2}]}]}`), r)
	if err != nil {
		t.Fatal(err)
	}
	ev := NewEvaluator(catalog, newFakeStore(), &fakePolicy{}, func() time.Time { return fixedNow })
	post := func(req EventRequest) Decision {
		t.Helper()
		event, err := r.NewEvent(req, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		decisions, err := ev.Evaluate(context.Background(), testPerson, event)
		if err != nil || len(decisions) != 1 {
			t.Fatalf("decisions = %+v err = %v", decisions, err)
		}
		return decisions[0]
	}
	first := post(sourceEvent("old-name", "grafana_dashboard_created", map[string]any{"uid": "abc", "result": "success"}))
	second := post(sourceEvent("new-name", "grafana_dashboard_saved", map[string]any{"dashboardUid": "abc", "isNew": true}))
	if first.Decision != KindAward || second.Decision != KindIgnored || second.Reason != ReasonDuplicate || second.Units != 1 {
		t.Errorf("first %+v second %+v, want one unit and a duplicate", first, second)
	}
}

func TestVersionRanges(t *testing.T) {
	for _, tc := range []struct {
		versions, stack string
		want            bool
	}{
		{">=13.2.0", "13.2.0", true},
		{">=13.2.0", "13.2.0-12345", true},
		{">=13.2.0", "13.1.9", false},
		{">=13.2.0 <14.0.0", "13.10.1", true},
		{">=13.2.0 <14.0.0", "14.0.0", false},
		{">13.2.0", "13.2.0", false},
		{"<=13.2.0", "13.2.0", true},
		{"=13.2.4", "13.2.4+security-01", true},
		{"=13.2.4", "13.2.5", false},
		{">=13.2.0", "", true},
		{">=13.2.0", "unknown", true},
	} {
		t.Run(tc.versions+" on "+tc.stack, func(t *testing.T) {
			r, err := parseVersionRange(tc.versions)
			if err != nil {
				t.Fatal(err)
			}
			if got := (Stack{GrafanaVersion: tc.stack}).emits(&Source{Emitter: emitterGrafana, versions: r}); got != tc.want {
				t.Errorf("emits = %v, want %v", got, tc.want)
			}
		})
	}
	for _, bad := range []string{"", " >=13.2.0", ">=13.2", "~13.2.0", ">=13.2.0 || <12.0.0", ">=v13.2.0", ">=13.2.0  <14.0.0", ">=1.0.0 >=1.0.0 >=1.0.0 >=1.0.0 >=1.0.0"} {
		if _, err := parseVersionRange(bad); err == nil {
			t.Errorf("parseVersionRange(%q) accepted", bad)
		}
	}
}

func TestSubscriptionsAndEarnabilityFollowTheStackVersion(t *testing.T) {
	registry := sourcesRegistryJSON(dashboardCreatedSource+","+dashboardSavedSource, alertCreatedSource)
	data := []byte(`{"grammar":"1.0","registry":` + registry + `,"catalog":{"achievements":[
  {"id":"dash-builder","title":"T","description":"D.","counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},"tiers":[{"id":"bronze","at":1}]},
  {"id":"alert-starter","title":"T","description":"D.","counter":{"unit":"occurrence","evidence":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]},"tiers":[{"id":"bronze","at":1}]},
  {"id":"guide-finisher","title":"T","description":"D.","counter":{"unit":"guide","evidence":[{"entity":"guides","action":"completed","countBy":"resource"}]},"tiers":[{"id":"bronze","at":1}]},
  {"id":"mixed","title":"T","description":"D.","counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},"tiers":[{"id":"bronze","at":1,"or":[{"entity":"guides","action":"completed"}]}]},
  {"id":"broken","title":"T","description":"D.","streak":1,"tiers":[{"id":"bronze","at":1}]}]}}`)
	s, err := LoadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	summary := func(stack Stack) string {
		var names []string
		for _, sub := range s.Registry.Subscriptions(stack) {
			names = append(names, sub.Interaction)
		}
		var earnable []string
		for _, d := range s.DisplayFor(stack) {
			earnable = append(earnable, fmt.Sprintf("%s=%v", d.ID, d.Earnable))
		}
		return strings.Join(names, ",") + " | " + strings.Join(earnable, ",")
	}
	for stack, want := range map[string]string{
		"13.1.0":       "grafana_alerting_rule_created | dash-builder=false,alert-starter=true,guide-finisher=true,mixed=true,broken=false",
		"13.2.0-90577": "grafana_alerting_rule_created,grafana_dashboard_created | dash-builder=true,alert-starter=true,guide-finisher=true,mixed=true,broken=false",
		"14.1.0":       "grafana_alerting_rule_created,grafana_dashboard_created,grafana_dashboard_saved | dash-builder=true,alert-starter=true,guide-finisher=true,mixed=true,broken=false",
		"":             "grafana_alerting_rule_created,grafana_dashboard_created,grafana_dashboard_saved | dash-builder=true,alert-starter=true,guide-finisher=true,mixed=true,broken=false",
	} {
		if got := summary(Stack{GrafanaVersion: stack}); got != want {
			t.Errorf("stack %q:\n got %s\nwant %s", stack, got, want)
		}
	}
	if s.Display[0].Earnable != true {
		t.Error("DisplayFor changed the shared snapshot")
	}
}
