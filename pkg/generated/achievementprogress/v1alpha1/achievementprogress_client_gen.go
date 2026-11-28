package v1alpha1

import (
	"context"

	"github.com/grafana/grafana-app-sdk/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type AchievementProgressClient struct {
	client *resource.TypedClient[*AchievementProgress, *AchievementProgressList]
}

func NewAchievementProgressClient(client resource.Client) *AchievementProgressClient {
	return &AchievementProgressClient{
		client: resource.NewTypedClient[*AchievementProgress, *AchievementProgressList](client, Kind()),
	}
}

func NewAchievementProgressClientFromGenerator(generator resource.ClientGenerator) (*AchievementProgressClient, error) {
	c, err := generator.ClientFor(Kind())
	if err != nil {
		return nil, err
	}
	return NewAchievementProgressClient(c), nil
}

func (c *AchievementProgressClient) Get(ctx context.Context, identifier resource.Identifier) (*AchievementProgress, error) {
	return c.client.Get(ctx, identifier)
}

func (c *AchievementProgressClient) List(ctx context.Context, namespace string, opts resource.ListOptions) (*AchievementProgressList, error) {
	return c.client.List(ctx, namespace, opts)
}

func (c *AchievementProgressClient) ListAll(ctx context.Context, namespace string, opts resource.ListOptions) (*AchievementProgressList, error) {
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

func (c *AchievementProgressClient) Create(ctx context.Context, obj *AchievementProgress, opts resource.CreateOptions) (*AchievementProgress, error) {
	// Make sure apiVersion and kind are set
	obj.APIVersion = GroupVersion.Identifier()
	obj.Kind = Kind().Kind()
	return c.client.Create(ctx, obj, opts)
}

func (c *AchievementProgressClient) Update(ctx context.Context, obj *AchievementProgress, opts resource.UpdateOptions) (*AchievementProgress, error) {
	return c.client.Update(ctx, obj, opts)
}

func (c *AchievementProgressClient) Patch(ctx context.Context, identifier resource.Identifier, req resource.PatchRequest, opts resource.PatchOptions) (*AchievementProgress, error) {
	return c.client.Patch(ctx, identifier, req, opts)
}

func (c *AchievementProgressClient) UpdateStatus(ctx context.Context, identifier resource.Identifier, newStatus Status, opts resource.UpdateOptions) (*AchievementProgress, error) {
	return c.client.Update(ctx, &AchievementProgress{
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

func (c *AchievementProgressClient) Delete(ctx context.Context, identifier resource.Identifier, opts resource.DeleteOptions) error {
	return c.client.Delete(ctx, identifier, opts)
}
