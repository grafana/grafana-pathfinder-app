package resourceaccess

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"io"
	"k8s.io/client-go/rest"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
	awards "github.com/grafana/grafana-pathfinder-app/pkg/generated/achievementaward/v1alpha1"
	progress "github.com/grafana/grafana-pathfinder-app/pkg/generated/achievementprogress/v1alpha1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type AchievementClients struct{ progress, awards resource.Client }

func NewAchievementClients(g resource.ClientGenerator) (*AchievementClients, error) {
	p, err := g.ClientFor(progress.Kind())
	if err != nil {
		return nil, err
	}
	a, err := g.ClientFor(awards.Kind())
	if err != nil {
		return nil, err
	}
	return &AchievementClients{progress: p, awards: a}, nil
}
func (c *AchievementClients) client(kind string) (resource.Client, error) {
	switch kind {
	case "achievementprogresses":
		return c.progress, nil
	case "achievementawards":
		return c.awards, nil
	default:
		return nil, errors.New("unknown achievement kind")
	}
}

// Preserve a successful save even when its response body cannot be decoded.
type achievementResponse struct {
	resource.UntypedObject
	body []byte
}

func (r *achievementResponse) UnmarshalJSON(body []byte) error {
	r.body = append(r.body[:0], body...)
	return nil
}
func (c *AchievementClients) Get(ctx context.Context, _, ns, kind, name string, _ int64) ([]byte, error) {
	client, err := c.client(kind)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	into := &achievementResponse{}
	err = client.GetInto(ctx, resource.Identifier{Namespace: ns, Name: name}, into)
	return into.body, err
}
func (c *AchievementClients) Create(ctx context.Context, _, ns, kind string, body []byte, _ int64) ([]byte, error) {
	return c.write(ctx, ns, kind, body, true)
}
func (c *AchievementClients) Replace(ctx context.Context, _, ns, kind, _ string, body []byte, _ int64) ([]byte, error) {
	return c.write(ctx, ns, kind, body, false)
}
func (c *AchievementClients) write(ctx context.Context, ns, kind string, body []byte, create bool) ([]byte, error) {
	client, err := c.client(kind)
	if err != nil {
		return nil, err
	}
	obj := &rawWritableResource{}
	if err = obj.UnmarshalJSON(body); err != nil {
		return nil, err
	}
	if obj.Namespace != ns || obj.Name == "" {
		return nil, errors.New("achievement identity mismatch")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	into := &achievementResponse{}
	id := resource.Identifier{Namespace: ns, Name: obj.Name}
	if create {
		err = client.CreateInto(ctx, id, obj, resource.CreateOptions{}, into)
	} else {
		err = client.UpdateInto(ctx, id, obj, resource.UpdateOptions{ResourceVersion: obj.ResourceVersion}, into)
	}
	return into.body, err
}
func (c *AchievementClients) IsConflict(err error) bool {
	var status apierrors.APIStatus
	return errors.As(err, &status) && status.Status().Code == http.StatusConflict
}
func (c *AchievementClients) IsAbsent(err error, kind string) bool {
	var api apierrors.APIStatus
	if !errors.As(err, &api) {
		return false
	}
	s := api.Status()
	return s.Code == 404 && s.Reason == "NotFound" && s.Details != nil && s.Details.Group == "pathfinderbackend.ext.grafana.app" && s.Details.Kind == kind && s.Details.Name != ""
}

type AchievementReader struct {
	Clients   *AchievementClients
	Namespace string
}

func (r AchievementReader) ListMine(ctx context.Context, person achievements.Person) (achievements.Rows, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result := achievements.Rows{AsOf: time.Now()}
	count := 0
	for _, kind := range []string{"achievementawards", "achievementprogresses"} {
		token := ""
		seen := map[string]bool{}
		for {
			var list resource.ListObject
			if kind == "achievementawards" {
				list = &awards.AchievementAwardList{}
			} else {
				list = &progress.AchievementProgressList{}
			}
			client, err := r.Clients.client(kind)
			if err != nil {
				return achievements.Rows{}, err
			}
			pageCtx, stop := context.WithTimeout(ctx, 15*time.Second)
			err = client.ListInto(pageCtx, r.Namespace, resource.ListOptions{Limit: 100, Continue: token}, list)
			stop()
			if err != nil {
				return achievements.Rows{}, err
			}
			for _, item := range list.GetItems() {
				count++
				if count > 50000 {
					result.Truncated = true
					return result, nil
				}
				switch row := item.(type) {
				case *awards.AchievementAward:
					if row.Spec.UserId != person.ID {
						continue
					}
					result.Awards = append(result.Awards, achievements.Award{AchievementID: row.Spec.AchievementId, TierID: row.Spec.TierId, Entity: row.Spec.Entity, EarnedAt: row.Spec.EarnedAt})
				case *progress.AchievementProgress:
					if row.Spec.UserId != person.ID {
						continue
					}
					units := slices.Clone(row.Spec.Units)
					slices.Sort(units)
					result.Progress = append(result.Progress, achievements.Progress{AchievementID: row.Spec.AchievementId, TierIDs: row.Spec.TierIds, Units: slices.Compact(units), SchemaVersion: int(row.Spec.SchemaVersion), Version: row.ResourceVersion})
				default:
					return achievements.Rows{}, errors.New("unexpected achievement resource")
				}
			}
			token = list.GetContinue()
			if token == "" {
				break
			}
			if seen[token] {
				return achievements.Rows{}, errors.New("repeated achievement continuation token")
			}
			seen[token] = true
		}
	}
	return result, nil
}

func AchievementConfig(config rest.Config) rest.Config {
	config = BoundedConfig(config, services.AchievementStoreMaxBytes)
	config.Wrap(func(next http.RoundTripper) http.RoundTripper {
		return achievementAckTransport{next: settingsErrorTransport{next: next}}
	})
	return config
}

type achievementAckTransport struct{ next http.RoundTripper }

func (t achievementAckTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	response, err := t.next.RoundTrip(req)
	optionalAck := req.Method == http.MethodPut || (req.Method == http.MethodPost && strings.HasSuffix(req.URL.Path, "/achievementawards"))
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 || !optionalAck {
		return response, err
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil {
		return nil, err
	}
	// These writes are durable on 2xx even when their acknowledgement is unreadable.
	if !json.Valid(body) {
		body = []byte(`{}`)
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	response.Header.Del("Content-Length")
	return response, nil
}
