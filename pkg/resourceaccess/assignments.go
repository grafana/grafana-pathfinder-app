package resourceaccess

import (
	"context"
	"encoding/json"
	"errors"
	authlib "github.com/grafana/authlib/types"

	"github.com/grafana/grafana-app-sdk/resource"
	records "github.com/grafana/grafana-pathfinder-app/pkg/generated/assignment/v1alpha1"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

type AssignmentStore struct {
	client *records.AssignmentClient
}

func NewAssignmentStore(generator resource.ClientGenerator) (*AssignmentStore, error) {
	client, err := records.NewAssignmentClientFromGenerator(generator)
	if err != nil {
		return nil, err
	}
	return &AssignmentStore{client: client}, nil
}

func (s *AssignmentStore) ListPage(ctx context.Context, namespace, token string) (*services.AssignmentPage, error) {
	ctx, cancel := context.WithTimeout(ctx, services.SettingsReadTimeout)
	defer cancel()
	page, err := s.client.List(ctx, namespace, resource.ListOptions{Limit: 500, Continue: token})
	if err != nil {
		return nil, err
	}
	result := &services.AssignmentPage{Continue: page.Continue, Records: make([]services.Assignment, 0, len(page.Items))}
	for _, item := range page.Items {
		body, err := json.Marshal(item.Spec)
		if err != nil {
			return nil, err
		}
		var record services.Assignment
		if err := json.Unmarshal(body, &record); err != nil {
			return nil, err
		}
		record.Name = item.Name
		record.ResourceVersion = item.ResourceVersion
		record.StatusSatisfied = item.Status.Satisfied
		result.Records = append(result.Records, record)
	}
	return result, nil
}

func (s *AssignmentStore) UpdateStatus(ctx context.Context, namespace, name, resourceVersion string, satisfied bool) error {
	ctx, cancel := context.WithTimeout(ctx, services.SettingsReadTimeout)
	defer cancel()
	_, err := s.client.UpdateStatus(ctx, resource.Identifier{Namespace: namespace, Name: name}, records.Status{Satisfied: &satisfied}, resource.UpdateOptions{ResourceVersion: resourceVersion})
	return err
}

var _ services.AssignmentReader = (*AssignmentStore)(nil)

// Status is app-maintained; the record must first be evaluated through caller-delegated reads.
func (s *AssignmentStore) MarkSatisfied(ctx context.Context, namespace string, record services.Assignment) error {
	identity, ok := authlib.AuthInfoFrom(ctx)
	if !ok || namespace == "" || namespace == "*" || identity.GetNamespace() != namespace || identity.GetSubject() != record.UserID || record.Name == "" || record.ResourceVersion == "" {
		return errors.New("assignment status repair requires a bound caller-owned record")
	}
	// A fresh context selects SDK app credentials for this status-only operation.
	appCtx, cancel := context.WithTimeout(context.Background(), services.SettingsReadTimeout)
	defer cancel()
	return s.UpdateStatus(appCtx, namespace, record.Name, record.ResourceVersion, true)
}
