package achievements

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
)

const (
	SchemaVersion = 1

	maxTokenLen      = 32
	maxContextFields = 12
)

type FieldType string

const (
	FieldString  FieldType = "string"
	FieldNumber  FieldType = "number"
	FieldBoolean FieldType = "boolean"
)

var (
	tokenPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	fieldPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*$`)
)

// Registry declares which entity.action pairs are valid and the context each
// carries (RFC §6.1).
type Registry struct {
	SchemaVersion int               `json:"schemaVersion"`
	Entities      map[string]Entity `json:"entities"`
}

type Entity struct {
	Actions map[string]Action `json:"actions"`
}

type Action struct {
	Context   map[string]Field `json:"context"`
	Resources []Resource       `json:"resources,omitempty"`
}

type Field struct {
	Type FieldType `json:"type"`
	Enum []any     `json:"enum,omitempty"`
}

// Resource names a unit and the context fields that together identify one of
// it. The first resource of an action is its default.
type Resource struct {
	Unit string   `json:"unit"`
	ID   []string `json:"id"`
}

func LoadRegistry(data []byte) (*Registry, error) {
	var r Registry
	if err := decodeStrict(data, &r); err != nil {
		return nil, err
	}
	if err := r.validate(); err != nil {
		return nil, err
	}
	return &r, nil
}

func (r *Registry) action(entity, action string) (Action, bool) {
	e, ok := r.Entities[entity]
	if !ok {
		return Action{}, false
	}
	a, ok := e.Actions[action]
	return a, ok
}

func (r *Registry) validate() error {
	if r.SchemaVersion != SchemaVersion {
		return fmt.Errorf("registry: schemaVersion must be %d, got %d", SchemaVersion, r.SchemaVersion)
	}
	if len(r.Entities) == 0 {
		return errors.New("registry: no entities")
	}
	var errs []error
	for _, entity := range sortedKeys(r.Entities) {
		if !validToken(entity) {
			errs = append(errs, fmt.Errorf("registry: entity %q is not a lowercase token of at most %d characters", entity, maxTokenLen))
		}
		actions := r.Entities[entity].Actions
		if len(actions) == 0 {
			errs = append(errs, fmt.Errorf("registry: entity %q declares no actions", entity))
		}
		for _, action := range sortedKeys(actions) {
			where := fmt.Sprintf("registry: %s.%s", entity, action)
			if !validToken(action) {
				errs = append(errs, fmt.Errorf("%s: action is not a lowercase token of at most %d characters", where, maxTokenLen))
			}
			errs = append(errs, actions[action].validate(where)...)
		}
	}
	return errors.Join(errs...)
}

func (a Action) validate(where string) []error {
	var errs []error
	if len(a.Context) > maxContextFields {
		errs = append(errs, fmt.Errorf("%s: %d context fields, at most %d", where, len(a.Context), maxContextFields))
	}
	for _, name := range sortedKeys(a.Context) {
		errs = append(errs, a.Context[name].validate(fmt.Sprintf("%s: field %q", where, name), name)...)
	}
	units := map[string]bool{}
	for i, res := range a.Resources {
		rw := fmt.Sprintf("%s: resource %d", where, i)
		if res.Unit == unitOccurrence {
			errs = append(errs, fmt.Errorf("%s: unit %q is reserved for occurrence counters", rw, res.Unit))
		}
		if !validToken(res.Unit) {
			errs = append(errs, fmt.Errorf("%s: unit %q is not a lowercase token of at most %d characters", rw, res.Unit, maxTokenLen))
		}
		if units[res.Unit] {
			errs = append(errs, fmt.Errorf("%s: unit %q declared twice", rw, res.Unit))
		}
		units[res.Unit] = true
		if len(res.ID) == 0 {
			errs = append(errs, fmt.Errorf("%s: no id fields", rw))
		}
		for _, id := range res.ID {
			if _, ok := a.Context[id]; !ok {
				errs = append(errs, fmt.Errorf("%s: id field %q is not a declared context field", rw, id))
			}
		}
	}
	return errs
}

func (f Field) validate(where, name string) []error {
	var errs []error
	if !fieldPattern.MatchString(name) {
		errs = append(errs, fmt.Errorf("%s: name must match %s", where, fieldPattern))
	}
	switch f.Type {
	case FieldString, FieldNumber, FieldBoolean:
	default:
		return append(errs, fmt.Errorf("%s: type %q is not string, number, or boolean", where, f.Type))
	}
	for _, v := range f.Enum {
		if !f.Type.accepts(v) {
			errs = append(errs, fmt.Errorf("%s: enum value %v is not a %s", where, v, f.Type))
		}
	}
	return errs
}

func (t FieldType) accepts(v any) bool {
	switch t {
	case FieldString:
		_, ok := v.(string)
		return ok
	case FieldNumber:
		_, ok := toNumber(v)
		return ok
	case FieldBoolean:
		_, ok := v.(bool)
		return ok
	default:
		return false
	}
}

func validToken(s string) bool {
	return len(s) <= maxTokenLen && tokenPattern.MatchString(s)
}

func decodeStrict(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("trailing data after JSON document")
	}
	return nil
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func toNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}
