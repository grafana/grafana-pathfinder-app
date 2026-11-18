package v1alpha1

import (
	"context"

	"github.com/grafana/grafana-app-sdk/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type PathfinderSettingsClient struct {
	client *resource.TypedClient[*PathfinderSettings, *PathfinderSettingsList]
}

func NewPathfinderSettingsClient(client resource.Client) *PathfinderSettingsClient {
	return &PathfinderSettingsClient{
		client: resource.NewTypedClient[*PathfinderSettings, *PathfinderSettingsList](client, Kind()),
	}
}

func NewPathfinderSettingsClientFromGenerator(generator resource.ClientGenerator) (*PathfinderSettingsClient, error) {
	c, err := generator.ClientFor(Kind())
	if err != nil {
		return nil, err
	}
	return NewPathfinderSettingsClient(c), nil
}

func (c *PathfinderSettingsClient) Get(ctx context.Context, identifier resource.Identifier) (*PathfinderSettings, error) {
	return c.client.Get(ctx, identifier)
}

func (c *PathfinderSettingsClient) List(ctx context.Context, namespace string, opts resource.ListOptions) (*PathfinderSettingsList, error) {
	return c.client.List(ctx, namespace, opts)
}

func (c *PathfinderSettingsClient) ListAll(ctx context.Context, namespace string, opts resource.ListOptions) (*PathfinderSettingsList, error) {
	resp, err := c.client.List(ctx, namespace, resource.ListOptions{
		ResourceVersion: opts.ResourceVersion,
		Limit:           opts.Limit,
		LabelFilters:    opts.LabelFilters,
		FieldSelectors:  opts.FieldSelectors,
	})
	if err != nil {
		return nil, err
	}
	for resp.GetContinue() != "" {
		page, err := c.client.List(ctx, namespace, resource.ListOptions{
			Continue:        resp.GetContinue(),
			ResourceVersion: opts.ResourceVersion,
			Limit:           opts.Limit,
			LabelFilters:    opts.LabelFilters,
			FieldSelectors:  opts.FieldSelectors,
		})
		if err != nil {
			return nil, err
		}
		resp.SetContinue(page.GetContinue())
		resp.SetResourceVersion(page.GetResourceVersion())
		resp.SetItems(append(resp.GetItems(), page.GetItems()...))
	}
	return resp, nil
}

func (c *PathfinderSettingsClient) Create(ctx context.Context, obj *PathfinderSettings, opts resource.CreateOptions) (*PathfinderSettings, error) {
	// Make sure apiVersion and kind are set
	obj.APIVersion = GroupVersion.Identifier()
	obj.Kind = Kind().Kind()
	return c.client.Create(ctx, obj, opts)
}

func (c *PathfinderSettingsClient) Update(ctx context.Context, obj *PathfinderSettings, opts resource.UpdateOptions) (*PathfinderSettings, error) {
	return c.client.Update(ctx, obj, opts)
}

func (c *PathfinderSettingsClient) Patch(ctx context.Context, identifier resource.Identifier, req resource.PatchRequest, opts resource.PatchOptions) (*PathfinderSettings, error) {
	return c.client.Patch(ctx, identifier, req, opts)
}

func (c *PathfinderSettingsClient) UpdateStatus(ctx context.Context, identifier resource.Identifier, newStatus Status, opts resource.UpdateOptions) (*PathfinderSettings, error) {
	return c.client.Update(ctx, &PathfinderSettings{
		TypeMeta: metav1.TypeMeta{
			Kind:       Kind().Kind(),
			APIVersion: GroupVersion.Identifier(),
		},
		ObjectMeta: metav1.ObjectMeta{
			ResourceVersion: opts.ResourceVersion,
			Namespace:       identifier.Namespace,
			Name:            identifier.Name,
		},
		Status: newStatus,
	}, resource.UpdateOptions{
		Subresource:     "status",
		ResourceVersion: opts.ResourceVersion,
	})
}

func (c *PathfinderSettingsClient) Delete(ctx context.Context, identifier resource.Identifier, opts resource.DeleteOptions) error {
	return c.client.Delete(ctx, identifier, opts)
}
