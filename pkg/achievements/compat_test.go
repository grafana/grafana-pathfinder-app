package achievements

import (
	"strings"
	"testing"
)

func TestCatalogBreaks(t *testing.T) {
	const released = `{"achievements":[
	  {"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"},{"id":"gold"}]},
	  {"id":"routes","tiers":[{"id":"bronze"}]}]}`
	cases := []struct{ name, current, want string }{
		{"unchanged", released, ""},
		{"a tier added in the middle, an achievement added, thresholds and art changed", `{"achievements":[
		  {"id":"new","tiers":[{"id":"bronze"}]},
		  {"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze","at":3},{"id":"silver"},{"id":"gold","art":"x"}]},
		  {"id":"routes","tiers":[{"id":"starter"},{"id":"bronze"}]}]}`, ""},
		{"achievement removed", `{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"},{"id":"gold"}]}]}`, `achievement "routes" was removed or renamed`},
		{"tier removed", `{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" tier "gold" was removed or renamed`},
		{"tiers reordered", `{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"gold"},{"id":"bronze"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" tiers were reordered from [bronze gold] to [gold bronze]`},
		{"counter unit changed", `{"achievements":[{"id":"guides","counter":{"unit":"guide-category"},"tiers":[{"id":"bronze"},{"id":"gold"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" counter unit changed from "guide" to "guide-category"`},
		{"milestone became counted", `{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"},{"id":"gold"}]},{"id":"routes","counter":{"unit":"guide"},"tiers":[{"id":"bronze"}]}]}`, `achievement "routes" counter unit changed from "" to "guide"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := catalogBreaks([]byte(released), []byte(tc.current))
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(problems, "; "); got != tc.want {
				t.Errorf("problems = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRegistryBreaks(t *testing.T) {
	const released = `{"entities":{"guides":{"actions":{"completed":{
	  "context":{"guideSource":{"type":"string"},"guideId":{"type":"string"}},
	  "resources":[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"guide-category","id":["guideCategory"]}]}}}}}`
	with := func(context, resources string) string {
		return `{"entities":{"guides":{"actions":{"completed":{"context":` + context + `,"resources":` + resources + `}}}}}`
	}
	const ctx = `{"guideSource":{"type":"string"},"guideId":{"type":"string"}}`
	const res = `[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"guide-category","id":["guideCategory"]}]`
	cases := []struct{ name, current, want string }{
		{"unchanged", released, ""},
		{"a field, a resource, an action and an entity added", `{"entities":{
		  "guides":{"actions":{"completed":{"context":{"guideSource":{"type":"string"},"guideId":{"type":"string"},"pathId":{"type":"string"}},
		    "resources":[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"path","id":["pathId"]},{"unit":"guide-category","id":["guideCategory"]}]},
		    "started":{"context":{}}}},
		  "dashboards":{"actions":{"created":{"context":{}}}}}}`, ""},
		{"entity removed", `{"entities":{}}`, `entity "guides" was removed`},
		{"action removed", `{"entities":{"guides":{"actions":{}}}}`, `guides.completed was removed`},
		{"field removed", with(`{"guideSource":{"type":"string"}}`, res), `guides.completed field "guideId" was removed`},
		{"field retyped", with(`{"guideSource":{"type":"string"},"guideId":{"type":"number"}}`, res), `guides.completed field "guideId" changed type from string to number`},
		{"resource removed", with(ctx, `[{"unit":"guide","id":["guideSource","guideId"]}]`), `guides.completed resource "guide-category" was removed or renamed`},
		{"resources reordered", with(ctx, `[{"unit":"guide-category","id":["guideCategory"]},{"unit":"guide","id":["guideSource","guideId"]}]`), `guides.completed resources were reordered from [guide guide-category] to [guide-category guide]`},
		{"resource identified differently", with(ctx, `[{"unit":"guide","id":["guideId"]},{"unit":"guide-category","id":["guideCategory"]}]`), `guides.completed resource "guide" is now identified by [guideId], not [guideSource guideId]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := registryBreaks([]byte(released), []byte(tc.current))
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(problems, "; "); got != tc.want {
				t.Errorf("problems = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBundleBreaks(t *testing.T) {
	live := `{"grammar":"1.0",
	  "registry":{"entities":{"guides":{"actions":{"completed":{"context":{"guideId":{"type":"string"}}}}}}},
	  "catalog":{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"}]}]},
	  "art":["guides-1","guides-2"]}`
	cases := []struct{ name, next, want string }{
		{"unchanged", live, ""},
		{"a newer minor that only adds", strings.Replace(strings.Replace(live, `"1.0"`, `"1.4"`, 1), `"guides-2"]`, `"guides-2","guides-3"]`, 1), ""},
		{"art key removed", strings.Replace(live, `,"guides-2"`, ``, 1), `art key "guides-2" was removed`},
		{"tier removed", strings.Replace(live, `[{"id":"bronze"}]`, `[]`, 1), `achievement "guides" tier "bronze" was removed or renamed`},
		{"field removed", strings.Replace(live, `"guideId":{"type":"string"}`, ``, 1), `guides.completed field "guideId" was removed`},
		{"everything gone", `{"grammar":"1.0"}`, `achievement "guides" was removed or renamed; entity "guides" was removed; art key "guides-1" was removed; art key "guides-2" was removed`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := BundleBreaks([]byte(live), []byte(tc.next))
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(problems, "; "); got != tc.want {
				t.Errorf("problems = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBundleBreaksRefusesToCompareMajors(t *testing.T) {
	for _, next := range []string{`{"grammar":"2.0"}`, `{"catalog":{}}`, `not json`} {
		if _, err := BundleBreaks([]byte(`{"grammar":"1.0"}`), []byte(next)); err == nil {
			t.Errorf("next %s: no error", next)
		}
	}
}

func TestBundleBreaksGuardsRequiresGrammarAndDuplicates(t *testing.T) {
	live := `{"grammar":"1.2","catalog":{"achievements":[{"id":"a","requires":"1.0","tiers":[{"id":"bronze"}]}]}}`
	cases := []struct{ name, next, want string }{
		{"requires unchanged, field order and other text free", `{"grammar":"1.2","catalog":{"achievements":[{"tiers":[{"id":"bronze"}],"id":"a","requires":"1.0"}]}}`, ""},
		{"requires raised", `{"grammar":"1.2","catalog":{"achievements":[{"id":"a","requires":"1.1","tiers":[{"id":"bronze"}]}]}}`, `achievement "a" requires grammar 1.1, up from 1.0`},
		{"grammar went back", `{"grammar":"1.1","catalog":{"achievements":[{"id":"a","requires":"1.0","tiers":[{"id":"bronze"}]}]}}`, "grammar went back from 1.2 to 1.1"},
		{"duplicate hides a break", `{"grammar":"1.2","catalog":{"achievements":[{"id":"a","requires":"1.0","tiers":[]},{"id":"a","requires":"1.0","tiers":[{"id":"bronze"}]}]}}`, `achievement "a" is declared more than once`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := BundleBreaks([]byte(live), []byte(tc.next))
			if err != nil {
				t.Fatal(err)
			}
			got := strings.Join(problems, "; ")
			if (tc.want == "") != (got == "") || !strings.Contains(got, tc.want) {
				t.Errorf("problems = %q, want %q", got, tc.want)
			}
		})
	}
}
