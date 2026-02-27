package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

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
// Returns both a refresh token (for storage) and an access token (for immediate use).
type RegisterResponse struct {
	RefreshToken          string `json:"refreshToken"`
	AccessToken           string `json:"accessToken"`
	AccessTokenExpiresIn  int    `json:"accessTokenExpiresIn"`
	JTI                   string `json:"jti"`
	Sub                   string `json:"sub"`
	Scope                 string `json:"scope"`
	InstanceName          string `json:"instanceName"`
}

// RefreshResponse represents the response from the token refresh endpoint.
type RefreshResponse struct {
	AccessToken string `json:"accessToken"`
	ExpiresIn   int    `json:"expiresIn"`
}

// CodaClient handles communication with the Coda VM provisioning backend.
type CodaClient struct {
	apiURL       string
	refreshToken string
	accessToken  string
	tokenExpiry  time.Time
	mutex        sync.RWMutex
	client       *http.Client
}

// NewCodaClient creates a new Coda API client.
func NewCodaClient(apiURL, refreshToken string) *CodaClient {
	return &CodaClient{
		apiURL:       apiURL,
		refreshToken: refreshToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// getAccessToken returns a valid access token, refreshing if necessary.
// Thread-safe with read-write mutex for concurrent access.
func (c *CodaClient) getAccessToken(ctx context.Context) (string, error) {
	// Fast path: check if we have a valid cached token
	c.mutex.RLock()
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry.Add(-1*time.Minute)) {
		token := c.accessToken
		c.mutex.RUnlock()
		return token, nil
	}
	c.mutex.RUnlock()

	// Slow path: need to refresh
	return c.refreshAccessToken(ctx)
}

func (c *CodaClient) refreshAccessToken(ctx context.Context) (string, error) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	if c.accessToken != "" && time.Now().Before(c.tokenExpiry.Add(-1*time.Minute)) {
		return c.accessToken, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL+"/api/v1/auth/refresh", nil)
	if err != nil {
		return "", fmt.Errorf("failed to create refresh request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.refreshToken)

	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send refresh request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusUnauthorized {
		return "", fmt.Errorf("refresh token invalid or revoked, please re-register")
	}

	if resp.StatusCode == http.StatusServiceUnavailable {
		return "", fmt.Errorf("service temporarily unavailable, please try again later")
	}

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("token refresh failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var refreshResp RefreshResponse
	if err := json.NewDecoder(resp.Body).Decode(&refreshResp); err != nil {
		return "", fmt.Errorf("failed to decode refresh response: %w", err)
	}

	// Update cached token
	c.accessToken = refreshResp.AccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(refreshResp.ExpiresIn) * time.Second)

	return c.accessToken, nil
}

// setAuthHeader sets the Authorization header with an access token.
// Gets a fresh access token if the current one is expired or about to expire.
func (c *CodaClient) setAuthHeader(ctx context.Context, req *http.Request) error {
	token, err := c.getAccessToken(ctx)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return nil
}

// GetAccessToken returns a valid access token for use with external services (like the relay).
// Thread-safe and handles automatic refresh.
func (c *CodaClient) GetAccessToken(ctx context.Context) (string, error) {
	return c.getAccessToken(ctx)
}

// Register registers this Grafana instance with the Coda API using an enrollment key.
func Register(ctx context.Context, apiURL, enrollmentKey, instanceID, instanceURL string) (*RegisterResponse, error) {
	payload := RegisterRequest{
		EnrollmentKey: enrollmentKey,
		InstanceID:    instanceID,
		InstanceURL:   instanceURL,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal registration request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL+"/api/v1/auth/register", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create registration request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send registration request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL+"/api/v1/vms", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if err := c.setAuthHeader(ctx, req); err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiURL+"/api/v1/vms/"+vmID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if err := c.setAuthHeader(ctx, req); err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.apiURL+"/api/v1/vms/"+vmID, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	if err := c.setAuthHeader(ctx, req); err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiURL+"/api/v1/vms", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if err := c.setAuthHeader(ctx, req); err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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
