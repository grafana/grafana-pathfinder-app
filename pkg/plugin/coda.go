package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
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

// ListVMsOptions controls server-side filtering for ListVMs.
type ListVMsOptions struct {
	Owner string
	State string
	Limit int
}

// isUsableState returns true for VM states that can still serve a connection.
func isUsableState(state string) bool {
	return state == "active" || state == "pending" || state == "provisioning"
}

// isVMNotFoundError returns true when the error indicates the VM no longer exists (HTTP 404).
func isVMNotFoundError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "VM not found")
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

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("VM quota exceeded: you have reached the maximum number of VMs, please wait for existing VMs to expire")
	}

	if resp.StatusCode == http.StatusConflict {
		return nil, fmt.Errorf("VM conflict: a VM may already exist for this user")
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

// DeleteVM initiates the destruction of a VM. When force is true the
// server-side ?force=true flag is set, useful for cleaning up stuck VMs.
func (c *CodaClient) DeleteVM(ctx context.Context, vmID string, force bool) error {
	endpoint := c.apiURL + "/api/v1/vms/" + vmID
	if force {
		endpoint += "?force=true"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
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

// ListVMs returns VMs, optionally filtered server-side by owner/state/limit.
// Pass nil to list all VMs without filtering.
func (c *CodaClient) ListVMs(ctx context.Context, opts *ListVMsOptions) ([]VM, error) {
	endpoint := c.apiURL + "/api/v1/vms"
	if opts != nil {
		q := url.Values{}
		if opts.Owner != "" {
			q.Set("owner", opts.Owner)
		}
		if opts.State != "" {
			q.Set("state", opts.State)
		}
		if opts.Limit > 0 {
			q.Set("limit", strconv.Itoa(opts.Limit))
		}
		if encoded := q.Encode(); encoded != "" {
			endpoint += "?" + encoded
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
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

// FindActiveVMForUser queries the API for VMs owned by the given user and
// returns the most recently created VM in a usable state (active/pending/provisioning).
// If multiple usable VMs exist, the surplus ones are returned in the second
// slice so the caller can clean them up (users should only have one active VM).
// Returns (nil, nil, nil) when no usable VM exists.
func (c *CodaClient) FindActiveVMForUser(ctx context.Context, owner string) (*VM, []VM, error) {
	vms, err := c.ListVMs(ctx, &ListVMsOptions{Owner: owner})
	if err != nil {
		return nil, nil, err
	}

	var usable []VM
	for i := range vms {
		if isUsableState(vms[i].State) {
			usable = append(usable, vms[i])
		}
	}
	if len(usable) == 0 {
		return nil, nil, nil
	}

	// Pick the most recently created VM as the primary
	best := 0
	for i := 1; i < len(usable); i++ {
		if usable[i].CreatedAt.After(usable[best].CreatedAt) {
			best = i
		}
	}

	primary := usable[best]
	var surplus []VM
	for i := range usable {
		if i != best {
			surplus = append(surplus, usable[i])
		}
	}

	return &primary, surplus, nil
}

// CountVMsForUser returns the number of non-terminal VMs owned by the given user.
func (c *CodaClient) CountVMsForUser(ctx context.Context, owner string) (int, error) {
	vms, err := c.ListVMs(ctx, &ListVMsOptions{Owner: owner})
	if err != nil {
		return 0, err
	}
	count := 0
	for i := range vms {
		if isUsableState(vms[i].State) {
			count++
		}
	}
	return count, nil
}

