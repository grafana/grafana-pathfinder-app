package plugin

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/useragent"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

// The CDN holds one definitions file per format version; a build reads only its own.
const (
	achievementsCDNBase = "https://interactive-learning.grafana.net/"
	achievementsArtBase = achievementsCDNBase + "achievements/art/"

	definitionsFetchTimeout    = 5 * time.Second
	definitionsRevalidateAfter = 10 * time.Minute
	definitionsBackoffMin      = time.Minute
	definitionsBackoffMax      = 10 * time.Minute
	definitionsColdStartWait   = 2 * time.Second

	errDefinitionsUnavailable = "definitions-unavailable"
)

// definitionsProvider returns nil and a retry delay when no definitions are loaded.
type definitionsProvider interface {
	Snapshot(ctx context.Context) (*achievements.Snapshot, time.Duration)
}

// definitionsSource never replaces its last good copy with a failed or unreadable fetch.
type definitionsSource struct {
	url           string
	client        *http.Client
	now           func() time.Time
	coldStartWait time.Duration
	logger        log.Logger

	current atomic.Pointer[achievements.Snapshot]

	mu        sync.Mutex
	etag      string
	checkedAt time.Time
	retryAt   time.Time
	failures  int
	flight    chan struct{}
}

// Process-wide is safe here: definitions are public and the same for every caller.
var processDefinitions = sync.OnceValues(func() (*definitionsSource, error) {
	return newDefinitionsSource(achievementsCDNBase, achievements.DefinitionsPath, allowedPackageRepositoryHosts, &http.Client{})
})

func newDefinitionsSource(base, path string, allowedHosts map[string]struct{}, client *http.Client) (*definitionsSource, error) {
	u, err := url.Parse(base)
	if err != nil {
		return nil, fmt.Errorf("definitions base: %w", err)
	}
	u = u.JoinPath(path)
	if u.Scheme != "https" || u.User != nil {
		return nil, fmt.Errorf("definitions URL %q must be plain https", u.Redacted())
	}
	if _, ok := allowedHosts[u.Hostname()]; !ok {
		return nil, fmt.Errorf("definitions host %q is not allowlisted", u.Hostname())
	}
	c := *client
	c.Timeout = definitionsFetchTimeout
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &definitionsSource{url: u.String(), client: &c, now: time.Now, coldStartWait: definitionsColdStartWait, logger: log.DefaultLogger}, nil
}

func (s *definitionsSource) Snapshot(ctx context.Context) (*achievements.Snapshot, time.Duration) {
	flight := s.refreshIfDue()
	if snap := s.current.Load(); snap != nil {
		return snap, 0
	}
	if flight != nil {
		wait := time.NewTimer(s.coldStartWait)
		defer wait.Stop()
		select {
		case <-flight:
		case <-wait.C:
		case <-ctx.Done():
		}
		if snap := s.current.Load(); snap != nil {
			return snap, 0
		}
	}
	return nil, s.retryAfter()
}

func (s *definitionsSource) refreshIfDue() chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.flight != nil {
		return s.flight
	}
	now := s.now()
	loaded := s.current.Load() != nil
	if now.Before(s.retryAt) || (loaded && now.Sub(s.checkedAt) < definitionsRevalidateAfter) {
		return nil
	}
	etag := ""
	if loaded {
		etag = s.etag
	}
	s.flight = make(chan struct{})
	go s.refresh(s.flight, etag)
	return s.flight
}

func (s *definitionsSource) refresh(done chan struct{}, etag string) {
	snap, newETag, err := s.fetch(etag)

	s.mu.Lock()
	defer func() {
		s.flight = nil
		s.mu.Unlock()
		close(done)
	}()
	now := s.now()
	if err != nil {
		s.failures++
		s.retryAt = now.Add(definitionsBackoff(s.failures))
		s.logger.Warn("achievement definitions fetch failed, keeping the last good copy", "error", err, "failures", s.failures, "loaded", s.current.Load() != nil)
		return
	}
	s.failures = 0
	s.retryAt = time.Time{}
	s.checkedAt = now
	if snap == nil {
		return
	}
	if len(snap.Skipped) > 0 {
		s.logger.Warn("achievement definitions loaded with skipped entries", "version", snap.Version, "skipped", len(snap.Skipped))
	}
	s.etag = newETag
	s.current.Store(snap)
}

// fetch returns a nil snapshot and no error on 304.
func (s *definitionsSource) fetch(etag string) (*achievements.Snapshot, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), definitionsFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return nil, "", err
	}
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = resp.Body.Close() }()

	switch {
	case resp.StatusCode == http.StatusNotModified && etag != "":
		return nil, etag, nil
	case resp.StatusCode != http.StatusOK:
		return nil, "", fmt.Errorf("definitions: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, achievements.MaxBundleBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(body) > achievements.MaxBundleBytes {
		return nil, "", errors.New("definitions: body over the size cap")
	}
	snap, err := achievements.LoadBundle(body)
	if err != nil {
		return nil, "", err
	}
	return snap, resp.Header.Get("ETag"), nil
}

func (s *definitionsSource) retryAfter() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return max(s.retryAt.Sub(s.now()), time.Second)
}

func definitionsBackoff(failures int) time.Duration {
	d := definitionsBackoffMin
	for i := 1; i < failures && d < definitionsBackoffMax; i++ {
		d *= 2
	}
	return min(d, definitionsBackoffMax)
}

// Missing definitions are a retryable 503, never the structural 404 that disarms the client.
func (a *App) achievementDefinitions(w http.ResponseWriter, r *http.Request) (*achievements.Snapshot, bool) {
	snap, retryAfter := a.definitions.Snapshot(r.Context())
	if snap != nil {
		return snap, true
	}
	w.Header().Set("Retry-After", strconv.Itoa(int((retryAfter+time.Second-1)/time.Second)))
	a.writeError(w, errDefinitionsUnavailable, http.StatusServiceUnavailable)
	return nil, false
}

type achievementDefinitionsResponse struct {
	Version      string                 `json:"version"`
	ArtBase      string                 `json:"artBase"`
	Achievements []achievements.Display `json:"achievements"`
	// Sources are the Echo interactions the browser subscribes to on this stack.
	Sources []achievements.SourceSubscription `json:"sources"`
}

// stackFromRequest reads the Grafana version from the user agent Grafana sends
// with every plugin request. It describes the stack, never the caller.
func stackFromRequest(r *http.Request) achievements.Stack {
	ua := useragent.FromContext(r.Context())
	if ua.IsUnknown() {
		return achievements.Stack{}
	}
	return achievements.Stack{GrafanaVersion: ua.GrafanaVersion()}
}

// handleAchievementDefinitions serves GET /api/v1/achievements/definitions.
func (a *App) handleAchievementDefinitions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, _, _, ok, reason := a.resolveCompletionConfig(r); !ok {
		a.writeAchievementsUnavailable(w, reason, "read")
		return
	}
	if a.definitions == nil {
		a.writeAchievementsUnavailable(w, reasonBackendUnavailable, "read")
		return
	}
	snap, ok := a.achievementDefinitions(w, r)
	if !ok {
		return
	}
	stack := stackFromRequest(r)
	a.writeJSON(w, achievementDefinitionsResponse{
		Version:      snap.Version,
		ArtBase:      achievementsArtBase,
		Achievements: snap.DisplayFor(stack),
		Sources:      snap.Registry.Subscriptions(stack),
	}, http.StatusOK)
}
