package resourceaccess

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/grafana/grafana-app-sdk/resource"
	guides "github.com/grafana/grafana-pathfinder-app/pkg/generated/interactiveguide/v1alpha1"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

const GuidePageMaxBytes = 8 * 1024 * 1024

type GuideStore struct{ client resource.Client }

func NewGuideStore(generator resource.ClientGenerator) (*GuideStore, error) {
	client, err := generator.ClientFor(rawGuideKind())
	if err != nil {
		return nil, err
	}
	return &GuideStore{client: client}, nil
}

func (s *GuideStore) Read(ctx context.Context, namespace, name string) (json.RawMessage, error) {
	object := &rawGuide{}
	err := s.client.GetInto(ctx, resource.Identifier{Namespace: namespace, Name: name}, object)
	var syntax *json.SyntaxError
	if errors.As(err, &syntax) {
		return nil, &ResponseValidationError{Reason: "invalid-json", Status: 200}
	}
	return object.body, err
}

func (s *GuideStore) ListPage(ctx context.Context, namespace, token string) (services.GuidePage, error) {
	ctx, cancel := context.WithTimeout(ctx, services.SettingsReadTimeout)
	defer cancel()
	page := &rawGuideList{}
	err := s.client.ListInto(ctx, namespace, resource.ListOptions{Limit: 100, Continue: token}, page)
	var syntax *json.SyntaxError
	if errors.As(err, &syntax) {
		err = &ResponseValidationError{Reason: "invalid-json", Status: 200}
	}
	return services.GuidePage{Items: page.items, Continue: page.GetContinue()}, err
}

type rawGuide struct {
	guides.InteractiveGuide
	body json.RawMessage
}

func (r *rawGuide) UnmarshalJSON(body []byte) error {
	if len(body) > GuidePageMaxBytes {
		return &ResponseValidationError{Reason: "response-too-large", Status: 200}
	}
	if !json.Valid(body) {
		return &ResponseValidationError{Reason: "invalid-json", Status: 200}
	}
	r.body = append(r.body[:0], body...)
	return nil
}

type rawGuideSchema struct{ resource.Schema }

func (s rawGuideSchema) ZeroValue() resource.Object { return &rawGuide{} }

func rawGuideKind() resource.Kind {
	kind := guides.Kind()
	kind.Schema = rawGuideSchema{Schema: kind.Schema}
	return kind
}

type rawGuideList struct {
	guides.InteractiveGuideList
	items []json.RawMessage
}

func (r *rawGuideList) SetItems(items []resource.Object) {
	r.items = make([]json.RawMessage, len(items))
	for i, item := range items {
		r.items[i] = item.(*rawGuide).body
	}
}
