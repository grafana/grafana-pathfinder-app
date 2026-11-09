package achievements

import (
	"fmt"
	"strings"
	"testing"
)

func TestLoadRegistryRejects(t *testing.T) {
	manyFields := make([]string, 13)
	for i := range manyFields {
		manyFields[i] = fmt.Sprintf(`"f%d":{"type":"string"}`, i)
	}
	cases := []struct{ name, json, want string }{
		{"schema version is the bundle's grammar", `{"schemaVersion":1,"entities":{"a":{"actions":{"b":{"context":{}}}}}}`, `unknown field "schemaVersion"`},
		{"no entities", `{"entities":{}}`, "no entities"},
		{"entity token", `{"entities":{"Bad":{"actions":{"b":{"context":{}}}}}}`, `entity "Bad"`},
		{"entity too long", `{"entities":{"` + strings.Repeat("a", 33) + `":{"actions":{"b":{"context":{}}}}}}`, "at most 32"},
		{"no actions", `{"entities":{"a":{"actions":{}}}}`, "no actions"},
		{"action token", `{"entities":{"a":{"actions":{"B_x":{"context":{}}}}}}`, "action is not a lowercase token"},
		{"field type", `{"entities":{"a":{"actions":{"b":{"context":{"f":{"type":"object"}}}}}}}`, "is not string, number, or boolean"},
		{"field name", `{"entities":{"a":{"actions":{"b":{"context":{"bad_name":{"type":"string"}}}}}}}`, "name must match"},
		{"enum type", `{"entities":{"a":{"actions":{"b":{"context":{"f":{"type":"string","enum":["x",1]}}}}}}}`, "enum value 1"},
		{"too many fields", `{"entities":{"a":{"actions":{"b":{"context":{` + strings.Join(manyFields, ",") + `}}}}}}`, "at most 12"},
		{"resource id undeclared", `{"entities":{"a":{"actions":{"b":{"context":{"f":{"type":"string"}},"resources":[{"unit":"u","id":["g"]}]}}}}}`, `id field "g"`},
		{"resource without id", `{"entities":{"a":{"actions":{"b":{"context":{},"resources":[{"unit":"u","id":[]}]}}}}}`, "no id fields"},
		{"resource unit twice", `{"entities":{"a":{"actions":{"b":{"context":{"f":{"type":"string"}},"resources":[{"unit":"u","id":["f"]},{"unit":"u","id":["f"]}]}}}}}`, "declared twice"},
		{"resource unit token", `{"entities":{"a":{"actions":{"b":{"context":{"f":{"type":"string"}},"resources":[{"unit":"U","id":["f"]}]}}}}}`, `unit "U"`},
		{"reserved unit", `{"entities":{"a":{"actions":{"b":{"context":{"f":{"type":"string"}},"resources":[{"unit":"occurrence","id":["f"]}]}}}}}`, "reserved for occurrence"},
		{"unknown field", `{"entities":{"a":{"actions":{"b":{"context":{},"apiPath":"/x"}}}}}`, "unknown field"},
		{"duration field is not a type", `{"entities":{"a":{"actions":{"b":{"context":{"durationMs":{"type":"duration"}}}}}}}`, "is not string, number, or boolean"},
		{"trailing data", `{"entities":{"a":{"actions":{"b":{"context":{}}}}}} {}`, "trailing"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := loadRegistry([]byte(tc.json))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestLoadRegistryAcceptsTheTestRegistry(t *testing.T) {
	r := mustRegistry(t)
	if _, ok := r.action("dashboards", "created"); !ok {
		t.Error("dashboards.created missing")
	}
	if _, ok := r.action("dashboards", "completed"); ok {
		t.Error("dashboards.completed must not be declared: not every action fits every entity")
	}
}
