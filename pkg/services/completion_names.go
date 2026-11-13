package services

import (
	"crypto/sha256"
	"encoding/hex"
)

func CompletionRecordName(userID, idempotencyKey string) string {
	h := sha256.New()
	h.Write([]byte(userID))
	h.Write([]byte{0})
	h.Write([]byte(idempotencyKey))
	sum := h.Sum(nil)
	return "completion-" + hex.EncodeToString(sum[:16])
}

func CompletionAttemptRecordName(userID, attemptID string) string {
	h := sha256.New()
	h.Write([]byte(userID))
	h.Write([]byte{0})
	h.Write([]byte("attempt"))
	h.Write([]byte{0})
	h.Write([]byte(attemptID))
	sum := h.Sum(nil)
	return "completion-" + hex.EncodeToString(sum[:16])
}

func AttemptWriteSpec(spec CompletionRecordWriteSpec) CompletionRecordWriteSpec {
	if spec.CompletionPercent < 100 {
		spec.CompletedAt = ""
		spec.Source = "objectives"
		spec.DurationSeconds = 0
	}
	return spec
}
