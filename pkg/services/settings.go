package services

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

func IsSettingsNotConfigured(statusCode int, body []byte) bool {
	if statusCode != http.StatusNotFound || len(body) > 2048 {
		return false
	}
	var status struct {
		Kind       string `json:"kind"`
		APIVersion string `json:"apiVersion"`
		Status     string `json:"status"`
		Reason     string `json:"reason"`
		Code       int    `json:"code"`
		Details    struct {
			Group  string            `json:"group"`
			Kind   string            `json:"kind"`
			Name   string            `json:"name"`
			Causes []json.RawMessage `json:"causes"`
		} `json:"details"`
	}
	return json.Unmarshal(body, &status) == nil &&
		status.Kind == "Status" && status.APIVersion == "v1" && status.Status == "Failure" &&
		status.Reason == "NotFound" && status.Code == http.StatusNotFound &&
		status.Details.Group == "pathfinderbackend.ext.grafana.app" && status.Details.Kind == "pathfindersettings" &&
		status.Details.Name == "default" && len(status.Details.Causes) == 0
}

const SettingsMaxBytes = 1024 * 1024
const SettingsReadTimeout = 15 * time.Second

type SettingsReader func(context.Context, string) (json.RawMessage, error)

func ReadSettings(ctx context.Context, namespace string, read SettingsReader) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, SettingsReadTimeout)
	defer cancel()
	return read(ctx, namespace)
}
