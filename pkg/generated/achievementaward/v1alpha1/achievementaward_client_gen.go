package v1alpha1

import (
	"context"

	"github.com/grafana/grafana-app-sdk/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type AchievementAwardClient struct {
	client *resource.TypedClient[*AchievementAward, *AchievementAwardList]
}

func NewAchievementAwardClient(client resource.Client) *AchievementAwardClient {
	return &AchievementAwardClient{
		client: resource.NewTypedClient[*AchievementAward, *AchievementAwardList](client, Kind()),
	}
}

func NewAchievementAwardClientFromGenerator(generator resource.ClientGenerator) (*AchievementAwardClient, error) {
	c, err := generator.ClientFor(Kind())
	if err != nil {
		return nil, err
	}
	return NewAchievementAwardClient(c), nil
}

func (c *AchievementAwardClient) Get(ctx context.Context, identifier resource.Identifier) (*AchievementAward, error) {
	return c.client.Get(ctx, identifier)
}

func (c *AchievementAwardClient) List(ctx context.Context, namespace string, opts resource.ListOptions) (*AchievementAwardList, error) {
	return c.client.List(ctx, namespace, opts)
}

func (c *AchievementAwardClient) ListAll(ctx context.Context, namespace string, opts resource.ListOptions) (*AchievementAwardList, error) {
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

func (c *AchievementAwardClient) Create(ctx context.Context, obj *AchievementAward, opts resource.CreateOptions) (*AchievementAward, error) {
	// Make sure apiVersion and kind are set
	obj.APIVersion = GroupVersion.Identifier()
	obj.Kind = Kind().Kind()
	return c.client.Create(ctx, obj, opts)
}

func (c *AchievementAwardClient) Update(ctx context.Context, obj *AchievementAward, opts resource.UpdateOptions) (*AchievementAward, error) {
	return c.client.Update(ctx, obj, opts)
}

func (c *AchievementAwardClient) Patch(ctx context.Context, identifier resource.Identifier, req resource.PatchRequest, opts resource.PatchOptions) (*AchievementAward, error) {
	return c.client.Patch(ctx, identifier, req, opts)
}

func (c *AchievementAwardClient) UpdateStatus(ctx context.Context, identifier resource.Identifier, newStatus Status, opts resource.UpdateOptions) (*AchievementAward, error) {
	return c.client.Update(ctx, &AchievementAward{
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

func (c *AchievementAwardClient) Delete(ctx context.Context, identifier resource.Identifier, opts resource.DeleteOptions) error {
	return c.client.Delete(ctx, identifier, opts)
}
