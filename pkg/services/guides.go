package services

import (
	"context"
	"encoding/json"
	"strings"
	"unicode"
)

type GuidePage struct {
	Items    []json.RawMessage
	Continue string
}

type GuidePageReader func(context.Context, string, string) (GuidePage, error)

func ValidGuideName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\%") && strings.IndexFunc(name, unicode.IsControl) < 0
}

func ReadGuideResources(ctx context.Context, namespace string, maxBytes int64, maxItems int, read GuidePageReader, truncated func(int, int64)) ([]json.RawMessage, error) {
	items := make([]json.RawMessage, 0)
	totalBytes := int64(len(`{"items":[]}`))
	continueToken := ""
	for {
		page, err := read(ctx, namespace, continueToken)
		if err != nil {
			return nil, err
		}
		for _, item := range page.Items {
			itemBytes := int64(len(item))
			if len(items) > 0 {
				itemBytes++
			}
			if totalBytes+itemBytes > maxBytes || len(items) >= maxItems {
				truncated(len(items), totalBytes)
				return items, nil
			}
			items = append(items, item)
			totalBytes += itemBytes
		}
		continueToken = page.Continue
		if continueToken == "" {
			return items, nil
		}
	}
}
