package services

import "context"

type CompletionRecordCreator interface {
	Create(context.Context, string, CompletionRecordObject) error
}

func CreateCompletion(ctx context.Context, creator CompletionRecordCreator, namespace string, spec CompletionRecordWriteSpec, idempotencyKey string, isConflict func(error) bool) (string, error) {
	name := CompletionRecordName(spec.UserID, idempotencyKey)
	object := CompletionRecordObject{APIVersion: "pathfinderbackend.ext.grafana.app/v1alpha1", Kind: "CompletionRecord", Metadata: CompletionRecordObjectMeta{Name: name, Namespace: namespace}, Spec: spec}
	if err := creator.Create(ctx, namespace, object); err != nil && !isConflict(err) {
		return "", err
	}
	return name, nil
}
