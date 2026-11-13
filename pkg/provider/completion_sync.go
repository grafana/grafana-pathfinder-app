package provider

import (
	"context"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"time"
)

func completionAssignmentSync(assignments *resourceaccess.AssignmentStore, completions *resourceaccess.CompletionStore, evaluator func(context.Context, string) *services.ObligationEvaluator) func(context.Context, string, services.CompletionRecord) {
	return func(ctx context.Context, namespace string, just services.CompletionRecord) {
		go func() {
			logger := log.DefaultLogger
			defer func() {
				if value := recover(); value != nil {
					logger.Error("assignment status write panicked", "panic", value)
				}
			}()
			readCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
			records, err := services.ReadAssignments(readCtx, namespace, just.UserID, assignments)
			cancel()
			if err != nil {
				logger.Info("assignment status write skipped", "error", err)
				return
			}
			services.SyncSatisfiedAssignments(records, just, evaluator(ctx, namespace), func() ([]services.CompletionRecord, error) {
				readCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
				defer cancel()
				return completions.ReadCaller(readCtx, namespace, just.UserID)
			}, func(record services.Assignment) {
				if err := assignments.MarkSatisfied(ctx, namespace, record); err != nil {
					logger.Info("assignment status write failed", "name", record.Name, "error", err)
				}
			}, logger)
		}()
	}
}
