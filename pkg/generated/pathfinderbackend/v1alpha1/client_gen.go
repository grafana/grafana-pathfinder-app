package v1alpha1

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/grafana/grafana-app-sdk/resource"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type CustomRouteClient struct {
	resource.CustomRouteClient
}

func NewCustomRouteClient(client resource.CustomRouteClient) *CustomRouteClient {
	return &CustomRouteClient{client}
}

func NewCustomRouteClientFromGenerator(generator resource.ClientGenerator, defaultNamespace string) (*CustomRouteClient, error) {
	client, err := generator.GetCustomRouteClient(schema.GroupVersion{
		Group:   "pathfinderbackend.ext.grafana.app",
		Version: "v1alpha1",
	}, defaultNamespace)
	if err != nil {
		return nil, err
	}
	return NewCustomRouteClient(client), nil
}

type GetBackendAssignmentsRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendAssignments(ctx context.Context, namespace string, request GetBackendAssignmentsRequest) (*GetBackendAssignmentsResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/assignments/my",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendAssignmentsResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendAssignmentsResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendCompletionCapabilityRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendCompletionCapability(ctx context.Context, namespace string, request GetBackendCompletionCapabilityRequest) (*GetBackendCompletionCapabilityResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/completion-records/capability",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendCompletionCapabilityResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendCompletionCapabilityResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendCompletionsRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendCompletions(ctx context.Context, namespace string, request GetBackendCompletionsRequest) (*GetBackendCompletionsResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/completion-records/my",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendCompletionsResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendCompletionsResponse: %w", err)
	}
	return &cast, nil
}

type CreateBackendCompletionRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) CreateBackendCompletion(ctx context.Context, namespace string, request CreateBackendCompletionRequest) (*CreateBackendCompletionResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/completion-records",
		Verb:    "POST",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := CreateBackendCompletionResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into CreateBackendCompletionResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendCatalogueRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendCatalogue(ctx context.Context, namespace string, request GetBackendCatalogueRequest) (*GetBackendCatalogueResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/custom-guide-repository",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendCatalogueResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendCatalogueResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendGuidesRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendGuides(ctx context.Context, namespace string, request GetBackendGuidesRequest) (*GetBackendGuidesResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/custom-guides",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendGuidesResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendGuidesResponse: %w", err)
	}
	return &cast, nil
}

type DeleteBackendGuideRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) DeleteBackendGuide(ctx context.Context, namespace string, request DeleteBackendGuideRequest) (*DeleteBackendGuideResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/custom-guide",
		Verb:    "DELETE",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := DeleteBackendGuideResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into DeleteBackendGuideResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendGuideRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendGuide(ctx context.Context, namespace string, request GetBackendGuideRequest) (*GetBackendGuideResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/custom-guide",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendGuideResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendGuideResponse: %w", err)
	}
	return &cast, nil
}

type CreateBackendGuideRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) CreateBackendGuide(ctx context.Context, namespace string, request CreateBackendGuideRequest) (*CreateBackendGuideResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/custom-guide",
		Verb:    "POST",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := CreateBackendGuideResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into CreateBackendGuideResponse: %w", err)
	}
	return &cast, nil
}

type ReplaceBackendGuideRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) ReplaceBackendGuide(ctx context.Context, namespace string, request ReplaceBackendGuideRequest) (*ReplaceBackendGuideResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/custom-guide",
		Verb:    "PUT",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := ReplaceBackendGuideResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into ReplaceBackendGuideResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendHealthRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendHealth(ctx context.Context, namespace string, request GetBackendHealthRequest) (*GetBackendHealthResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/health",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendHealthResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendHealthResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendLearningInsightsRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendLearningInsights(ctx context.Context, namespace string, request GetBackendLearningInsightsRequest) (*GetBackendLearningInsightsResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/learning-insights",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendLearningInsightsResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendLearningInsightsResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendRecommendationsRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendRecommendations(ctx context.Context, namespace string, request GetBackendRecommendationsRequest) (*GetBackendRecommendationsResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/package-recommendations",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendRecommendationsResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendRecommendationsResponse: %w", err)
	}
	return &cast, nil
}

type GetBackendSettingsRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) GetBackendSettings(ctx context.Context, namespace string, request GetBackendSettingsRequest) (*GetBackendSettingsResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/pathfinder-settings",
		Verb:    "GET",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := GetBackendSettingsResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into GetBackendSettingsResponse: %w", err)
	}
	return &cast, nil
}

type CreateBackendSettingsRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) CreateBackendSettings(ctx context.Context, namespace string, request CreateBackendSettingsRequest) (*CreateBackendSettingsResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/pathfinder-settings",
		Verb:    "POST",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := CreateBackendSettingsResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into CreateBackendSettingsResponse: %w", err)
	}
	return &cast, nil
}

type ReplaceBackendSettingsRequest struct {
	Headers http.Header
}

func (c *CustomRouteClient) ReplaceBackendSettings(ctx context.Context, namespace string, request ReplaceBackendSettingsRequest) (*ReplaceBackendSettingsResponse, error) {
	resp, err := c.NamespacedRequest(ctx, namespace, resource.CustomRouteRequestOptions{
		Path:    "/backend/pathfinder-settings",
		Verb:    "PUT",
		Headers: request.Headers,
	})
	if err != nil {
		return nil, err
	}
	cast := ReplaceBackendSettingsResponse{}
	err = json.Unmarshal(resp, &cast)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal response bytes into ReplaceBackendSettingsResponse: %w", err)
	}
	return &cast, nil
}
