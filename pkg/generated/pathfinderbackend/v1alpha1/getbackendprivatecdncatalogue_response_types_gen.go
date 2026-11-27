// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

// +k8s:openapi-gen=true
type GetBackendPrivateCDNCatalogueResponse struct {
	Entries []GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries `json:"entries"`
}

// NewGetBackendPrivateCDNCatalogueResponse creates a new GetBackendPrivateCDNCatalogueResponse object.
func NewGetBackendPrivateCDNCatalogueResponse() *GetBackendPrivateCDNCatalogueResponse {
	return &GetBackendPrivateCDNCatalogueResponse{
		Entries: []GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries{},
	}
}

// OpenAPIModelName returns the OpenAPI model name for GetBackendPrivateCDNCatalogueResponse.
func (GetBackendPrivateCDNCatalogueResponse) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.v1alpha1.GetBackendPrivateCDNCatalogueResponse"
}

// +k8s:openapi-gen=true
type GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries struct {
	Id     string `json:"id"`
	Title  string `json:"title"`
	Source string `json:"source"`
}

// NewGetBackendPrivateCDNCatalogueV1alpha1ResponseEntries creates a new GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries object.
func NewGetBackendPrivateCDNCatalogueV1alpha1ResponseEntries() *GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries {
	return &GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries{
		Source: "private-cdn",
	}
}

// OpenAPIModelName returns the OpenAPI model name for GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries.
func (GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.v1alpha1.GetBackendPrivateCDNCatalogueV1alpha1ResponseEntries"
}
