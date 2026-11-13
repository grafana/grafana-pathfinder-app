package resourceaccess

import (
	"context"
	"encoding/json"

	"github.com/grafana/grafana-app-sdk/resource"
	records "github.com/grafana/grafana-pathfinder-app/pkg/generated/completionrecord/v1alpha1"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

type CompletionStore struct {
	client *records.CompletionRecordClient
}

type CompletionPage struct {
	Records  []services.CompletionRecord
	Continue string
}

func NewCompletionStore(generator resource.ClientGenerator) (*CompletionStore, error) {
	client, err := records.NewCompletionRecordClientFromGenerator(generator)
	if err != nil {
		return nil, err
	}
	return &CompletionStore{client: client}, nil
}

func (s *CompletionStore) ListPage(ctx context.Context, namespace, token string) (CompletionPage, error) {
	ctx, cancel := context.WithTimeout(ctx, services.SettingsReadTimeout)
	defer cancel()
	page, err := s.client.List(ctx, namespace, resource.ListOptions{Limit: 500, Continue: token})
	if err != nil {
		return CompletionPage{}, err
	}
	result := CompletionPage{Continue: page.Continue, Records: make([]services.CompletionRecord, 0, len(page.Items))}
	for _, item := range page.Items {
		body, err := json.Marshal(item.Spec)
		if err != nil {
			return CompletionPage{}, err
		}
		record, err := services.DecodeCompletionRecord(body, item.Annotations)
		if err != nil {
			return CompletionPage{}, err
		}
		result.Records = append(result.Records, record)
	}
	return result, nil
}

func (s *CompletionStore) ReadCaller(ctx context.Context, namespace, subject string) ([]services.CompletionRecord, error) {
	records := []services.CompletionRecord{}
	token := ""
	for {
		page, err := s.ListPage(ctx, namespace, token)
		if err != nil {
			return nil, err
		}
		for _, record := range page.Records {
			if record.UserID == subject {
				records = append(records, record)
			}
		}
		if page.Continue == "" {
			return records, nil
		}
		token = page.Continue
	}
}
