package services

import (
	"encoding/json"
	"strings"
	"unicode"
)

type GuidePage struct {
	Items    []json.RawMessage
	Continue string
}

func ValidGuideName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\%") && strings.IndexFunc(name, unicode.IsControl) < 0
}
