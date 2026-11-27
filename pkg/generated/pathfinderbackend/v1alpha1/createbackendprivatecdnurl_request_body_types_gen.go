// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

type CreateBackendPrivateCDNURLRequestBody struct {
	Guide string                                     `json:"guide"`
	Asset CreateBackendPrivateCDNURLRequestBodyAsset `json:"asset"`
}

// NewCreateBackendPrivateCDNURLRequestBody creates a new CreateBackendPrivateCDNURLRequestBody object.
func NewCreateBackendPrivateCDNURLRequestBody() *CreateBackendPrivateCDNURLRequestBody {
	return &CreateBackendPrivateCDNURLRequestBody{
		Guide: "builders-observability-foundations",
	}
}

// OpenAPIModelName returns the OpenAPI model name for CreateBackendPrivateCDNURLRequestBody.
func (CreateBackendPrivateCDNURLRequestBody) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.v1alpha1.CreateBackendPrivateCDNURLRequestBody"
}

type CreateBackendPrivateCDNURLRequestBodyAsset string

const (
	CreateBackendPrivateCDNURLRequestBodyAssetContentJson  CreateBackendPrivateCDNURLRequestBodyAsset = "content.json"
	CreateBackendPrivateCDNURLRequestBodyAssetManifestJson CreateBackendPrivateCDNURLRequestBodyAsset = "manifest.json"
)

// OpenAPIModelName returns the OpenAPI model name for CreateBackendPrivateCDNURLRequestBodyAsset.
func (CreateBackendPrivateCDNURLRequestBodyAsset) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.v1alpha1.CreateBackendPrivateCDNURLRequestBodyAsset"
}
