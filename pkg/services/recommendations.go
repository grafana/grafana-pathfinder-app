package services

import (
	"context"
	"encoding/json"
)

type RecommendationsReader func(context.Context) (body json.RawMessage, available bool, err error)
