package plugin

import "testing"

// TestValidGuideIDPattern locks the canonical kebab-case format so the Go-side
// regex stays in agreement with PACKAGE_ID_REGEX in
// src/types/package.schema.ts. The same string flows unchanged from CLI
// authoring through `metadata.name` and the `?doc=api:<id>` viewer link key.
func TestValidGuideIDPattern(t *testing.T) {
	cases := []struct {
		id    string
		valid bool
	}{
		{"a", true},
		{"loki-101", true},
		{"welcome-to-grafana-cloud", true},
		{"prometheus-101", true},
		{"first-dashboard", true},
		{"abc123", true},

		{"", false},
		{"-loki", false},
		{"loki-", false},
		{"Loki", false},
		{"loki_101", false},
		{"loki/101", false},
		{"loki..101", false},
		{"../etc/passwd", false},
	}

	for _, tc := range cases {
		got := validGuideIDPattern.MatchString(tc.id)
		if got != tc.valid {
			t.Errorf("validGuideIDPattern.MatchString(%q) = %v, want %v", tc.id, got, tc.valid)
		}
	}
}
