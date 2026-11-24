package services

import "context"

type CataloguePage[T any] struct {
	Entries  []T
	Continue string
}

func ReadCatalogue[T any](ctx context.Context, namespace string, maxEntries int, read func(context.Context, string, string) (CataloguePage[T], error), truncated func(int)) ([]T, int, error) {
	entries := []T{}
	token := ""
	pages := 0
	for {
		page, err := read(ctx, namespace, token)
		if err != nil {
			return nil, pages, err
		}
		pages++
		entries = append(entries, page.Entries...)
		if len(entries) >= maxEntries {
			dropped := len(entries) > maxEntries || page.Continue != ""
			if len(entries) > maxEntries {
				entries = entries[:maxEntries]
			}
			if dropped {
				truncated(pages)
			}
			break
		}
		if page.Continue == "" {
			break
		}
		token = page.Continue
	}
	return entries, pages, nil
}
