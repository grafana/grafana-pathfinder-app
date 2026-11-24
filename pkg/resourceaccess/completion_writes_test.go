package resourceaccess

import (
	"context"
	"encoding/json"
	"errors"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/rest"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSDKAttemptRetriesConflictAndPreservesStoredFields(t *testing.T) {
	gets, puts := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			gets++
			_, _ = w.Write([]byte(`{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"CompletionRecord","metadata":{"name":"attempt","namespace":"default","resourceVersion":"42","managedFields":[{}],"annotations":{"pathfinder.grafana.com/attempt-started-at":"2026-11-13T00:00:00Z"}},"spec":{"userId":"user:1","guideId":"guide","guideSource":"app-platform","completionPercent":20,"future":9007199254740993}}`))
			return
		}
		if r.Method != http.MethodPut {
			t.Errorf("unexpected method %s", r.Method)
		}
		puts++
		var obj map[string]any
		decoder := json.NewDecoder(r.Body)
		decoder.UseNumber()
		if err := decoder.Decode(&obj); err != nil {
			t.Error(err)
			return
		}
		meta := obj["metadata"].(map[string]any)
		spec := obj["spec"].(map[string]any)
		if meta["resourceVersion"] != "42" || meta["managedFields"] != nil || spec["future"] != json.Number("9007199254740993") || spec["completionPercent"] != json.Number("50") {
			t.Errorf("lost stored data: %+v", obj)
		}
		if puts == 1 {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"kind":"Status","code":409,"reason":"Conflict"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(obj)
	}))
	defer server.Close()
	writer, err := NewCompletionWriter(sdkplugin.BuildClientGenerator(BoundedConfig(rest.Config{Host: server.URL, APIPath: "/apis"}, CompletionWriteMaxBytes)))
	if err != nil {
		t.Fatal(err)
	}
	outcome, _, err := services.UpsertCompletionAttempt(context.Background(), writer, "default", "attempt", services.CompletionRecordWriteSpec{UserID: "user:1", GuideID: "guide", GuideSource: "app-platform", CompletionPercent: 50}, func(err error) (int, string) {
		var status apierrors.APIStatus
		if errors.As(err, &status) {
			return int(status.Status().Code), string(status.Status().Reason)
		}
		return 0, ""
	})
	if err != nil || outcome != services.AttemptUpdated || gets != 2 || puts != 2 {
		t.Fatalf("outcome=%v err=%v gets=%d puts=%d", outcome, err, gets, puts)
	}
}
