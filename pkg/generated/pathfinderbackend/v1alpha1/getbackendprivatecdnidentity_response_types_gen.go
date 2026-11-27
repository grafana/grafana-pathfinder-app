// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

// +k8s:openapi-gen=true
type GetBackendPrivateCDNIdentityResponse struct {
	Subject   string `json:"subject"`
	Namespace string `json:"namespace"`
}

// NewGetBackendPrivateCDNIdentityResponse creates a new GetBackendPrivateCDNIdentityResponse object.
func NewGetBackendPrivateCDNIdentityResponse() *GetBackendPrivateCDNIdentityResponse {
	return &GetBackendPrivateCDNIdentityResponse{}
}

// OpenAPIModelName returns the OpenAPI model name for GetBackendPrivateCDNIdentityResponse.
func (GetBackendPrivateCDNIdentityResponse) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.v1alpha1.GetBackendPrivateCDNIdentityResponse"
}
