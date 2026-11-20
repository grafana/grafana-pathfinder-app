package services

import "context"

type CompletionRecordCreator interface {
	Create(context.Context, string, CompletionRecordObject) error
}

func CreateCompletion(ctx context.Context, creator CompletionRecordCreator, namespace string, spec CompletionRecordWriteSpec, idempotencyKey string) (string, error) {
	name := CompletionRecordName(spec.UserID, idempotencyKey)
	object := CompletionRecordObject{APIVersion: "pathfinderbackend.ext.grafana.app/v1alpha1", Kind: "CompletionRecord", Metadata: CompletionRecordObjectMeta{Name: name, Namespace: namespace}, Spec: spec}
	return name, creator.Create(ctx, namespace, object)
}

func CreateOrConfirmCompletion(ctx context.Context, store CompletionRecordUpdater, namespace string, spec CompletionRecordWriteSpec, key string, isConflict func(error) bool) (string, CompletionRecordWriteSpec, error) {
	for range 3 {
		name, err := CreateCompletion(ctx, store, namespace, spec, key)
		if err == nil || !isConflict(err) {
			return name, spec, err
		}
		stored, err := store.Get(ctx, namespace, name)
		if err != nil {
			return "", spec, err
		}
		if stored != nil {
			if stored.Spec.UserID != spec.UserID || stored.Spec.GuideID != spec.GuideID || stored.Spec.GuideSource != spec.GuideSource {
				return "", spec, ErrAttemptIdentityMismatch
			}
			return name, stored.Spec, nil
		}
	}
	return "", spec, ErrAttemptContended
}
