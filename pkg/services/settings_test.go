package services

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

func TestSettingsAbsenceRequiresExactResourceStatus(t *testing.T) {
	body, err := os.ReadFile("../plugin/testdata/upstream/pathfindersettings-not-found.json")
	if err != nil {
		t.Fatal(err)
	}
	if !IsSettingsNotConfigured(404, body) {
		t.Fatal("expected confirmed absence")
	}
	for _, status := range []int{403, 429, 503} {
		if IsSettingsNotConfigured(status, body) {
			t.Fatalf("accepted status %d", status)
		}
	}
	var object map[string]any
	if err := json.Unmarshal(body, &object); err != nil {
		t.Fatal(err)
	}
	details := object["details"].(map[string]any)
	for _, key := range []string{"group", "kind", "name"} {
		original := details[key]
		details[key] = "another-resource"
		changed, err := json.Marshal(object)
		if err != nil {
			t.Fatal(err)
		}
		if IsSettingsNotConfigured(404, changed) {
			t.Fatalf("accepted mismatched %s", key)
		}
		details[key] = original
	}
	if IsSettingsNotConfigured(404, []byte("not json")) {
		t.Fatal("accepted malformed status")
	}
}

func TestReadSettingsPreservesContextNamespaceAndResource(t *testing.T) {
	type key struct{}
	ctx := context.WithValue(context.Background(), key{}, "caller")
	body := json.RawMessage(`{"metadata":{"resourceVersion":"42"},"spec":{"futureField":true}}`)
	got, err := ReadSettings(ctx, "stacks-1", func(ctx context.Context, namespace string) (json.RawMessage, error) {
		if namespace != "stacks-1" || ctx.Value(key{}) != "caller" {
			t.Fatal("lost caller context")
		}
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > SettingsReadTimeout {
			t.Fatal("missing bounded deadline")
		}
		return body, nil
	})
	if err != nil || string(got) != string(body) {
		t.Fatalf("body=%s err=%v", got, err)
	}
}

func TestReadSettingsPreservesCancellationAndErrors(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := ReadSettings(ctx, "stacks-1", func(ctx context.Context, _ string) (json.RawMessage, error) {
		return nil, ctx.Err()
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}
