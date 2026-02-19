package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// CodaAPIURL is the hardcoded URL for the Coda backend API.
// This URL is constant and does not need to be configured.
const CodaAPIURL = "https://coda.lg.grafana-dev.com"

// VM represents a Coda VM instance.
type VM struct {
	ID           string       `json:"id"`
	Template     string       `json:"template"`
	State        string       `json:"state"`
	Credentials  *Credentials `json:"credentials,omitempty"`
	Owner        string       `json:"owner"`
	ErrorMessage *string      `json:"errorMessage,omitempty"`
	ExpiresAt    time.Time    `json:"expiresAt"`
	CreatedAt    time.Time    `json:"createdAt"`
}

// Credentials contains SSH connection information for a VM.
type Credentials struct {
	PublicIP      string `json:"publicIp"`
	SSHPort       int    `json:"sshPort"`
	SSHUser       string `json:"sshUser"`
	SSHPrivateKey string `json:"sshPrivateKey"`
	ExpiresAt     string `json:"expiresAt"`
}

// VMListResponse represents the response from listing VMs.
type VMListResponse struct {
	VMs []VM `json:"vms"`
}

// RegisterRequest represents the request body for registering with Coda.
type RegisterRequest struct {
	EnrollmentKey string `json:"enrollmentKey"`
	InstanceID    string `json:"instanceId"`
	InstanceURL   string `json:"instanceUrl,omitempty"`
}

// RegisterResponse represents the response from the registration endpoint.
type RegisterResponse struct {
	Token        string `json:"token"`
	JTI          string `json:"jti"`
	Sub          string `json:"sub"`
	Scope        string `json:"scope"`
	InstanceName string `json:"instanceName"`
	ExpiresAt    string `json:"expiresAt"`
}

// CodaClient handles communication with the Coda VM provisioning backend.
type CodaClient struct {
	jwtToken string
	client   *http.Client
}

// NewCodaClient creates a new Coda API client with JWT authentication.
func NewCodaClient(jwtToken string) *CodaClient {
	return &CodaClient{
		jwtToken: jwtToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// setAuthHeader sets the Authorization header with the JWT Bearer token.
func (c *CodaClient) setAuthHeader(req *http.Request) {
	if c.jwtToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.jwtToken)
	}
}

// Register registers this Grafana instance with the Coda API using an enrollment key.
// Returns a JWT token that should be stored in secureJsonData for future API calls.
func Register(ctx context.Context, enrollmentKey, instanceID, instanceURL string) (*RegisterResponse, error) {
	payload := RegisterRequest{
		EnrollmentKey: enrollmentKey,
		InstanceID:    instanceID,
		InstanceURL:   instanceURL,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal registration request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, CodaAPIURL+"/api/v1/auth/register", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create registration request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send registration request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("invalid enrollment key")
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("too many registration attempts, please try again later")
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("registration failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var registerResp RegisterResponse
	if err := json.NewDecoder(resp.Body).Decode(&registerResp); err != nil {
		return nil, fmt.Errorf("failed to decode registration response: %w", err)
	}

	return &registerResp, nil
}

// CreateVMRequest represents the request body for creating a VM.
type CreateVMRequest struct {
	Template string                 `json:"template"`
	Owner    string                 `json:"owner"`
	Config   map[string]interface{} `json:"config,omitempty"`
}

// CreateVM requests a new VM from Coda.
func (c *CodaClient) CreateVM(ctx context.Context, template, owner string) (*VM, error) {
	payload := CreateVMRequest{
		Template: template,
		Owner:    owner,
		Config:   map[string]interface{}{},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, CodaAPIURL+"/api/v1/vms", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setAuthHeader(req)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("authentication failed: token may be invalid or expired, please re-register")
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status code %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var vm VM
	if err := json.NewDecoder(resp.Body).Decode(&vm); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &vm, nil
}

// GetVM fetches the status and credentials of a VM.
func (c *CodaClient) GetVM(ctx context.Context, vmID string) (*VM, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, CodaAPIURL+"/api/v1/vms/"+vmID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("authentication failed: token may be invalid or expired, please re-register")
	}

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("VM not found: %s", vmID)
	}

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status code %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var vm VM
	if err := json.NewDecoder(resp.Body).Decode(&vm); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &vm, nil
}

// DeleteVM initiates the destruction of a VM.
func (c *CodaClient) DeleteVM(ctx context.Context, vmID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, CodaAPIURL+"/api/v1/vms/"+vmID, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("authentication failed: token may be invalid or expired, please re-register")
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status code %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}

// ListVMs returns all VMs.
func (c *CodaClient) ListVMs(ctx context.Context) ([]VM, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, CodaAPIURL+"/api/v1/vms", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("authentication failed: token may be invalid or expired, please re-register")
	}

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status code %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var listResp VMListResponse
	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return listResp.VMs, nil
}

// WaitForVM polls the VM status until it becomes active or errors.
func (c *CodaClient) WaitForVM(ctx context.Context, vmID string, timeout time.Duration) (*VM, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timeout waiting for VM to become active")
		case <-ticker.C:
			vm, err := c.GetVM(ctx, vmID)
			if err != nil {
				return nil, err
			}

			switch vm.State {
			case "active":
				return vm, nil
			case "error":
				errMsg := "unknown error"
				if vm.ErrorMessage != nil {
					errMsg = *vm.ErrorMessage
				}
				return nil, fmt.Errorf("VM provisioning failed: %s", errMsg)
			case "destroying":
				return nil, fmt.Errorf("VM is being destroyed")
			case "destroyed":
				return nil, fmt.Errorf("VM was destroyed")
			}
			// Continue polling for "pending" and "provisioning" states
		}
	}
}
