// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

// +k8s:openapi-gen=true
type GetBackendGuidesResponse struct {
	Items []map[string]interface{} `json:"items"`
}

// NewGetBackendGuidesResponse creates a new GetBackendGuidesResponse object.
func NewGetBackendGuidesResponse() *GetBackendGuidesResponse {
	return &GetBackendGuidesResponse{
		Items: []map[string]interface{}{},
	}
}

// OpenAPIModelName returns the OpenAPI model name for GetBackendGuidesResponse.
func (GetBackendGuidesResponse) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.v1alpha1.GetBackendGuidesResponse"
}
