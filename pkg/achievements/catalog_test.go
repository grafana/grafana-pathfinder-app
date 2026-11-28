package achievements

import (
	"fmt"
	"strings"
	"testing"
)

func wrap(achievement string) string {
	return `{"achievements":[` + achievement + `]}`
}

func tiered(tiers string) string {
	return fmt.Sprintf(`{"id":"x","title":"X","description":"X.","tiers":%s}`, tiers)
}

func ruleTier(rules ...string) string {
	return `[{"id":"bronze","goal":1,"rules":[` + strings.Join(rules, ",") + `]}]`
}

func goalTier(goal int, rules ...string) string {
	return fmt.Sprintf(`[{"id":"bronze","goal":%d,"rules":[%s]}]`, goal, strings.Join(rules, ","))
}

const (
	dashRule       = `{"entity":"dashboards","action":"created","countBy":"resource"}`
	alertRule      = `{"entity":"alert-rules","action":"created","countBy":"occurrence"}`
	guideRule      = `{"entity":"guides","action":"completed","countBy":"resource"}`
	categoryRule   = `{"entity":"guides","action":"completed","countBy":{"resource":"guide-category"}}`
	occurrenceDash = `{"entity":"dashboards","action":"created","countBy":"occurrence"}`
)

var oneTier = ruleTier(dashRule)

func ruleWith(extra string) string {
	return `{"entity":"dashboards","action":"created","countBy":"resource"` + extra + `}`
}

func tiersOf(goals ...int) string {
	tiers := make([]string, len(goals))
	for i, goal := range goals {
		tiers[i] = fmt.Sprintf(`{"id":"t%d","goal":%d,"rules":[%s]}`, i+1, goal, dashRule)
	}
	return "[" + strings.Join(tiers, ",") + "]"
}

func TestLoadCatalogRejects(t *testing.T) {
	tooManyConds := strings.TrimSuffix(strings.Repeat(`{"field":"numPanels","op":"gte","value":1},`, 9), ",")
	tooManyRules := strings.Split(strings.TrimSuffix(strings.Repeat(dashRule+"|", 17), "|"), "|")
	elevenTiers := tiersOf(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)

	cases := []struct{ name, catalog, want string }{
		{"schema version is the bundle's grammar", `{"schemaVersion":1,"achievements":[]}`, `unknown field "schemaVersion"`},
		{"per-definition version", wrap(strings.Replace(tiered(oneTier), `"title"`, `"requires":"1.0","title"`, 1)), `unknown field "requires"`},
		{"duplicate id", wrap(tiered(oneTier) + "," + tiered(oneTier)), "declared twice"},
		{"bad id", wrap(strings.Replace(tiered(oneTier), `"id":"x"`, `"id":"X Y"`, 1)), "id must be a lowercase token"},
		{"revision", wrap(strings.Replace(tiered(oneTier), `"title"`, `"revision":1,"title"`, 1)), `unknown field "revision"`},
		{"missing title", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":""`, 1)), "title is required"},
		{"missing description", wrap(strings.Replace(tiered(oneTier), `"description":"X."`, `"description":""`, 1)), "description is required"},
		{"title over 80", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"`+strings.Repeat("é", 81)+`"`, 1)), "title is over 80 characters"},
		{"description over 280", wrap(strings.Replace(tiered(oneTier), `"description":"X."`, `"description":"`+strings.Repeat("a", 281)+`"`, 1)), "description is over 280 characters"},
		{"control character", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"X\u0007"`, 1)), "title contains the control, format or separator character U+0007"},
		{"newline", wrap(strings.Replace(tiered(oneTier), `"description":"X."`, `"description":"X.\nY."`, 1)), "description contains the control, format or separator character U+000A"},
		{"bidi override", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"\u202eX"`, 1)), "title contains the control, format or separator character U+202E"},
		{"bidi isolate", wrap(strings.Replace(tiered(oneTier), `"description":"X."`, `"description":"\u2066X."`, 1)), "description contains the control, format or separator character U+2066"},
		{"bidi mark", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"X\u200f"`, 1)), "title contains the control, format or separator character U+200F"},
		{"arabic letter mark", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"X\u061c"`, 1)), "title contains the control, format or separator character U+061C"},
		{"zero-width space", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"X\u200b"`, 1)), "title contains the control, format or separator character U+200B"},
		{"byte order mark", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"X\ufeff"`, 1)), "title contains the control, format or separator character U+FEFF"},
		{"soft hyphen", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"X\u00ad"`, 1)), "title contains the control, format or separator character U+00AD"},
		{"word joiner", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"X\u2060"`, 1)), "title contains the control, format or separator character U+2060"},
		{"line separator", wrap(strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"X\u2028"`, 1)), "title contains the control, format or separator character U+2028"},
		{"paragraph separator", wrap(strings.Replace(tiered(oneTier), `"description":"X."`, `"description":"X.\u2029Y."`, 1)), "description contains the control, format or separator character U+2029"},
		{"no tiers", wrap(tiered(`[]`)), "needs 1 to 10 tiers"},
		{"eleven tiers", wrap(tiered(elevenTiers)), "needs 1 to 10 tiers"},

		{"a shared counter", wrap(strings.Replace(tiered(oneTier), `"tiers"`, `"counter":{"unit":"dashboard","evidence":[`+dashRule+`]},"tiers"`, 1)), `unknown field "counter"`},
		{"a cumulative threshold", wrap(tiered(`[{"id":"bronze","at":1,"goal":1,"rules":[` + dashRule + `]}]`)), `unknown field "at"`},
		{"a route that earns a tier outright", wrap(tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"or":[{"entity":"guides","action":"completed"}]}]`)), `unknown field "or"`},
		{"evidence matchers", wrap(tiered(`[{"id":"bronze","goal":1,"evidence":[` + dashRule + `]}]`)), `unknown field "evidence"`},

		{"undeclared entity", wrap(tiered(ruleTier(`{"entity":"widgets","action":"created","countBy":"resource"}`))), "rule 1: widgets.created is not declared"},
		{"undeclared action", wrap(tiered(ruleTier(`{"entity":"dashboards","action":"completed","countBy":"resource"}`))), "dashboards.completed is not declared"},
		{"undeclared field", wrap(tiered(ruleTier(ruleWith(`,"where":[{"field":"nope","op":"eq","value":1}]`)))), `field "nope" is not declared`},
		{"value wrong type", wrap(tiered(ruleTier(ruleWith(`,"where":[{"field":"numPanels","op":"eq","value":"2"}]`)))), "is not a number"},
		{"value outside enum", wrap(tiered(ruleTier(`{"entity":"guides","action":"completed","countBy":"resource","where":[{"field":"guideCategory","op":"eq","value":"video"}]}`))), "outside the field's enum"},
		{"in value outside enum", wrap(tiered(ruleTier(`{"entity":"guides","action":"completed","countBy":"resource","where":[{"field":"guideCategory","op":"in","value":["interactive","video"]}]}`))), "outside the field's enum"},
		{"in not a list", wrap(tiered(ruleTier(ruleWith(`,"where":[{"field":"numPanels","op":"in","value":3}]`)))), "in takes a list"},
		{"in empty", wrap(tiered(ruleTier(ruleWith(`,"where":[{"field":"numPanels","op":"in","value":[]}]`)))), "in takes a list"},
		{"in over 16", wrap(tiered(ruleTier(ruleWith(`,"where":[{"field":"numPanels","op":"in","value":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]}]`)))), "in takes a list"},
		{"gte on a string field", wrap(tiered(ruleTier(ruleWith(`,"where":[{"field":"resourceId","op":"gte","value":1}]`)))), "needs a number field"},
		{"gte value not a number", wrap(tiered(ruleTier(ruleWith(`,"where":[{"field":"numPanels","op":"gte","value":"1"}]`)))), "is not a number"},
		{"unknown op", wrap(tiered(ruleTier(ruleWith(`,"where":[{"field":"numPanels","op":"neq","value":1}]`)))), `op "neq"`},
		{"over 8 conditions", wrap(tiered(ruleTier(ruleWith(`,"where":[` + tooManyConds + `]`)))), "9 conditions, at most 8"},
		{"over 16 rules", wrap(tiered(ruleTier(tooManyRules...))), "needs 1 to 16 rules, got 17"},
		{"no rules", wrap(tiered(ruleTier())), "needs 1 to 16 rules, got 0"},
		{"rules missing", wrap(tiered(`[{"id":"bronze","goal":1}]`)), "needs 1 to 16 rules, got 0"},

		{"countBy resource without resources", wrap(tiered(ruleTier(`{"entity":"alert-rules","action":"created","countBy":"resource"}`))), "declares no resources"},
		{"countBy names an undeclared unit", wrap(tiered(ruleTier(`{"entity":"dashboards","action":"created","countBy":{"resource":"widget"}}`))), `declares no resource "widget"`},
		{"countBy missing", wrap(tiered(ruleTier(`{"entity":"dashboards","action":"created"}`))), "countBy is required"},
		{"countBy bad string", wrap(tiered(ruleTier(`{"entity":"dashboards","action":"created","countBy":"sum"}`))), "countBy"},
		{"countBy bad object", wrap(tiered(ruleTier(`{"entity":"dashboards","action":"created","countBy":{"field":"x"}}`))), "countBy"},
		{"rules on one pair counting different units", wrap(tiered(ruleTier(guideRule, categoryRule))), `rule 2: counts unit "guide-category" but another rule on guides.completed counts "guide"`},
		{"rules on one pair counting by resource and occurrence", wrap(tiered(ruleTier(dashRule, occurrenceDash))), `counts unit "occurrence" but another rule on dashboards.created counts "dashboard"`},

		{"goal missing", wrap(tiered(`[{"id":"bronze","rules":[` + dashRule + `]}]`)), "goal must be 1 to 200, got 0"},
		{"goal zero", wrap(tiered(goalTier(0, dashRule))), "goal must be 1 to 200, got 0"},
		{"goal over 200", wrap(tiered(goalTier(201, dashRule))), "goal must be 1 to 200, got 201"},
		{"occurrence goal over 50", wrap(tiered(goalTier(51, alertRule))), "goal must be 1 to 50, got 51"},
		{"occurrence in a mixed tier caps its goal", wrap(tiered(goalTier(51, dashRule, alertRule))), "goal must be 1 to 50, got 51"},
		{"goals adding up over 200", wrap(tiered(tiersOf(150, 51))), "the tiers' goals add up to 201, at most 200"},
		{"goal not a number", wrap(tiered(`[{"id":"bronze","goal":"1","rules":[` + dashRule + `]}]`)), "goal"},
		{"worth zero", wrap(tiered(ruleTier(ruleWith(`,"worth":0`)))), "rule 1: worth must be at least 1, got 0"},
		{"worth negative", wrap(tiered(ruleTier(ruleWith(`,"worth":-2`)))), "worth must be at least 1, got -2"},
		{"worth over the goal", wrap(tiered(goalTier(2, dashRule, ruleWith(`,"worth":3`)))), "rule 2: worth 3 is over the tier's goal of 2"},
		{"worth not a whole number", wrap(tiered(ruleTier(ruleWith(`,"worth":1.5`)))), "worth"},

		{"positional tier number", wrap(tiered(`[{"tier":1,"goal":1,"rules":[` + dashRule + `]}]`)), `unknown field "tier"`},
		{"tier id missing", wrap(tiered(`[{"goal":1,"rules":[` + dashRule + `]}]`)), "tier 1: id must be a lowercase token"},
		{"tier id not a token", wrap(tiered(`[{"id":"Gold","goal":1,"rules":[` + dashRule + `]}]`)), `tier "Gold": id must be a lowercase token`},
		{"tier id over 32", wrap(tiered(`[{"id":"` + strings.Repeat("a", 33) + `","goal":1,"rules":[` + dashRule + `]}]`)), "at most 32 characters"},
		{"art a URL", wrap(tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"art":"https://example.com/x.svg"}]`)), `tier "bronze": art must be a lowercase key of at most 64 characters`},
		{"art a path", wrap(tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"art":"../x"}]`)), "art must be a lowercase key"},
		{"art not lowercase", wrap(tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"art":"Bronze"}]`)), "art must be a lowercase key"},
		{"art over 64", wrap(tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"art":"` + strings.Repeat("a", 65) + `"}]`)), "art must be a lowercase key"},
		{"tier id twice", wrap(tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `]},{"id":"bronze","goal":2,"rules":[` + dashRule + `]}]`)), `tier "bronze": tier id declared twice`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := loadCatalog([]byte(tc.catalog), mustRegistry(t))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

// RFC §6.2: the grammar is closed, and a rule kind outside it is rejected.
func TestLoadCatalogRejectsRuleKindsOutsideTheGrammar(t *testing.T) {
	cases := []struct{ name, achievement, want string }{
		{"earn window", strings.Replace(tiered(oneTier), `"tiers"`, `"window":{"start":"2027-01-01","end":"2027-01-31"},"tiers"`, 1), "window"},
		{"within timing rule", tiered(ruleTier(ruleWith(`,"within":"10d"`))), "within"},
		{"counting window", tiered(`[{"id":"bronze","goal":1,"window":"7d","rules":[` + dashRule + `]}]`), "window"},
		{"sequence", tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"sequence":["a","b"]}]`), "sequence"},
		{"streak", strings.Replace(tiered(oneTier), `"tiers"`, `"streak":{"days":3},"tiers"`, 1), "streak"},
		{"all", tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"all":[{"entity":"guides","action":"completed"}]}]`), "all"},
		{"criteria_met", tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"criteria_met":true}]`), "criteria_met"},
		{"duration", tiered(ruleTier(ruleWith(`,"durationMs":100`))), "durationMs"},
		{"expression", tiered(ruleTier(ruleWith(`,"expr":"numPanels > 1"`))), "expr"},
		{"negation op", tiered(ruleTier(ruleWith(`,"where":[{"field":"numPanels","op":"not","value":1}]`))), `op "not"`},
		{"reference between tiers", tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"after":"other"}]`), "after"},
		{"reward", strings.Replace(tiered(oneTier), `"tiers"`, `"reward":{"guide":"x"},"tiers"`, 1), "reward"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := loadCatalog([]byte(wrap(tc.achievement)), mustRegistry(t))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestLoadCatalogAcceptsBoundaryValues(t *testing.T) {
	conds := strings.TrimSuffix(strings.Repeat(`{"field":"numPanels","op":"gte","value":1},`, 8), ",")
	rules := strings.Split(strings.TrimSuffix(strings.Repeat(dashRule+"|", 16), "|"), "|")
	list := `[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]`
	for name, achievement := range map[string]string{
		"8 conditions":                          tiered(ruleTier(ruleWith(`,"where":[` + conds + `]`))),
		"16 rules":                              tiered(ruleTier(rules...)),
		"16 in values":                          tiered(ruleTier(ruleWith(`,"where":[{"field":"numPanels","op":"in","value":` + list + `}]`))),
		"goal 200":                              tiered(goalTier(200, dashRule)),
		"goals adding up to 200 over ten tiers": tiered(tiersOf(20, 20, 20, 20, 20, 20, 20, 20, 20, 20)),
		"goals in any order":                    tiered(tiersOf(5, 1, 5)),
		"worth equal to the goal":               tiered(goalTier(3, ruleWith(`,"worth":3`))),
		"rules on one pair counting one unit":   tiered(goalTier(2, dashRule, ruleWith(`,"worth":2,"where":[{"field":"starred","op":"eq","value":true}]`))),
		"rules on different pairs counting different units": tiered(goalTier(5, dashRule, guideRule, alertRule)),
		"tiers counting different units on one pair":        tiered(`[{"id":"bronze","goal":1,"rules":[` + guideRule + `]},{"id":"silver","goal":2,"rules":[` + categoryRule + `]}]`),
		"tier id of 32":   tiered(`[{"id":"` + strings.Repeat("a", 32) + `","goal":1,"rules":[` + dashRule + `]}]`),
		"art of 64":       tiered(`[{"id":"bronze","goal":1,"rules":[` + dashRule + `],"art":"` + strings.Repeat("a", 64) + `"}]`),
		"occurrence 50":   tiered(goalTier(50, alertRule)),
		"boolean eq":      tiered(ruleTier(ruleWith(`,"where":[{"field":"starred","op":"eq","value":true}]`))),
		"zwnj in persian": strings.Replace(tiered(oneTier), `"title":"X"`, `"title":"\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645"`, 1),
		"zwj emoji":       strings.Replace(tiered(oneTier), `"description":"X."`, `"description":"\ud83d\udc69\u200d\ud83d\udcbb X."`, 1),
		"title of 80 multibyte characters and description of 280": strings.Replace(strings.Replace(tiered(oneTier),
			`"title":"X"`, `"title":"`+strings.Repeat("é", 80)+`"`, 1), `"description":"X."`, `"description":"`+strings.Repeat("a", 280)+`"`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := loadCatalog([]byte(wrap(achievement)), mustRegistry(t)); err != nil {
				t.Errorf("rejected: %v", err)
			}
		})
	}
}

func grantOnly(tiers string) string {
	return fmt.Sprintf(`{"id":"x","title":"X","description":"X.","grantOnly":true,"tiers":%s}`, tiers)
}

func TestLoadCatalogGrantOnly(t *testing.T) {
	accepted := map[string]string{
		"one tier":                   grantOnly(`[{"id":"earned"}]`),
		"tiers with art":             grantOnly(`[{"id":"earned","art":"x-1"},{"id":"honours","art":"x-2"}]`),
		"an empty rules list":        grantOnly(`[{"id":"earned","rules":[]}]`),
		"a non-grant-only flag left": strings.Replace(tiered(oneTier), `"tiers"`, `"grantOnly":false,"tiers"`, 1),
	}
	for name, achievement := range accepted {
		t.Run("accepts "+name, func(t *testing.T) {
			if _, err := loadCatalog([]byte(wrap(achievement)), mustRegistry(t)); err != nil {
				t.Errorf("rejected: %v", err)
			}
		})
	}

	refused := []struct{ name, achievement, want string }{
		{"a grant-only tier with rules", grantOnly(ruleTier(dashRule)), `tier "bronze": a grant-only tier has no goal or rules`},
		{"a grant-only tier with a goal", grantOnly(`[{"id":"earned","goal":1}]`), `tier "earned": a grant-only tier has no goal or rules`},
		{"a later grant-only tier with rules", grantOnly(`[{"id":"earned"},{"id":"more","goal":1,"rules":[` + dashRule + `]}]`), `tier "more": a grant-only tier has no goal or rules`},
		{"a grant-only tier id not a token", grantOnly(`[{"id":"Earned"}]`), `tier "Earned": id must be a lowercase token`},
		{"a grant-only tier id twice", grantOnly(`[{"id":"earned"},{"id":"earned"}]`), "tier id declared twice"},
		{"a grant-only art path", grantOnly(`[{"id":"earned","art":"../x"}]`), "art must be a lowercase key"},
		{"a grant-only definition with no tiers", grantOnly(`[]`), "needs 1 to 10 tiers"},
		{"a grant-only definition with no title", strings.Replace(grantOnly(`[{"id":"earned"}]`), `"title":"X"`, `"title":""`, 1), "title is required"},
		{"grantOnly not a boolean", strings.Replace(grantOnly(`[{"id":"earned"}]`), `"grantOnly":true`, `"grantOnly":"yes"`, 1), "grantOnly"},
		{"a non-grant-only tier with no rules", tiered(`[{"id":"earned"}]`), "needs 1 to 16 rules, got 0"},
		{"a non-grant-only tier with no goal", strings.Replace(tiered(`[{"id":"earned","rules":[`+dashRule+`]}]`), `"tiers"`, `"grantOnly":false,"tiers"`, 1), "goal must be 1 to 200, got 0"},
	}
	for _, tc := range refused {
		t.Run("refuses "+tc.name, func(t *testing.T) {
			_, err := loadCatalog([]byte(wrap(tc.achievement)), mustRegistry(t))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestLoadCatalogReportsEveryProblem(t *testing.T) {
	_, err := loadCatalog([]byte(wrap(tiered(goalTier(0, `{"entity":"nope","action":"created","countBy":"resource"}`)))), mustRegistry(t))
	if err == nil || !strings.Contains(err.Error(), "nope.created") || !strings.Contains(err.Error(), "goal must be") {
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
		{"nothing emitted: all dormant", nil, "dash-builder,well-rounded,alert-starter,journey,guide-routes"},
		{"only dashboards emitted", []Pair{{"dashboards", "created"}}, "well-rounded,alert-starter,journey,guide-routes"},
		{"a later tier's pair alone leaves a journey dormant", []Pair{{"contact-points", "created"}}, "dash-builder,well-rounded,alert-starter,journey,guide-routes"},
		{"the first tier's pair makes a journey live", []Pair{{"folders", "created"}}, "dash-builder,well-rounded,alert-starter,guide-routes"},
		{"guides emitted: a first-tier rule keeps an achievement live", []Pair{{"guides", "completed"}}, "alert-starter,journey"},
		{"a pair no definition uses changes nothing", []Pair{{"widgets", "created"}}, "dash-builder,well-rounded,alert-starter,journey,guide-routes"},
		{"everything emitted", []Pair{{"dashboards", "created"}, {"guides", "completed"}, {"alert-rules", "created"}, {"folders", "created"}}, ""},
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
