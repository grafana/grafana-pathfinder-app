package storetest

import (
	"testing"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

func TestMemoryMeetsContract(t *testing.T) {
	Run(t, func(*testing.T) achievements.Store { return NewMemory() })
}
