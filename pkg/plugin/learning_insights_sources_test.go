package plugin

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestLearningInsightsOnlineSourceHonorsCancellation(t *testing.T) {
	prior := packageRepositoryFetcherOverride
	packageRepositoryFetcherOverride = func(ctx context.Context, _ string, _ int64) ([]byte, error) {
		if !errors.Is(ctx.Err(), context.Canceled) {
			t.Fatal("report cancellation lost")
		}
		return nil, ctx.Err()
	}
	t.Cleanup(func() { packageRepositoryFetcherOverride = prior })
	r := insightsRequest(t, "Admin", "user:1")
	ctx, cancel := context.WithCancel(r.Context())
	cancel()
	ev := newTestApp(t).insightsObligationEvaluator(r.WithContext(ctx))
	_, _, err := ev.sources[2](ctx, "not-in-catalogue", "", "")
	if err == nil {
		t.Fatal("canceled resolution succeeded")
	}
}

func TestLearningInsightsSourceMemberIdentityAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(insightsRequest(t, "Admin", "user:1").Context())
	defer cancel()
	withFetcherOverride(t, func(fetchCtx context.Context, rawURL string, _ int64) ([]byte, error) {
		if fetchCtx != ctx {
			t.Fatal("reporting source changed caller context")
		}
		switch {
		case strings.HasSuffix(rawURL, "repository.json"):
			return []byte(`{"path":{"path":"path","type":"path"},"member":{"path":"guides/member","type":"guide"}}`), nil
		case strings.HasSuffix(rawURL, "/path/manifest.json"):
			return []byte(`{"type":"path","repository":"interactive-tutorials","milestones":["member"]}`), nil
		case strings.HasSuffix(rawURL, "/guides/member/manifest.json"):
			cancel()
			return nil, fetchCtx.Err()
		default:
			t.Fatalf("unexpected URL %s", rawURL)
			return nil, nil
		}
	})
	r := insightsRequest(t, "Admin", "user:1").WithContext(ctx)
	ev := newTestApp(t).insightsObligationEvaluator(r)
	guides, found, err := ev.sources[2](ctx, "path", "", "interactive-tutorials")
	if guides != nil || !found || !errors.Is(err, context.Canceled) {
		t.Fatalf("guides = %+v, found = %v, error = %v", guides, found, err)
	}
}

func TestLearningInsightsCustomSourceCancellation(t *testing.T) {
	withGuideLister(t, singlePageGuideLister())
	r := insightsRequest(t, "Admin", "user:1")
	ctx, cancel := context.WithCancel(r.Context())
	cancel()
	ev := newTestApp(t).insightsObligationEvaluator(r.WithContext(ctx))
	guides, found, err := ev.sources[1](ctx, "path", "", "app-platform")
	if guides != nil || found || err == nil {
		t.Fatalf("canceled custom lookup resolved: %+v, %v, %v", guides, found, err)
	}
}

func TestLearningInsightsCustomSourceQualifiedProgress(t *testing.T) {
	path := guideEntry("path", "Path", "published", "path")
	path.Manifest.Milestones = []string{"member"}
	member := guideEntry("member", "Member", "published", "guide")
	member.Manifest.Repository = "online-cdn"
	withGuideLister(t, singlePageGuideLister(path, member))
	r := insightsRequest(t, "Admin", "user:1")
	ev := newTestApp(t).insightsObligationEvaluator(r)
	guides, found, err := ev.sources[1](r.Context(), "path", "", "app-platform")
	if err != nil || !found || len(guides) != 1 || guides[0].GuideSource != "online-cdn" {
		t.Fatalf("guides = %+v, found = %v, error = %v", guides, found, err)
	}
	guides, found, err = ev.sources[1](r.Context(), "path", "", "bundled")
	if err != nil || found || guides != nil {
		t.Fatalf("wrong target source resolved: %+v, %v, %v", guides, found, err)
	}
}

type insightsNamespaceLister struct{ namespaces []string }

func (l *insightsNamespaceLister) ListPage(_ context.Context, namespace, _ string) (*completionRecordPage, error) {
	l.namespaces = append(l.namespaces, namespace)
	return &completionRecordPage{}, nil
}

func TestLearningInsightsTrustedNamespaceAndReauthorization(t *testing.T) {
	l := &insightsNamespaceLister{}
	withLister(t, l)
	withAssignmentLister(t, singlePageAssignmentLister())
	r := insightsRequest(t, "Admin", "user:1")
	r.URL.RawQuery += "&namespace=attacker-stack"
	_, resp := insightsResponse(t, r)
	if !resp.Capability.Available || len(l.namespaces) != 1 || l.namespaces[0] != testNamespace {
		t.Fatal(l.namespaces, resp)
	}
	insightsResponse(t, insightsRequest(t, "Viewer", "user:1"))
	insightsResponse(t, insightsRequest(t, "Admin", ""))
	if len(l.namespaces) != 1 {
		t.Fatal("previous read bypassed authorization")
	}
}
