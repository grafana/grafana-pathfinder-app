package achievements

import (
	"strings"
	"testing"
)

func TestCatalogBreaks(t *testing.T) {
	const released = `{"achievements":[
	  {"id":"guides","tiers":[{"id":"bronze","goal":1},{"id":"gold","goal":10}]},
	  {"id":"routes","tiers":[{"id":"bronze"}]}]}`
	cases := []struct{ name, current, want string }{
		{"unchanged", released, ""},
		{"a tier appended, an achievement added, goals, rules and art changed", `{"achievements":[
		  {"id":"new","tiers":[{"id":"bronze"}]},
		  {"id":"guides","tiers":[{"id":"bronze","goal":3,"rules":[{"entity":"dashboards"}]},{"id":"gold","art":"x"},{"id":"platinum"}]},
		  {"id":"routes","tiers":[{"id":"bronze"},{"id":"silver"},{"id":"gold"}]}]}`, ""},
		{"achievement removed", `{"achievements":[{"id":"guides","tiers":[{"id":"bronze"},{"id":"gold"}]}]}`, `achievement "routes" was removed or renamed`},
		{"tier removed", `{"achievements":[{"id":"guides","tiers":[{"id":"bronze"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" tier "gold" was removed or renamed`},
		{"tiers reordered", `{"achievements":[{"id":"guides","tiers":[{"id":"gold"},{"id":"bronze"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" tiers were reordered from [bronze gold] to [gold bronze]`},
		{"a tier inserted between published ones", `{"achievements":[{"id":"guides","tiers":[{"id":"bronze"},{"id":"silver"},{"id":"gold"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" tier "silver" was added before published tier "gold"`},
		{"a published goal lowered", `{"achievements":[{"id":"guides","tiers":[{"id":"bronze","goal":1},{"id":"gold","goal":9}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" tier "gold" goal was lowered from 10 to 9`},
		{"a tier inserted before every published one", `{"achievements":[{"id":"guides","tiers":[{"id":"bronze"},{"id":"gold"}]},{"id":"routes","tiers":[{"id":"starter"},{"id":"bronze"}]}]}`, `achievement "routes" tier "starter" was added before published tier "bronze"`},
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
	live := `{"grammar":"2.0",
	  "registry":{"entities":{"guides":{"actions":{"completed":{"context":{"guideId":{"type":"string"}}}}}}},
	  "catalog":{"achievements":[{"id":"guides","tiers":[{"id":"bronze"}]}]},
	  "art":["guides-1","guides-2"]}`
	cases := []struct{ name, next, want string }{
		{"unchanged", live, ""},
		{"an art key added", strings.Replace(live, `"guides-2"]`, `"guides-2","guides-3"]`, 1), ""},
		{"art key removed", strings.Replace(live, `,"guides-2"`, ``, 1), `art key "guides-2" was removed`},
		{"tier removed", strings.Replace(live, `[{"id":"bronze"}]`, `[]`, 1), `achievement "guides" tier "bronze" was removed or renamed`},
		{"field removed", strings.Replace(live, `"guideId":{"type":"string"}`, ``, 1), `guides.completed field "guideId" was removed`},
		{"everything gone", `{"grammar":"2.0"}`, `achievement "guides" was removed or renamed; entity "guides" was removed; art key "guides-1" was removed; art key "guides-2" was removed`},
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

func TestBundleBreaksRefusesToCompareFormats(t *testing.T) {
	for _, next := range []string{`{"grammar":"3.0"}`, `{"catalog":{}}`, `not json`} {
		if _, err := BundleBreaks([]byte(`{"grammar":"2.0"}`), []byte(next)); err == nil {
			t.Errorf("next %s: no error", next)
		}
	}
}

func TestBundleBreaksGuardsDuplicates(t *testing.T) {
	live := `{"grammar":"2.0","catalog":{"achievements":[{"id":"a","tiers":[{"id":"bronze"}]}]}}`
	cases := []struct{ name, next, want string }{
		{"field order and other text free", `{"grammar":"2.0","catalog":{"achievements":[{"tiers":[{"id":"bronze"}],"title":"New","id":"a"}]}}`, ""},
		{"duplicate hides a break", `{"grammar":"2.0","catalog":{"achievements":[{"id":"a","tiers":[]},{"id":"a","tiers":[{"id":"bronze"}]}]}}`, `achievement "a" is declared more than once`},
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

func TestCatalogBreaksGrantOnlyFlip(t *testing.T) {
	const (
		granted = `{"achievements":[{"id":"legacy","grantOnly":true,"tiers":[{"id":"earned"}]}]}`
		earned  = `{"achievements":[{"id":"legacy","tiers":[{"id":"earned","goal":1}]}]}`
		cleared = `{"achievements":[{"id":"legacy","grantOnly":false,"tiers":[{"id":"earned","goal":1}]}]}`
	)
	cases := []struct{ name, live, next, want string }{
		{"grant-only unchanged", granted, granted, ""},
		{"a grant-only achievement added", `{"achievements":[]}`, granted, ""},
		{"grant-only turned earnable", granted, earned, `achievement "legacy" changed grantOnly from true to false`},
		{"grant-only cleared explicitly", granted, cleared, `achievement "legacy" changed grantOnly from true to false`},
		{"earnable turned grant-only", earned, granted, `achievement "legacy" changed grantOnly from false to true`},
		{"an explicit false is not a change", earned, cleared, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := catalogBreaks([]byte(tc.live), []byte(tc.next))
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(problems, "; "); got != tc.want {
				t.Errorf("problems = %q, want %q", got, tc.want)
			}
		})
	}
}
