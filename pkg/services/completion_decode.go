package services

import "encoding/json"

func DecodeCompletionRecord(body json.RawMessage, annotations map[string]string) (CompletionRecord, error) {
	var record CompletionRecord
	if err := json.Unmarshal(body, &record); err != nil {
		return record, err
	}
	record.LastUpdatedAt = record.RecordedAt
	if updated := annotations["grafana.app/updatedTimestamp"]; updated != "" {
		if _, ok := ParseCompletionTime(updated); ok {
			record.LastUpdatedAt = updated
		}
	}
	record.AttemptStartedAt = annotations["pathfinder.grafana.com/attempt-started-at"]
	return record, nil
}
