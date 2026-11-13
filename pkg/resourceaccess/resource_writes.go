package resourceaccess

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type rawWritableResource struct {
	resource.UntypedObject
	fields map[string]json.RawMessage
}

func (r *rawWritableResource) UnmarshalJSON(body []byte) error {
	if err := json.Unmarshal(body, &r.fields); err != nil {
		return err
	}
	var metadata struct {
		metav1.TypeMeta
		Metadata metav1.ObjectMeta `json:"metadata"`
	}
	if err := json.Unmarshal(body, &metadata); err != nil {
		return err
	}
	r.TypeMeta = metadata.TypeMeta
	r.ObjectMeta = metadata.Metadata
	return nil
}
func (r *rawWritableResource) MarshalJSON() ([]byte, error) {
	fields := make(map[string]json.RawMessage, len(r.fields))
	for key, value := range r.fields {
		fields[key] = value
	}
	var metadata map[string]json.RawMessage
	if err := json.Unmarshal(fields["metadata"], &metadata); err != nil {
		return nil, err
	}
	if metadata == nil {
		metadata = map[string]json.RawMessage{}
	}
	for key, value := range map[string]string{"name": r.Name, "namespace": r.Namespace, "resourceVersion": r.ResourceVersion} {
		if value != "" {
			metadata[key], _ = json.Marshal(value)
		}
	}
	fields["metadata"], _ = json.Marshal(metadata)
	fields["kind"], _ = json.Marshal(r.Kind)
	fields["apiVersion"], _ = json.Marshal(r.APIVersion)
	return json.Marshal(fields)
}

func writeResource(ctx context.Context, client resource.Client, namespace string, body json.RawMessage, create bool) (json.RawMessage, error) {
	object := &rawWritableResource{}
	if err := object.UnmarshalJSON(body); err != nil {
		return nil, err
	}
	if object.Name == "" || (object.Namespace != "" && object.Namespace != namespace) {
		return nil, errors.New("resource identity mismatch")
	}
	if !create && object.ResourceVersion == "" {
		return nil, errors.New("resource version required")
	}
	ctx, cancel := context.WithTimeout(ctx, services.SettingsReadTimeout)
	defer cancel()
	into := &rawWritableResource{}
	id := resource.Identifier{Namespace: namespace, Name: object.Name}
	var err error
	if create {
		err = client.CreateInto(ctx, id, object, resource.CreateOptions{}, into)
	} else {
		err = client.UpdateInto(ctx, id, object, resource.UpdateOptions{ResourceVersion: object.ResourceVersion}, into)
	}
	if err != nil {
		return nil, err
	}
	return into.MarshalJSON()
}

func (s *GuideStore) Write(ctx context.Context, namespace string, body json.RawMessage, create bool) (json.RawMessage, error) {
	return writeResource(ctx, s.client, namespace, body, create)
}
func (s *SettingsStore) Write(ctx context.Context, namespace string, body json.RawMessage, create bool) (json.RawMessage, error) {
	return writeResource(ctx, s.client, namespace, body, create)
}
func (s *GuideStore) Delete(ctx context.Context, namespace, name string) error {
	ctx, cancel := context.WithTimeout(ctx, services.SettingsReadTimeout)
	defer cancel()
	return s.client.Delete(ctx, resource.Identifier{Namespace: namespace, Name: name}, resource.DeleteOptions{})
}
