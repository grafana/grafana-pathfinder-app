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

// VM represents a Brokkr VM instance.
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

// BrokkrClient handles communication with the Brokkr VM provisioning backend.
type BrokkrClient struct {
	baseURL  string
	username string
	password string
	client   *http.Client
}

// NewBrokkrClient creates a new Brokkr API client.
func NewBrokkrClient(baseURL, username, password string) *BrokkrClient {
	return &BrokkrClient{
		baseURL:  baseURL,
		username: username,
		password: password,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CreateVMRequest represents the request body for creating a VM.
type CreateVMRequest struct {
	Template string                 `json:"template"`
	Owner    string                 `json:"owner"`
	Config   map[string]interface{} `json:"config,omitempty"`
}

// CreateVM requests a new VM from Brokkr.
func (c *BrokkrClient) CreateVM(ctx context.Context, template, owner string) (*VM, error) {
	payload := CreateVMRequest{
		Template: template,
		Owner:    owner,
		Config:   map[string]interface{}{},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/vms", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

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
func (c *BrokkrClient) GetVM(ctx context.Context, vmID string) (*VM, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/vms/"+vmID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

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
func (c *BrokkrClient) DeleteVM(ctx context.Context, vmID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/api/v1/vms/"+vmID, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status code %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}

// ListVMs returns all VMs.
func (c *BrokkrClient) ListVMs(ctx context.Context) ([]VM, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/vms", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

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
func (c *BrokkrClient) WaitForVM(ctx context.Context, vmID string, timeout time.Duration) (*VM, error) {
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
			case "destroyed":
				return nil, fmt.Errorf("VM was destroyed")
			}
			// Continue polling for "pending" and "provisioning" states
		}
	}
}
