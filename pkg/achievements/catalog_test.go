package achievements

import (
	"fmt"
	"strings"
	"testing"
)

func wrap(achievement string) string {
	return `{"schemaVersion":1,"achievements":[` + achievement + `]}`
}

func counted(counter, tiers string) string {
	return fmt.Sprintf(`{"id":"x","revision":1,"title":"X","description":"X.","counter":%s,"tiers":%s}`, counter, tiers)
}

const (
	dashEvidence = `{"entity":"dashboards","action":"created","countBy":"resource"}`
	dashCounter  = `{"unit":"dashboard","evidence":[` + dashEvidence + `]}`
	oneTier      = `[{"tier":1,"at":1}]`
)

func evidenceWith(extra string) string {
	return `{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"` + extra + `}]}`
}

func TestLoadCatalogRejects(t *testing.T) {
	tooManyConds := strings.TrimSuffix(strings.Repeat(`{"field":"numPanels","op":"gte","value":1},`, 9), ",")
	tooManyEvidence := strings.TrimSuffix(strings.Repeat(dashEvidence+",", 17), ",")
	tooManyRoutes := strings.TrimSuffix(strings.Repeat(`{"entity":"guides","action":"completed"},`, 6), ",")
	elevenTiers := "[" + strings.TrimSuffix(func() string {
		var b strings.Builder
		for i := 1; i <= 11; i++ {
			fmt.Fprintf(&b, `{"tier":%d,"at":%d},`, i, i)
		}
		return b.String()
	}(), ",") + "]"

	cases := []struct{ name, catalog, want string }{
		{"schema version", `{"schemaVersion":3,"achievements":[]}`, "schemaVersion"},
		{"duplicate id", wrap(counted(dashCounter, oneTier) + "," + counted(dashCounter, oneTier)), "declared twice"},
		{"bad id", wrap(strings.Replace(counted(dashCounter, oneTier), `"id":"x"`, `"id":"X Y"`, 1)), "id must be a lowercase token"},
		{"revision zero", wrap(strings.Replace(counted(dashCounter, oneTier), `"revision":1`, `"revision":0`, 1)), "revision must be at least 1"},
		{"missing title", wrap(strings.Replace(counted(dashCounter, oneTier), `"title":"X"`, `"title":""`, 1)), "title and description"},
		{"no tiers", wrap(counted(dashCounter, `[]`)), "needs 1 to 10 tiers"},
		{"eleven tiers", wrap(counted(dashCounter, elevenTiers)), "needs 1 to 10 tiers"},

		{"undeclared entity", wrap(counted(`{"unit":"dashboard","evidence":[{"entity":"widgets","action":"created","countBy":"resource"}]}`, oneTier)), "widgets.created is not declared"},
		{"undeclared action", wrap(counted(`{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"completed","countBy":"resource"}]}`, oneTier)), "dashboards.completed is not declared"},
		{"undeclared field", wrap(counted(evidenceWith(`,"where":[{"field":"nope","op":"eq","value":1}]`), oneTier)), `field "nope" is not declared`},
		{"value wrong type", wrap(counted(evidenceWith(`,"where":[{"field":"numPanels","op":"eq","value":"2"}]`), oneTier)), "is not a number"},
		{"value outside enum", wrap(counted(`{"unit":"guide","evidence":[{"entity":"guides","action":"completed","countBy":"resource","where":[{"field":"guideCategory","op":"eq","value":"video"}]}]}`, oneTier)), "outside the field's enum"},
		{"in value outside enum", wrap(counted(`{"unit":"guide","evidence":[{"entity":"guides","action":"completed","countBy":"resource","where":[{"field":"guideCategory","op":"in","value":["interactive","video"]}]}]}`, oneTier)), "outside the field's enum"},
		{"in not a list", wrap(counted(evidenceWith(`,"where":[{"field":"numPanels","op":"in","value":3}]`), oneTier)), "in takes a list"},
		{"in empty", wrap(counted(evidenceWith(`,"where":[{"field":"numPanels","op":"in","value":[]}]`), oneTier)), "in takes a list"},
		{"in over 16", wrap(counted(evidenceWith(`,"where":[{"field":"numPanels","op":"in","value":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]}]`), oneTier)), "in takes a list"},
		{"gte on a string field", wrap(counted(evidenceWith(`,"where":[{"field":"resourceId","op":"gte","value":1}]`), oneTier)), "needs a number field"},
		{"gte value not a number", wrap(counted(evidenceWith(`,"where":[{"field":"numPanels","op":"gte","value":"1"}]`), oneTier)), "is not a number"},
		{"unknown op", wrap(counted(evidenceWith(`,"where":[{"field":"numPanels","op":"neq","value":1}]`), oneTier)), `op "neq"`},
		{"over 8 conditions", wrap(counted(evidenceWith(`,"where":[`+tooManyConds+`]`), oneTier)), "9 conditions, at most 8"},
		{"over 16 evidence", wrap(counted(`{"unit":"dashboard","evidence":[`+tooManyEvidence+`]}`, oneTier)), "evidence matchers, got 17"},
		{"no evidence", wrap(counted(`{"unit":"dashboard","evidence":[]}`, oneTier)), "evidence matchers, got 0"},

		{"countBy resource without resources", wrap(counted(`{"unit":"alert-rule","evidence":[{"entity":"alert-rules","action":"created","countBy":"resource"}]}`, oneTier)), "declares no resources"},
		{"countBy names an undeclared unit", wrap(counted(`{"unit":"widget","evidence":[{"entity":"dashboards","action":"created","countBy":{"resource":"widget"}}]}`, oneTier)), `declares no resource "widget"`},
		{"unit is not the counter's", wrap(counted(`{"unit":"guide","evidence":[`+dashEvidence+`]}`, oneTier)), `counts unit "dashboard" but the counter's unit is "guide"`},
		{"mixed units in one counter", wrap(counted(`{"unit":"dashboard","evidence":[`+dashEvidence+`,{"entity":"guides","action":"completed","countBy":"resource"}]}`, oneTier)), `counts unit "guide"`},
		{"occurrence on a resource counter", wrap(counted(`{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"occurrence"}]}`, oneTier)), `counts unit "occurrence"`},
		{"countBy missing", wrap(counted(`{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created"}]}`, oneTier)), "countBy is required"},
		{"countBy bad string", wrap(counted(`{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"sum"}]}`, oneTier)), "countBy"},
		{"countBy bad object", wrap(counted(`{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":{"field":"x"}}]}`, oneTier)), "countBy"},
		{"counter unit token", wrap(counted(`{"unit":"Dash Board","evidence":[`+dashEvidence+`]}`, oneTier)), "counter unit"},

		{"at not increasing", wrap(counted(dashCounter, `[{"tier":1,"at":5},{"tier":2,"at":5}]`)), "strictly greater"},
		{"at decreasing", wrap(counted(dashCounter, `[{"tier":1,"at":5},{"tier":2,"at":3}]`)), "strictly greater"},
		{"at zero", wrap(counted(dashCounter, `[{"tier":1,"at":0}]`)), "at must be 1 to 200"},
		{"at over 200", wrap(counted(dashCounter, `[{"tier":1,"at":201}]`)), "at must be 1 to 200"},
		{"occurrence at over 50", wrap(counted(`{"unit":"occurrence","evidence":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]}`, `[{"tier":1,"at":51}]`)), "at must be 1 to 50"},
		{"at missing on a counted achievement", wrap(counted(dashCounter, `[{"tier":1}]`)), "at is required"},
		{"at on a milestone", wrap(`{"id":"x","revision":1,"title":"X","description":"X.","tiers":[{"tier":1,"at":1,"or":[{"entity":"guides","action":"completed"}]}]}`), "forbidden on a milestone"},
		{"milestone tier without a route", wrap(`{"id":"x","revision":1,"title":"X","description":"X.","tiers":[{"tier":1}]}`), "needs at least one route"},
		{"tier numbers skip", wrap(counted(dashCounter, `[{"tier":2,"at":1}]`)), "tier numbers must run"},
		{"tier numbers reordered", wrap(counted(dashCounter, `[{"tier":1,"at":1},{"tier":3,"at":2},{"tier":2,"at":3}]`)), "tier numbers must run"},

		{"route action not completed", wrap(counted(dashCounter, `[{"tier":1,"at":1,"or":[{"entity":"dashboards","action":"created"}]}]`)), `routes take action "completed"`},
		{"route undeclared pair", wrap(counted(dashCounter, `[{"tier":1,"at":1,"or":[{"entity":"widgets","action":"completed"}]}]`)), "widgets.completed is not declared"},
		{"route undeclared field", wrap(counted(dashCounter, `[{"tier":1,"at":1,"or":[{"entity":"guides","action":"completed","where":[{"field":"nope","op":"eq","value":"x"}]}]}]`)), `field "nope"`},
		{"route over 5", wrap(counted(dashCounter, `[{"tier":1,"at":1,"or":[`+tooManyRoutes+`]}]`)), "6 routes, at most 5"},
		{"route with countBy", wrap(counted(dashCounter, `[{"tier":1,"at":1,"or":[{"entity":"guides","action":"completed","countBy":"resource"}]}]`)), "unknown field"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadCatalog([]byte(tc.catalog), mustRegistry(t))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

// RFC §6.2: the grammar is closed, and a rule kind outside it is rejected.
func TestLoadCatalogRejectsRuleKindsOutsideTheGrammar(t *testing.T) {
	cases := []struct{ name, achievement, want string }{
		{"earn window", strings.Replace(counted(dashCounter, oneTier), `"tiers"`, `"window":{"start":"2027-01-01","end":"2027-01-31"},"tiers"`, 1), "window"},
		{"within timing rule", counted(`{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource","within":"10d"}]}`, oneTier), "within"},
		{"counting window", counted(`{"unit":"dashboard","window":"7d","evidence":[`+dashEvidence+`]}`, oneTier), "window"},
		{"sequence", counted(`{"unit":"dashboard","evidence":[`+dashEvidence+`],"sequence":["a","b"]}`, oneTier), "sequence"},
		{"streak", strings.Replace(counted(dashCounter, oneTier), `"tiers"`, `"streak":{"days":3},"tiers"`, 1), "streak"},
		{"all", counted(dashCounter, `[{"tier":1,"at":1,"all":[{"entity":"guides","action":"completed"}]}]`), "all"},
		{"criteria_met", counted(dashCounter, `[{"tier":1,"at":1,"criteria_met":true}]`), "criteria_met"},
		{"duration", counted(`{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource","durationMs":100}]}`, oneTier), "durationMs"},
		{"expression", counted(`{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource","expr":"numPanels > 1"}]}`, oneTier), "expr"},
		{"negation op", counted(evidenceWith(`,"where":[{"field":"numPanels","op":"not","value":1}]`), oneTier), `op "not"`},
		{"reference between counters", counted(`{"unit":"dashboard","evidence":[`+dashEvidence+`],"after":"other"}`, oneTier), "after"},
		{"reward", strings.Replace(counted(dashCounter, oneTier), `"tiers"`, `"reward":{"guide":"x"},"tiers"`, 1), "reward"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadCatalog([]byte(wrap(tc.achievement)), mustRegistry(t))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestLoadCatalogAcceptsBoundaryValues(t *testing.T) {
	conds := strings.TrimSuffix(strings.Repeat(`{"field":"numPanels","op":"gte","value":1},`, 8), ",")
	evidence := strings.TrimSuffix(strings.Repeat(dashEvidence+",", 16), ",")
	routes := strings.TrimSuffix(strings.Repeat(`{"entity":"guides","action":"completed"},`, 5), ",")
	list := `[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]`
	for name, achievement := range map[string]string{
		"8 conditions":  counted(evidenceWith(`,"where":[`+conds+`]`), oneTier),
		"16 evidence":   counted(`{"unit":"dashboard","evidence":[`+evidence+`]}`, oneTier),
		"5 routes":      counted(dashCounter, `[{"tier":1,"at":1,"or":[`+routes+`]}]`),
		"16 in values":  counted(evidenceWith(`,"where":[{"field":"numPanels","op":"in","value":`+list+`}]`), oneTier),
		"at 200":        counted(dashCounter, `[{"tier":1,"at":200}]`),
		"occurrence 50": counted(`{"unit":"occurrence","evidence":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]}`, `[{"tier":1,"at":50}]`),
		"boolean eq":    counted(evidenceWith(`,"where":[{"field":"starred","op":"eq","value":true}]`), oneTier),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := LoadCatalog([]byte(wrap(achievement)), mustRegistry(t)); err != nil {
				t.Errorf("rejected: %v", err)
			}
		})
	}
}

func TestLoadCatalogReportsEveryProblem(t *testing.T) {
	_, err := LoadCatalog([]byte(wrap(counted(`{"unit":"dashboard","evidence":[{"entity":"nope","action":"created","countBy":"resource"}]}`, `[{"tier":1,"at":0}]`))), mustRegistry(t))
	if err == nil || !strings.Contains(err.Error(), "nope.created") || !strings.Contains(err.Error(), "at must be") {
		t.Errorf("err = %v, want both problems", err)
	}
}

func TestDormant(t *testing.T) {
	catalog := mustCatalog(t)
	cases := []struct {
		name    string
		emitted []Pair
		want    string
	}{
		{"nothing emitted: all dormant", nil, "dash-builder,well-rounded,alert-starter,guide-routes"},
		{"only dashboards emitted", []Pair{{"dashboards", "created"}}, "well-rounded,alert-starter,guide-routes"},
		{"guides emitted: routes keep dash-builder live", []Pair{{"guides", "completed"}}, "alert-starter"},
		{"a pair no definition uses changes nothing", []Pair{{"widgets", "created"}}, "dash-builder,well-rounded,alert-starter,guide-routes"},
		{"everything emitted", []Pair{{"dashboards", "created"}, {"guides", "completed"}, {"alert-rules", "created"}}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := strings.Join(catalog.Dormant(tc.emitted), ","); got != tc.want {
				t.Errorf("dormant = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDormantAchievementIsNeverSelected(t *testing.T) {
	catalog := mustCatalog(t)
	for _, d := range catalog.selectFor(Event{Entity: "widgets", Action: "created"}) {
		t.Errorf("%s selected by an event on an undeclared pair", d.ID)
	}
}
