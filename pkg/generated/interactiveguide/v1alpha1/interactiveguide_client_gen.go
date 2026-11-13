package v1alpha1

import (
	"context"

	"github.com/grafana/grafana-app-sdk/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type InteractiveGuideClient struct {
	client *resource.TypedClient[*InteractiveGuide, *InteractiveGuideList]
}

func NewInteractiveGuideClient(client resource.Client) *InteractiveGuideClient {
	return &InteractiveGuideClient{
		client: resource.NewTypedClient[*InteractiveGuide, *InteractiveGuideList](client, Kind()),
	}
}

func NewInteractiveGuideClientFromGenerator(generator resource.ClientGenerator) (*InteractiveGuideClient, error) {
	c, err := generator.ClientFor(Kind())
	if err != nil {
		return nil, err
	}
	return NewInteractiveGuideClient(c), nil
}

func (c *InteractiveGuideClient) Get(ctx context.Context, identifier resource.Identifier) (*InteractiveGuide, error) {
	return c.client.Get(ctx, identifier)
}

func (c *InteractiveGuideClient) List(ctx context.Context, namespace string, opts resource.ListOptions) (*InteractiveGuideList, error) {
	return c.client.List(ctx, namespace, opts)
}

func (c *InteractiveGuideClient) ListAll(ctx context.Context, namespace string, opts resource.ListOptions) (*InteractiveGuideList, error) {
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

func (c *InteractiveGuideClient) Create(ctx context.Context, obj *InteractiveGuide, opts resource.CreateOptions) (*InteractiveGuide, error) {
	// Make sure apiVersion and kind are set
	obj.APIVersion = GroupVersion.Identifier()
	obj.Kind = Kind().Kind()
	return c.client.Create(ctx, obj, opts)
}

func (c *InteractiveGuideClient) Update(ctx context.Context, obj *InteractiveGuide, opts resource.UpdateOptions) (*InteractiveGuide, error) {
	return c.client.Update(ctx, obj, opts)
}

func (c *InteractiveGuideClient) Patch(ctx context.Context, identifier resource.Identifier, req resource.PatchRequest, opts resource.PatchOptions) (*InteractiveGuide, error) {
	return c.client.Patch(ctx, identifier, req, opts)
}

func (c *InteractiveGuideClient) UpdateStatus(ctx context.Context, identifier resource.Identifier, newStatus Status, opts resource.UpdateOptions) (*InteractiveGuide, error) {
	return c.client.Update(ctx, &InteractiveGuide{
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

func (c *InteractiveGuideClient) Delete(ctx context.Context, identifier resource.Identifier, opts resource.DeleteOptions) error {
	return c.client.Delete(ctx, identifier, opts)
}
