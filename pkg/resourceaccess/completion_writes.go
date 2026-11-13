package resourceaccess

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/grafana/grafana-app-sdk/resource"
	records "github.com/grafana/grafana-pathfinder-app/pkg/generated/completionrecord/v1alpha1"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

const CompletionWriteMaxBytes = 256 * 1024

type CompletionWriter struct{ client resource.Client }

func NewCompletionWriter(generator resource.ClientGenerator) (*CompletionWriter, error) {
	client, err := generator.ClientFor(records.Kind())
	if err != nil {
		return nil, err
	}
	return &CompletionWriter{client: client}, nil
}

type rawCompletion struct {
	records.CompletionRecord
	body json.RawMessage
}

func (r *rawCompletion) UnmarshalJSON(body []byte) error {
	if len(body) > CompletionWriteMaxBytes {
		return errors.New("completion response too large")
	}
	if err := json.Unmarshal(body, &r.CompletionRecord); err != nil {
		return err
	}
	r.body = append(r.body[:0], body...)
	return nil
}
func (r *rawCompletion) MarshalJSON() ([]byte, error) {
	object := &rawWritableResource{}
	if err := object.UnmarshalJSON(r.body); err != nil {
		return nil, err
	}
	object.TypeMeta, object.ObjectMeta = r.TypeMeta, r.ObjectMeta
	return object.MarshalJSON()
}

func (s *CompletionWriter) Create(ctx context.Context, namespace string, obj services.CompletionRecordObject) error {
	body, err := json.Marshal(obj)
	if err != nil {
		return err
	}
	raw := &rawCompletion{}
	if err := raw.UnmarshalJSON(body); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return s.client.CreateInto(ctx, resource.Identifier{Namespace: namespace, Name: obj.Metadata.Name}, raw, resource.CreateOptions{}, &rawCompletion{})
}
func (s *CompletionWriter) Get(ctx context.Context, namespace, name string) (*services.StoredCompletionRecord, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	raw := &rawCompletion{}
	if err := s.client.GetInto(ctx, resource.Identifier{Namespace: namespace, Name: name}, raw); err != nil {
		var status apierrors.APIStatus
		if errors.As(err, &status) && status.Status().Code == http.StatusNotFound && status.Status().Reason == "NotFound" {
			return nil, nil
		}
		return nil, err
	}
	var object map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw.body))
	decoder.UseNumber()
	if err := decoder.Decode(&object); err != nil {
		return nil, err
	}
	if metadata, ok := object["metadata"].(map[string]any); ok {
		delete(metadata, "managedFields")
	}
	var typed struct {
		Spec services.CompletionRecordWriteSpec `json:"spec"`
	}
	if err := json.Unmarshal(raw.body, &typed); err != nil {
		return nil, err
	}
	return &services.StoredCompletionRecord{Raw: object, Spec: typed.Spec}, nil
}
func (s *CompletionWriter) Replace(ctx context.Context, namespace, name string, obj map[string]any) error {
	body, err := json.Marshal(obj)
	if err != nil {
		return err
	}
	raw := &rawCompletion{}
	if err := raw.UnmarshalJSON(body); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return s.client.UpdateInto(ctx, resource.Identifier{Namespace: namespace, Name: name}, raw, resource.UpdateOptions{ResourceVersion: raw.ResourceVersion}, &rawCompletion{})
}

var _ services.CompletionRecordUpdater = (*CompletionWriter)(nil)
