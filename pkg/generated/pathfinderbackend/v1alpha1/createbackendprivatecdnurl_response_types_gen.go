// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

// +k8s:openapi-gen=true
type CreateBackendPrivateCDNURLResponse struct {
	Url       string `json:"url"`
	ExpiresAt int64  `json:"expiresAt"`
	Source    string `json:"source"`
}

// NewCreateBackendPrivateCDNURLResponse creates a new CreateBackendPrivateCDNURLResponse object.
func NewCreateBackendPrivateCDNURLResponse() *CreateBackendPrivateCDNURLResponse {
	return &CreateBackendPrivateCDNURLResponse{
		Source: "private-cdn",
	}
}

// OpenAPIModelName returns the OpenAPI model name for CreateBackendPrivateCDNURLResponse.
func (CreateBackendPrivateCDNURLResponse) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.v1alpha1.CreateBackendPrivateCDNURLResponse"
}
