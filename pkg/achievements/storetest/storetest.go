// Package storetest is the behavioural contract every achievements.Store must
// meet, plus an in-memory implementation that meets it.
package storetest

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

// Factory returns an empty store. Each contract case gets its own.
type Factory func(t *testing.T) achievements.Store

var (
	alice = achievements.Person{ID: "user:1"}
	bob   = achievements.Person{ID: "user:2"}
)

func seedProgress(id string) achievements.Progress {
	return achievements.Progress{AchievementID: id, SchemaVersion: achievements.SchemaVersion}
}

func award(id, tierID string) achievements.Award {
	return achievements.Award{AchievementID: id, TierID: tierID, Entity: "guides", EarnedAt: time.Date(2026, 11, 2, 9, 30, 0, 0, time.UTC)}
}

func mustCreate(t *testing.T, s achievements.Store, p achievements.Person, id string) achievements.Progress {
	t.Helper()
	row, err := s.CreateProgress(context.Background(), p, seedProgress(id))
	if err != nil {
		t.Fatalf("CreateProgress(%s): %v", id, err)
	}
	return row
}

func mustLoad(t *testing.T, s achievements.Store, p achievements.Person, id string) achievements.Progress {
	t.Helper()
	rows, err := s.LoadProgress(context.Background(), p, []string{id})
	if err != nil {
		t.Fatalf("LoadProgress(%s): %v", id, err)
	}
	row, ok := rows[id]
	if !ok {
		t.Fatalf("LoadProgress(%s): row absent", id)
	}
	return row
}

// Run executes every contract case against stores from newStore.
func Run(t *testing.T, newStore Factory) {
	cases := []struct {
		name string
		run  func(t *testing.T, s achievements.Store)
	}{
		{"load leaves missing rows out", loadMissing},
		{"load returns only the requested rows", loadOnlyRequested},
		{"create returns the row with a version", createReturnsRow},
		{"create twice is ErrExists and keeps the first row", createTwice},
		{"save at the current version advances it", saveAdvances},
		{"save at a stale version is ErrConflict and changes nothing", saveStale},
		{"a reload after a conflict saves at the new version", saveAfterReload},
		{"save of a missing row is ErrConflict", saveMissing},
		{"save without a version is ErrConflict and changes nothing", saveUnversioned},
		{"racing saves at one version have exactly one winner", saveRace},
		{"units come back sorted and distinct", unitsNormalised},
		{"held tier ids come back distinct", tierIDsDistinct},
		{"people never see each other's rows", peopleIsolated},
		{"award create twice is ErrExists", awardTwice},
		{"awards are independent per tier id, achievement and person", awardIndependent},
		{"racing award creates have exactly one winner", awardRace},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { c.run(t, newStore(t)) })
	}
}

func loadMissing(t *testing.T, s achievements.Store) {
	rows, err := s.LoadProgress(context.Background(), alice, []string{"a", "b"})
	if err != nil {
		t.Fatalf("LoadProgress: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows = %v, want none", rows)
	}
	rows, err = s.LoadProgress(context.Background(), alice, nil)
	if err != nil || len(rows) != 0 {
		t.Fatalf("LoadProgress(nil) = %v, %v", rows, err)
	}
}

func loadOnlyRequested(t *testing.T, s achievements.Store) {
	mustCreate(t, s, alice, "a")
	mustCreate(t, s, alice, "b")
	rows, err := s.LoadProgress(context.Background(), alice, []string{"a", "c"})
	if err != nil {
		t.Fatalf("LoadProgress: %v", err)
	}
	if _, ok := rows["a"]; !ok || len(rows) != 1 {
		t.Fatalf("rows = %v, want only a", rows)
	}
}

func createReturnsRow(t *testing.T, s achievements.Store) {
	row := mustCreate(t, s, alice, "a")
	if row.Version == "" {
		t.Fatal("created row has no version")
	}
	if row.AchievementID != "a" || len(row.TierIDs) != 0 || len(row.Units) != 0 || row.SchemaVersion != achievements.SchemaVersion {
		t.Fatalf("created row = %+v", row)
	}
	loaded := mustLoad(t, s, alice, "a")
	if loaded.Version != row.Version {
		t.Fatalf("loaded version %q, created version %q", loaded.Version, row.Version)
	}
}

func createTwice(t *testing.T, s achievements.Store) {
	first := mustCreate(t, s, alice, "a")
	saved, err := s.SaveProgress(context.Background(), alice, withUnits(first, bronze, "u1"))
	if err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	if _, err := s.CreateProgress(context.Background(), alice, seedProgress("a")); !errors.Is(err, achievements.ErrExists) {
		t.Fatalf("second create err = %v, want ErrExists", err)
	}
	if got := mustLoad(t, s, alice, "a"); got.Version != saved.Version || !slices.Equal(got.Units, []string{"u1"}) {
		t.Fatalf("row after refused create = %+v, want the saved row", got)
	}
}

var (
	bronze = []string{"bronze"}
	silver = []string{"bronze", "silver"}
)

func sameSet(got, want []string) bool {
	return slices.Equal(slices.Compact(slices.Sorted(slices.Values(got))), slices.Sorted(slices.Values(want)))
}

func withUnits(p achievements.Progress, held []string, units ...string) achievements.Progress {
	p.TierIDs = held
	p.Units = units
	return p
}

func saveAdvances(t *testing.T, s achievements.Store) {
	row := mustCreate(t, s, alice, "a")
	held := [][]string{bronze, silver, {"bronze", "gold", "silver"}}
	for i := 1; i <= 3; i++ {
		next, err := s.SaveProgress(context.Background(), alice, withUnits(row, held[i-1], "u"+strconv.Itoa(i)))
		if err != nil {
			t.Fatalf("save %d: %v", i, err)
		}
		if next.Version == "" || next.Version == row.Version {
			t.Fatalf("save %d version %q did not advance from %q", i, next.Version, row.Version)
		}
		if !sameSet(next.TierIDs, held[i-1]) {
			t.Fatalf("save %d returned tier ids %v", i, next.TierIDs)
		}
		row = next
	}
	loaded := mustLoad(t, s, alice, "a")
	if loaded.Version != row.Version || !sameSet(loaded.TierIDs, held[2]) || !slices.Equal(loaded.Units, []string{"u3"}) {
		t.Fatalf("loaded = %+v, want the last save", loaded)
	}
}

func saveStale(t *testing.T, s achievements.Store) {
	stale := mustCreate(t, s, alice, "a")
	current, err := s.SaveProgress(context.Background(), alice, withUnits(stale, bronze, "winner"))
	if err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	if _, err := s.SaveProgress(context.Background(), alice, withUnits(stale, silver, "loser")); !errors.Is(err, achievements.ErrConflict) {
		t.Fatalf("stale save err = %v, want ErrConflict", err)
	}
	if got := mustLoad(t, s, alice, "a"); got.Version != current.Version || !sameSet(got.TierIDs, bronze) || !slices.Equal(got.Units, []string{"winner"}) {
		t.Fatalf("row after stale save = %+v, want the winner's", got)
	}
}

func saveAfterReload(t *testing.T, s achievements.Store) {
	stale := mustCreate(t, s, alice, "a")
	if _, err := s.SaveProgress(context.Background(), alice, withUnits(stale, nil, "u1")); err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	if _, err := s.SaveProgress(context.Background(), alice, withUnits(stale, nil, "u2")); !errors.Is(err, achievements.ErrConflict) {
		t.Fatalf("stale save err = %v, want ErrConflict", err)
	}
	reloaded := mustLoad(t, s, alice, "a")
	if _, err := s.SaveProgress(context.Background(), alice, withUnits(reloaded, nil, "u1", "u2")); err != nil {
		t.Fatalf("save at reloaded version: %v", err)
	}
	if got := mustLoad(t, s, alice, "a"); !slices.Equal(got.Units, []string{"u1", "u2"}) {
		t.Fatalf("units = %v, want [u1 u2]", got.Units)
	}
}

func saveMissing(t *testing.T, s achievements.Store) {
	p := seedProgress("a")
	p.Version = "1"
	if _, err := s.SaveProgress(context.Background(), alice, p); !errors.Is(err, achievements.ErrConflict) {
		t.Fatalf("save of a missing row err = %v, want ErrConflict", err)
	}
	if rows, _ := s.LoadProgress(context.Background(), alice, []string{"a"}); len(rows) != 0 {
		t.Fatalf("a refused save created %v", rows)
	}
}

func saveUnversioned(t *testing.T, s achievements.Store) {
	row := mustCreate(t, s, alice, "a")
	p := withUnits(row, bronze, "u1")
	p.Version = ""
	if _, err := s.SaveProgress(context.Background(), alice, p); !errors.Is(err, achievements.ErrConflict) {
		t.Fatalf("save without a version err = %v, want ErrConflict", err)
	}
	if got := mustLoad(t, s, alice, "a"); got.Version != row.Version || len(got.Units) != 0 {
		t.Fatalf("a refused save changed the row to %+v", got)
	}
}

func saveRace(t *testing.T, s achievements.Store) {
	const writers = 8
	row := mustCreate(t, s, alice, "a")
	errs := make([]error, writers)
	var wg sync.WaitGroup
	for i := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = s.SaveProgress(context.Background(), alice, withUnits(row, nil, "u"+strconv.Itoa(i)))
		}()
	}
	wg.Wait()
	wins, conflicts := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, achievements.ErrConflict):
			conflicts++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if wins != 1 || conflicts != writers-1 {
		t.Fatalf("wins = %d, conflicts = %d, want 1 and %d", wins, conflicts, writers-1)
	}
}

func unitsNormalised(t *testing.T, s achievements.Store) {
	row := mustCreate(t, s, alice, "a")
	if _, err := s.SaveProgress(context.Background(), alice, withUnits(row, nil, "9:b", "10:a", "9:b", "1:z")); err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	want := []string{"10:a", "1:z", "9:b"}
	if got := mustLoad(t, s, alice, "a").Units; !slices.Equal(got, want) {
		t.Fatalf("units = %v, want %v", got, want)
	}
}

func tierIDsDistinct(t *testing.T, s achievements.Store) {
	row := mustCreate(t, s, alice, "a")
	if _, err := s.SaveProgress(context.Background(), alice, withUnits(row, []string{"silver", "bronze", "silver"})); err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	if got := mustLoad(t, s, alice, "a").TierIDs; len(got) != len(silver) || !sameSet(got, silver) {
		t.Fatalf("tier ids = %v, want the set %v once each", got, silver)
	}
}

func peopleIsolated(t *testing.T, s achievements.Store) {
	row := mustCreate(t, s, alice, "a")
	if _, err := s.SaveProgress(context.Background(), alice, withUnits(row, bronze, "u1")); err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	if rows, err := s.LoadProgress(context.Background(), bob, []string{"a"}); err != nil || len(rows) != 0 {
		t.Fatalf("bob sees %v, %v", rows, err)
	}
	if _, err := s.CreateProgress(context.Background(), bob, seedProgress("a")); err != nil {
		t.Fatalf("bob's create: %v", err)
	}
	if got := mustLoad(t, s, alice, "a"); !sameSet(got.TierIDs, bronze) {
		t.Fatalf("alice's row changed: %+v", got)
	}
}

func awardTwice(t *testing.T, s achievements.Store) {
	if err := s.CreateAward(context.Background(), alice, award("a", "bronze")); err != nil {
		t.Fatalf("first award: %v", err)
	}
	if err := s.CreateAward(context.Background(), alice, award("a", "bronze")); !errors.Is(err, achievements.ErrExists) {
		t.Fatalf("second award err = %v, want ErrExists", err)
	}
}

func awardIndependent(t *testing.T, s achievements.Store) {
	for _, c := range []struct {
		person achievements.Person
		id     string
		tierID string
	}{{alice, "a", "bronze"}, {alice, "a", "silver"}, {alice, "b", "bronze"}, {bob, "a", "bronze"}, {alice, "bronze", "a"}} {
		if err := s.CreateAward(context.Background(), c.person, award(c.id, c.tierID)); err != nil {
			t.Fatalf("award %+v: %v", c, err)
		}
	}
}

func awardRace(t *testing.T, s achievements.Store) {
	const writers = 8
	errs := make([]error, writers)
	var wg sync.WaitGroup
	for i := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = s.CreateAward(context.Background(), alice, award("a", "bronze"))
		}()
	}
	wg.Wait()
	wins, exists := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, achievements.ErrExists):
			exists++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if wins != 1 || exists != writers-1 {
		t.Fatalf("wins = %d, exists = %d, want 1 and %d", wins, exists, writers-1)
	}
}

// Memory is an in-memory Store with the semantics the contract requires.
type Memory struct {
	mu       sync.Mutex
	progress map[string]achievements.Progress
	awards   map[string]achievements.Award
	version  int
}

func NewMemory() *Memory {
	return &Memory{progress: map[string]achievements.Progress{}, awards: map[string]achievements.Award{}}
}

func key(p achievements.Person, parts ...string) string {
	k := p.ID
	for _, part := range parts {
		k += "\x00" + part
	}
	return k
}

func (m *Memory) put(k string, p achievements.Progress) achievements.Progress {
	m.version++
	p.Version = strconv.Itoa(m.version)
	p.TierIDs = slices.Compact(slices.Sorted(slices.Values(p.TierIDs)))
	p.Units = slices.Compact(slices.Sorted(slices.Values(p.Units)))
	m.progress[k] = p
	return p
}

func (m *Memory) LoadProgress(_ context.Context, person achievements.Person, ids []string) (map[string]achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]achievements.Progress{}
	for _, id := range ids {
		if p, ok := m.progress[key(person, id)]; ok {
			out[id] = p
		}
	}
	return out, nil
}

func (m *Memory) CreateProgress(_ context.Context, person achievements.Person, p achievements.Progress) (achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(person, p.AchievementID)
	if _, ok := m.progress[k]; ok {
		return achievements.Progress{}, achievements.ErrExists
	}
	return m.put(k, p), nil
}

func (m *Memory) SaveProgress(_ context.Context, person achievements.Person, p achievements.Progress) (achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(person, p.AchievementID)
	if current, ok := m.progress[k]; !ok || current.Version != p.Version {
		return achievements.Progress{}, achievements.ErrConflict
	}
	return m.put(k, p), nil
}

func (m *Memory) CreateAward(_ context.Context, person achievements.Person, a achievements.Award) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(person, a.AchievementID, a.TierID)
	if _, ok := m.awards[k]; ok {
		return achievements.ErrExists
	}
	m.awards[k] = a
	return nil
}
