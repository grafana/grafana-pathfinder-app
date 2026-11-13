package v1alpha1

import (
	"context"

	"github.com/grafana/grafana-app-sdk/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type AssignmentClient struct {
	client *resource.TypedClient[*Assignment, *AssignmentList]
}

func NewAssignmentClient(client resource.Client) *AssignmentClient {
	return &AssignmentClient{
		client: resource.NewTypedClient[*Assignment, *AssignmentList](client, Kind()),
	}
}

func NewAssignmentClientFromGenerator(generator resource.ClientGenerator) (*AssignmentClient, error) {
	c, err := generator.ClientFor(Kind())
	if err != nil {
		return nil, err
	}
	return NewAssignmentClient(c), nil
}

func (c *AssignmentClient) Get(ctx context.Context, identifier resource.Identifier) (*Assignment, error) {
	return c.client.Get(ctx, identifier)
}

func (c *AssignmentClient) List(ctx context.Context, namespace string, opts resource.ListOptions) (*AssignmentList, error) {
	return c.client.List(ctx, namespace, opts)
}

func (c *AssignmentClient) ListAll(ctx context.Context, namespace string, opts resource.ListOptions) (*AssignmentList, error) {
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

func (c *AssignmentClient) Create(ctx context.Context, obj *Assignment, opts resource.CreateOptions) (*Assignment, error) {
	// Make sure apiVersion and kind are set
	obj.APIVersion = GroupVersion.Identifier()
	obj.Kind = Kind().Kind()
	return c.client.Create(ctx, obj, opts)
}

func (c *AssignmentClient) Update(ctx context.Context, obj *Assignment, opts resource.UpdateOptions) (*Assignment, error) {
	return c.client.Update(ctx, obj, opts)
}

func (c *AssignmentClient) Patch(ctx context.Context, identifier resource.Identifier, req resource.PatchRequest, opts resource.PatchOptions) (*Assignment, error) {
	return c.client.Patch(ctx, identifier, req, opts)
}

func (c *AssignmentClient) UpdateStatus(ctx context.Context, identifier resource.Identifier, newStatus Status, opts resource.UpdateOptions) (*Assignment, error) {
	return c.client.Update(ctx, &Assignment{
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

func (c *AssignmentClient) Delete(ctx context.Context, identifier resource.Identifier, opts resource.DeleteOptions) error {
	return c.client.Delete(ctx, identifier, opts)
}
