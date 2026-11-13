package resourceaccess

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/grafana/grafana-app-sdk/resource"
	settings "github.com/grafana/grafana-pathfinder-app/pkg/generated/pathfindersettings/v1alpha1"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

type SettingsStore struct{ client resource.Client }

func NewSettingsStore(generator resource.ClientGenerator) (*SettingsStore, error) {
	client, err := generator.ClientFor(settings.Kind())
	if err != nil {
		return nil, err
	}
	return &SettingsStore{client: client}, nil
}

func (s *SettingsStore) Read(ctx context.Context, namespace string) (json.RawMessage, error) {
	object := &rawSettings{}
	err := s.client.GetInto(ctx, resource.Identifier{Namespace: namespace, Name: "default"}, object)
	if err != nil {
		return nil, err
	}
	return object.body, nil
}

// Preserve unknown fields that generated typed decoding would discard before a settings update.
type rawSettings struct {
	settings.PathfinderSettings
	body json.RawMessage
}

func (r *rawSettings) UnmarshalJSON(body []byte) error {
	if len(body) > services.SettingsMaxBytes {
		return errors.New("settings response too large")
	}
	if !json.Valid(body) {
		return errors.New("invalid settings response")
	}
	r.body = append(r.body[:0], body...)
	return nil
}
