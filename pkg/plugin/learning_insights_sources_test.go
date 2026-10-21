package plugin

import (
	"context"
	"errors"
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
	_, _, err := ev.sources[2](ctx, "not-in-catalogue", "")
	if err == nil {
		t.Fatal("canceled resolution succeeded")
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
