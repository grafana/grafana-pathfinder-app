package achievements

import "errors"

// ErrFieldUnserved reports that a row written in full came back without a
// required field, so the deployed kind does not serve it.
var ErrFieldUnserved = errors.New("achievement store: the progress kind does not serve a required field")

// Shape is how a stored progress row compares with what the evaluator needs.
type Shape int

const (
	ShapeCurrent Shape = iota
	ShapeRepairable
	ShapeNewer
)

// A row's version always comes from its explicit SchemaVersion, never from its
// shape. Migrations are keyed off that version; MissingFields only detects a
// required field the deployed kind pruned within the current version. A
// SchemaVersion of 0 is a row that was never stored and is current.
type requiredField struct {
	name string
	fill func(*Progress)
}

var requiredFields = []requiredField{
	{name: FieldPoints, fill: func(p *Progress) { p.Points = 0 }},
}

// FieldPoints names the points field in Progress.MissingFields.
const FieldPoints = "points"

// migrations[v] turns a version v row into a version v+1 row.
var migrations = map[int]func(Progress) Progress{
	1: func(p Progress) Progress {
		p.Units, p.Points = nil, 0
		return p
	},
}

// MissingFields lists the required fields present reports as absent.
func MissingFields(present map[string]bool) []string {
	var missing []string
	for _, f := range requiredFields {
		if !present[f.name] {
			missing = append(missing, f.name)
		}
	}
	return missing
}

func Classify(p Progress) Shape {
	switch {
	case p.SchemaVersion > ProgressSchemaVersion:
		return ShapeNewer
	case p.SchemaVersion > 0 && p.SchemaVersion < ProgressSchemaVersion, len(p.MissingFields) > 0:
		return ShapeRepairable
	default:
		return ShapeCurrent
	}
}

// Normalize applies the migrations from the row's version up to the current
// one and fills required fields with their defaults. Held tiers are kept.
func Normalize(p Progress) Progress {
	if p.SchemaVersion > ProgressSchemaVersion {
		return p
	}
	for v := max(p.SchemaVersion, 1); v < ProgressSchemaVersion; v++ {
		if migrate, ok := migrations[v]; ok {
			p = migrate(p)
		}
	}
	for _, f := range requiredFields {
		f.fill(&p)
	}
	p.SchemaVersion, p.MissingFields = ProgressSchemaVersion, nil
	return p
}
