// DO NOT MERGE — incremental-progress feasibility spike. See SPIKE.md.

package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// Report types, redaction/minimisation, Status/meta parsing and the verdict /
// decision logic for the incremental-progress spike (spike_progress_DO_NOT_MERGE.go).
// Nothing here is called from a production path.

const (
	spikeBanner   = "DO NOT MERGE — incremental-progress feasibility spike. See SPIKE.md."
	spikeQuestion = "Can an existing CompletionRecord be updated in place (GET→PUT with resourceVersion, or JSON merge-patch) by a Viewer through the plugin's OBO path?"

	spikeAnnoUpdatedTimestampApp = "grafana.app/updatedTimestamp"
	spikeAnnoUpdateTimestampCom  = "grafana.com/updateTimestamp"

	spikeExcerptMaxBytes    = 2048
	spikeAnnotationMaxBytes = 512
	spikeRedacted           = "[redacted]"
	spikeUpstream           = "[upstream]"

	spikeStorageConclusion = "unconfirmed — ask App Platform team; give them group/version/resource and these signals"

	spikePass    = "pass"
	spikeFail    = "fail"
	spikeObserve = "observe"
	spikeError   = "error"
	spikeSkipped = "skipped"

	spikeSnapAfterCreate = "afterCreate"
	spikeSnapAfterGet    = "afterGet"
	spikeSnapAfterPut    = "afterPut"
	spikeSnapAfterPatch  = "afterPatch"
	spikeSnapOnList      = "onList"
)

var (
	spikeJWTPattern          = regexp.MustCompile(`eyJ[\w-]+\.[\w-]+\.[\w-]*`)
	spikeBearerPattern       = regexp.MustCompile(`(?i)bearer\s+\S+`)
	spikeGrafanaTokenPattern = regexp.MustCompile(`gl(sa|c|pat)_[A-Za-z0-9+/=_-]+`)
	spikeSensitiveKeyPattern = regexp.MustCompile(`(?i)token|secret|password|authorization|cookie`)
	spikeTimestampKeyPattern = regexp.MustCompile(`(?i)updat|modif|timestamp`)

	spikeAllowedHeaders = []string{
		"Content-Type", "Audit-Id", "X-Kubernetes-Pf-Flowschema-Uid",
		"X-Kubernetes-Pf-Prioritylevel-Uid", "Server", "Warning",
	}

	spikeSnapshotOrder = []string{spikeSnapAfterCreate, spikeSnapAfterGet, spikeSnapAfterPut, spikeSnapAfterPatch, spikeSnapOnList}
)

// --- Report types ------------------------------------------------------------

type spikeIdentity struct {
	Status           string `json:"status"`
	Reason           string `json:"reason,omitempty"`
	Sub              string `json:"sub,omitempty"`
	Login            string `json:"login,omitempty"`
	Name             string `json:"name,omitempty"`
	IDTokenForwarded bool   `json:"idTokenForwarded"`
	PluginUserLogin  string `json:"pluginUserLogin,omitempty"`
	Role             string `json:"role"`
	OrgID            int64  `json:"orgId"`
}

type spikeTarget struct {
	GroupVersion string `json:"groupVersion"`
	Resource     string `json:"resource"`
	Namespace    string `json:"namespace"`
}

// spikeStatusSummary is what goes out for a Kubernetes Status body or any
// non-2xx / non-JSON response. Never a raw success body.
type spikeStatusSummary struct {
	Status       int    `json:"status"`
	ContentType  string `json:"contentType"`
	IsStatusJSON bool   `json:"isStatusJSON"`
	Kind         string `json:"kind,omitempty"`
	Reason       string `json:"reason,omitempty"`
	Message      string `json:"message,omitempty"`
	Code         int64  `json:"code,omitempty"`
	Details      any    `json:"details,omitempty"`
	Excerpt      string `json:"excerpt,omitempty"`
	// ExcerptTruncated is set when the excerpt was cut at spikeExcerptMaxBytes.
	ExcerptTruncated bool `json:"excerptTruncated,omitempty"`
}

type spikeMetaSnapshot struct {
	Name                 string            `json:"name"`
	Namespace            string            `json:"namespace,omitempty"`
	UID                  string            `json:"uid,omitempty"`
	ResourceVersion      string            `json:"resourceVersion,omitempty"`
	Generation           *int64            `json:"generation,omitempty"`
	CreationTimestamp    string            `json:"creationTimestamp,omitempty"`
	Labels               map[string]string `json:"labels,omitempty"`
	Annotations          map[string]string `json:"annotations,omitempty"`
	ManagedFieldsPresent bool              `json:"managedFieldsPresent"`
	ManagedFieldsCount   int               `json:"managedFieldsCount"`
	Managers             []string          `json:"managers,omitempty"`
}

type spikeStep struct {
	Check              string              `json:"check"`
	Method             string              `json:"method,omitempty"`
	Path               string              `json:"path,omitempty"`
	RequestContentType string              `json:"requestContentType,omitempty"`
	BodySummary        string              `json:"bodySummary,omitempty"`
	Status             int                 `json:"status,omitempty"`
	DurationMs         int64               `json:"durationMs"`
	Headers            map[string]string   `json:"headers,omitempty"`
	StatusBody         *spikeStatusSummary `json:"statusBody,omitempty"`
	Meta               *spikeMetaSnapshot  `json:"meta,omitempty"`
	Expected           string              `json:"expected,omitempty"`
	Verdict            string              `json:"verdict"`
	Note               string              `json:"note,omitempty"`
	Error              string              `json:"error,omitempty"`
}

type spikeNamedSnapshot struct {
	Label string
	Meta  *spikeMetaSnapshot
}

type spikeTimestampKey struct {
	Key string `json:"key"`
	// Values maps each snapshot taken to the annotation value; null = absent.
	Values             map[string]*string `json:"values"`
	PresentAfterCreate bool               `json:"presentAfterCreate"`
	ChangedByPut       bool               `json:"changedByPut"`
	ChangedByPatch     bool               `json:"changedByPatch"`
	ReturnedOnList     bool               `json:"returnedOnList"`
}

type spikeTimestampReport struct {
	SnapshotsTaken    []string            `json:"snapshotsTaken"`
	Keys              []spikeTimestampKey `json:"keys"`
	OtherMatchingKeys []string            `json:"otherMatchingKeys"`
}

type spikeRVSample struct {
	Snapshot string `json:"snapshot"`
	Value    string `json:"value"`
	Numeric  bool   `json:"numeric"`
	Digits   int    `json:"digits,omitempty"`
}

type spikeStorageSignals struct {
	GroupVersion           string              `json:"groupVersion"`
	Resource               string              `json:"resource"`
	AnnotationKeysByFamily map[string][]string `json:"annotationKeysByFamily"`
	ResourceVersionSamples []spikeRVSample     `json:"resourceVersionSamples"`
	ManagedFieldsPresent   bool                `json:"managedFieldsPresent"`
	Managers               []string            `json:"managers"`
	Generations            []int64             `json:"generations"`
	ResponseHeaders        map[string][]string `json:"responseHeaders"`
	Conclusion             string              `json:"conclusion"`
}

type spikeCleanupResult struct {
	Name          string `json:"name"`
	CreateOutcome string `json:"createOutcome"` // created | ambiguous | rejected | not-sent
	Outcome       string `json:"outcome"`       // deleted | absent | leftover | refused
	Reason        string `json:"reason,omitempty"`
	DeleteStatus  int    `json:"deleteStatus,omitempty"`
}

type spikeFindings struct {
	DependentStepsSkipped     bool   `json:"dependentStepsSkipped"`
	CreateStatus              int    `json:"createStatus"`
	PutStatus                 int    `json:"putStatus"`
	PutPersisted              bool   `json:"putPersisted"`
	PutWorks                  bool   `json:"putWorks"`
	StalePutSkipped           bool   `json:"stalePutSkipped"`
	StalePutStatus            int    `json:"stalePutStatus"`
	StalePutConflicts         bool   `json:"stalePutConflicts"`
	MergePatchStatus          int    `json:"mergePatchStatus"`
	MergePatchPersisted       bool   `json:"mergePatchPersisted"`
	MergePatchWorks           bool   `json:"mergePatchWorks"`
	MergePatchStaleStatus     int    `json:"mergePatchStaleStatus"`
	MergePatchStaleConflicts  bool   `json:"mergePatchStaleConflicts"`
	MergePatchStalePersisted  bool   `json:"mergePatchStalePersisted"`
	MergePatchStaleMeaningful bool   `json:"mergePatchStaleMeaningful"`
	OnList                    string `json:"onList"`
	ListItemsReturned         int    `json:"listItemsReturned"`
	Check8Status              int    `json:"check8Status"`
	Check8Reason              string `json:"check8Reason,omitempty"`
	DeleteWorks               bool   `json:"deleteWorks"`
	// NotFoundDistinguishable is "yes" | "no" | "inconclusive" (6a and 6b
	// did not both return 404).
	NotFoundDistinguishable       string `json:"notFoundDistinguishable"`
	NotFoundDistinguishableReason string `json:"notFoundDistinguishableReason"`
}

type spikeReport struct {
	Banner          string               `json:"banner"`
	Question        string               `json:"question"`
	Expires         string               `json:"expires"`
	RunID           string               `json:"runId"`
	StartedAt       string               `json:"startedAt"`
	FinishedAt      string               `json:"finishedAt"`
	Target          spikeTarget          `json:"target"`
	Identity        spikeIdentity        `json:"identity"`
	Records         []string             `json:"records"`
	Steps           []*spikeStep         `json:"steps"`
	Findings        spikeFindings        `json:"findings"`
	UpdateTimestamp spikeTimestampReport `json:"updateTimestamp"`
	StorageSignals  spikeStorageSignals  `json:"storageSignals"`
	Cleanup         []spikeCleanupResult `json:"cleanup"`
	Decision        []string             `json:"decision"`
}

// --- Redaction ---------------------------------------------------------------

// spikeRedactor scrubs every outgoing string: exact known secrets (minted
// access tokens, the inbound ID token), upstream URLs/hosts, plus token-shaped
// patterns.
type spikeRedactor struct{ secrets, upstream []string }

// addUpstream registers a URL whose full form, scheme://host, host and
// hostname are replaced with "[upstream]".
func (r *spikeRedactor) addUpstream(raw string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return
	}
	forms := []string{raw, strings.TrimRight(raw, "/")}
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		forms = append(forms, u.Scheme+"://"+u.Host, u.Host, u.Hostname())
	}
	for _, f := range forms {
		if f == "" || slices.Contains(r.upstream, f) {
			continue
		}
		r.upstream = append(r.upstream, f)
	}
	sort.Slice(r.upstream, func(i, j int) bool { return len(r.upstream[i]) > len(r.upstream[j]) })
}

func (r *spikeRedactor) addSecret(s string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return
	}
	for _, e := range r.secrets {
		if e == s {
			return
		}
	}
	r.secrets = append(r.secrets, s)
	// Longest first, so a secret that contains another is removed whole.
	sort.Slice(r.secrets, func(i, j int) bool { return len(r.secrets[i]) > len(r.secrets[j]) })
}

func (r *spikeRedactor) str(s string) string {
	if r != nil {
		for _, sec := range r.secrets {
			s = strings.ReplaceAll(s, sec, spikeRedacted)
		}
		for _, up := range r.upstream {
			s = strings.ReplaceAll(s, up, spikeUpstream)
		}
	}
	s = spikeJWTPattern.ReplaceAllString(s, spikeRedacted)
	s = spikeBearerPattern.ReplaceAllString(s, spikeRedacted)
	s = spikeGrafanaTokenPattern.ReplaceAllString(s, spikeRedacted)
	return s
}

// value redacts a decoded JSON value recursively; map values under a
// sensitive-looking key are replaced outright.
func (r *spikeRedactor) value(v any) any {
	switch t := v.(type) {
	case string:
		return r.str(t)
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if spikeSensitiveKeyPattern.MatchString(k) {
				out[r.str(k)] = spikeRedacted
				continue
			}
			out[r.str(k)] = r.value(val)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i := range t {
			out[i] = r.value(t[i])
		}
		return out
	default:
		return v
	}
}

// --- Parsing -----------------------------------------------------------------

func spikeDecodeObject(body []byte) (map[string]any, bool) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil || m == nil {
		return nil, false
	}
	return m, true
}

func spikeString(v any) string {
	s, _ := v.(string)
	return s
}

func spikeInt(v any) (int64, bool) {
	switch n := v.(type) {
	case json.Number:
		i, err := n.Int64()
		return i, err == nil
	case float64:
		return int64(n), true
	case int:
		return int64(n), true
	case int64:
		return n, true
	}
	return 0, false
}

func spikeMetaMap(obj map[string]any) map[string]any {
	md, _ := obj["metadata"].(map[string]any)
	return md
}

func spikeMetaField(obj map[string]any, key string) string {
	return spikeString(spikeMetaMap(obj)[key])
}

func spikeSpecPercent(obj map[string]any) (int64, bool) {
	spec, _ := obj["spec"].(map[string]any)
	return spikeInt(spec["completionPercent"])
}

func spikeStringMap(v any, red *spikeRedactor, maxBytes int) map[string]string {
	m, ok := v.(map[string]any)
	if !ok || len(m) == 0 {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, val := range m {
		if spikeSensitiveKeyPattern.MatchString(k) {
			out[red.str(k)] = spikeRedacted
			continue
		}
		s := red.str(spikeString(val))
		if maxBytes > 0 && len(s) > maxBytes {
			s = strings.ToValidUTF8(s[:maxBytes], "") + "…[truncated]"
		}
		out[red.str(k)] = s
	}
	return out
}

// spikeMetaFrom snapshots an object's metadata; nil when there is no
// metadata.name (e.g. a List or a Status).
func spikeMetaFrom(obj map[string]any, red *spikeRedactor) *spikeMetaSnapshot {
	md := spikeMetaMap(obj)
	name := spikeString(md["name"])
	if name == "" {
		return nil
	}
	m := &spikeMetaSnapshot{
		Name:              red.str(name),
		Namespace:         red.str(spikeString(md["namespace"])),
		UID:               red.str(spikeString(md["uid"])),
		ResourceVersion:   red.str(spikeString(md["resourceVersion"])),
		CreationTimestamp: red.str(spikeString(md["creationTimestamp"])),
		Labels:            spikeStringMap(md["labels"], red, spikeAnnotationMaxBytes),
		Annotations:       spikeStringMap(md["annotations"], red, spikeAnnotationMaxBytes),
	}
	if g, ok := spikeInt(md["generation"]); ok {
		m.Generation = &g
	}
	if mf, ok := md["managedFields"].([]any); ok {
		m.ManagedFieldsPresent = true
		m.ManagedFieldsCount = len(mf)
		for _, e := range mf {
			entry, _ := e.(map[string]any)
			if mgr := spikeString(entry["manager"]); mgr != "" {
				m.Managers = append(m.Managers, red.str(mgr))
			}
		}
	}
	return m
}

// spikeCapExcerpt bounds an already-redacted excerpt.
func spikeCapExcerpt(s string) (string, bool) {
	if len(s) <= spikeExcerptMaxBytes {
		return strings.ToValidUTF8(s, ""), false
	}
	return strings.ToValidUTF8(s[:spikeExcerptMaxBytes], ""), true
}

func spikeExcerpt(body []byte, red *spikeRedactor) (string, bool) {
	// Redact the whole body first so truncation can't split a secret past the
	// patterns.
	return spikeCapExcerpt(red.str(string(body)))
}

// spikeJSONExcerpt renders a non-Status JSON error body: sensitive keys
// redacted recursively, metadata.managedFields dropped, patterns redacted,
// then capped.
func spikeJSONExcerpt(obj map[string]any, red *spikeRedactor) (string, bool) {
	v, _ := red.value(obj).(map[string]any)
	if md, ok := v["metadata"].(map[string]any); ok {
		delete(md, "managedFields")
	}
	return spikeCapExcerpt(red.str(string(spikeJSON(v))))
}

// spikeSummarize turns a response into what the report may carry: a Status
// summary (for kind=Status, any non-2xx, or a non-JSON body) and/or a metadata
// snapshot. The decoded object is returned for the runner's internal use only.
func spikeSummarize(status int, contentType string, body []byte, red *spikeRedactor) (*spikeStatusSummary, *spikeMetaSnapshot, map[string]any) {
	obj, isJSON := spikeDecodeObject(body)
	kind := spikeString(obj["kind"])
	if isJSON && kind == "Status" {
		s := &spikeStatusSummary{
			Status:       status,
			ContentType:  red.str(contentType),
			IsStatusJSON: true,
			Kind:         kind,
			Reason:       red.str(spikeString(obj["reason"])),
			Message:      red.str(spikeString(obj["message"])),
		}
		if code, ok := spikeInt(obj["code"]); ok {
			s.Code = code
		}
		if d, ok := obj["details"]; ok {
			s.Details = red.value(d)
		}
		return s, nil, obj
	}
	var meta *spikeMetaSnapshot
	if isJSON {
		meta = spikeMetaFrom(obj, red)
		if status >= 200 && status < 300 {
			return nil, meta, obj
		}
	}
	s := &spikeStatusSummary{Status: status, ContentType: red.str(contentType)}
	if isJSON {
		s.Kind = red.str(kind)
		s.Excerpt, s.ExcerptTruncated = spikeJSONExcerpt(obj, red)
	} else if len(body) > 0 {
		s.Excerpt, s.ExcerptTruncated = spikeExcerpt(body, red)
	}
	return s, meta, obj
}

// spikeVerdict: error when no response arrived, observe when nothing specific
// is expected, otherwise pass/fail against the expected statuses.
func spikeVerdict(status int, noResponse bool, want []int) string {
	if noResponse {
		return spikeError
	}
	if len(want) == 0 {
		return spikeObserve
	}
	for _, w := range want {
		if status == w {
			return spikePass
		}
	}
	return spikeFail
}

func spikePassFail(ok bool) string {
	if ok {
		return spikePass
	}
	return spikeFail
}

func spike2xx(status int) bool { return status >= 200 && status < 300 }

func spikeMediaType(ct string) string {
	if mt, _, err := mime.ParseMediaType(ct); err == nil {
		return mt
	}
	return strings.TrimSpace(ct)
}

// spikeDistinguishable reports whether a missing-name 404 can be told apart
// from an unserved-route 404 by body shape, reason or media type: "yes" or
// "no" when both returned 404, otherwise "inconclusive". The second value is
// the reason.
func spikeDistinguishable(missingStatus int, missing *spikeStatusSummary, unservedStatus int, unserved *spikeStatusSummary) (string, string) {
	if missingStatus != 404 || unservedStatus != 404 || missing == nil || unserved == nil {
		return "inconclusive", fmt.Sprintf("needs a 404 from both check6a and check6b (got %d and %d)", missingStatus, unservedStatus)
	}
	var diffs []string
	if missing.IsStatusJSON != unserved.IsStatusJSON {
		diffs = append(diffs, "isStatusJSON")
	}
	if missing.Reason != unserved.Reason {
		diffs = append(diffs, "reason")
	}
	if spikeMediaType(missing.ContentType) != spikeMediaType(unserved.ContentType) {
		diffs = append(diffs, "media type")
	}
	if len(diffs) == 0 {
		return "no", "same isStatusJSON, reason and media type"
	}
	return "yes", "differ by " + strings.Join(diffs, ", ")
}

// --- Findings ----------------------------------------------------------------

func spikeTimestampFindings(snaps []spikeNamedSnapshot) spikeTimestampReport {
	rep := spikeTimestampReport{SnapshotsTaken: []string{}, Keys: []spikeTimestampKey{}, OtherMatchingKeys: []string{}}
	byLabel := map[string]*spikeMetaSnapshot{}
	for _, s := range snaps {
		if s.Meta == nil {
			continue
		}
		if _, dup := byLabel[s.Label]; !dup {
			rep.SnapshotsTaken = append(rep.SnapshotsTaken, s.Label)
		}
		byLabel[s.Label] = s.Meta
	}
	get := func(label, key string) (string, bool) {
		m := byLabel[label]
		if m == nil {
			return "", false
		}
		v, ok := m.Annotations[key]
		return v, ok && v != ""
	}
	changed := func(fromLabel, toLabel, key string) bool {
		if byLabel[toLabel] == nil {
			return false
		}
		after, ok := get(toLabel, key)
		if !ok {
			return false
		}
		before, had := get(fromLabel, key)
		return !had || before != after
	}

	tracked := []string{spikeAnnoUpdatedTimestampApp, spikeAnnoUpdateTimestampCom}
	for _, key := range tracked {
		k := spikeTimestampKey{Key: key, Values: map[string]*string{}}
		for _, label := range spikeSnapshotOrder {
			if byLabel[label] == nil {
				continue
			}
			if v, ok := get(label, key); ok {
				vv := v
				k.Values[label] = &vv
			} else {
				k.Values[label] = nil
			}
		}
		_, k.PresentAfterCreate = get(spikeSnapAfterCreate, key)
		k.ChangedByPut = changed(spikeSnapAfterGet, spikeSnapAfterPut, key)
		patchBase := spikeSnapAfterPut
		if byLabel[patchBase] == nil {
			patchBase = spikeSnapAfterGet
		}
		k.ChangedByPatch = changed(patchBase, spikeSnapAfterPatch, key)
		_, k.ReturnedOnList = get(spikeSnapOnList, key)
		rep.Keys = append(rep.Keys, k)
	}

	seen := map[string]bool{tracked[0]: true, tracked[1]: true}
	for _, m := range byLabel {
		for key := range m.Annotations {
			if !seen[key] && spikeTimestampKeyPattern.MatchString(key) {
				seen[key] = true
				rep.OtherMatchingKeys = append(rep.OtherMatchingKeys, key)
			}
		}
	}
	sort.Strings(rep.OtherMatchingKeys)
	return rep
}

func spikeAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// spikeStorage collects observable storage signals. It draws no conclusion:
// nothing a client sees proves which storage backend serves the kind.
func spikeStorage(snaps []spikeNamedSnapshot, headers map[string][]string) spikeStorageSignals {
	sig := spikeStorageSignals{
		GroupVersion:           completionRecordsGroupVersion,
		Resource:               completionRecordsResource,
		AnnotationKeysByFamily: map[string][]string{"grafana.app/": {}, "grafana.com/": {}, "other": {}},
		ResourceVersionSamples: []spikeRVSample{},
		Managers:               []string{},
		Generations:            []int64{},
		ResponseHeaders:        headers,
		Conclusion:             spikeStorageConclusion,
	}
	seenKey, seenMgr := map[string]bool{}, map[string]bool{}
	for _, s := range snaps {
		m := s.Meta
		if m == nil {
			continue
		}
		for key := range m.Annotations {
			if seenKey[key] {
				continue
			}
			seenKey[key] = true
			fam := "other"
			switch {
			case strings.HasPrefix(key, "grafana.app/"):
				fam = "grafana.app/"
			case strings.HasPrefix(key, "grafana.com/"):
				fam = "grafana.com/"
			}
			sig.AnnotationKeysByFamily[fam] = append(sig.AnnotationKeysByFamily[fam], key)
		}
		if rv := m.ResourceVersion; rv != "" {
			sample := spikeRVSample{Snapshot: s.Label, Value: rv, Numeric: spikeAllDigits(rv)}
			if sample.Numeric {
				sample.Digits = len(rv)
			}
			sig.ResourceVersionSamples = append(sig.ResourceVersionSamples, sample)
		}
		if m.ManagedFieldsPresent {
			sig.ManagedFieldsPresent = true
		}
		for _, mgr := range m.Managers {
			if !seenMgr[mgr] {
				seenMgr[mgr] = true
				sig.Managers = append(sig.Managers, mgr)
			}
		}
		if m.Generation != nil {
			sig.Generations = append(sig.Generations, *m.Generation)
		}
	}
	for fam := range sig.AnnotationKeysByFamily {
		sort.Strings(sig.AnnotationKeysByFamily[fam])
	}
	return sig
}

// spikeDecide applies the plan's decision rule (first match wins), then adds
// the timestamp, authz and check-8 lines.
func spikeDecide(f spikeFindings, ts spikeTimestampReport) []string {
	var lines []string
	switch {
	case !f.PutWorks && !f.MergePatchWorks:
		lines = append(lines, "STOP: no in-place update path for a Viewer via OBO")
	case f.PutWorks && f.StalePutConflicts:
		lines = append(lines, "PROCEED: GET→PUT with metadata.resourceVersion")
	case f.PutWorks:
		lines = append(lines, "CAUTION: PUT persists but optimistic concurrency not enforced — do not proceed without resolving")
	default:
		l := "USE MERGE-PATCH"
		switch {
		case !f.MergePatchStaleMeaningful:
			l += " — stale-RV protection not demonstrated"
		case f.MergePatchStaleConflicts && !f.MergePatchStalePersisted:
			l += " with RV precondition (stale rejected)"
		default:
			l += " — WARNING: stale RV not rejected"
		}
		lines = append(lines, l)
	}
	if f.DependentStepsSkipped {
		lines = append(lines, "NOTE: create or the first GET failed, so the update checks were skipped — the verdict above is not conclusive")
	}

	var observed []string
	for _, k := range ts.Keys {
		if k.ChangedByPut || k.ChangedByPatch {
			observed = append(observed, fmt.Sprintf("%s (presentAfterCreate=%t, changedByPut=%t, changedByPatch=%t, returnedOnList=%t)",
				k.Key, k.PresentAfterCreate, k.ChangedByPut, k.ChangedByPatch, k.ReturnedOnList))
		}
	}
	if len(observed) == 0 {
		lines = append(lines, "NO SERVER UPDATE TIMESTAMP: use spec.recordedAt")
	} else {
		lines = append(lines, "SERVER UPDATE TIMESTAMP: "+strings.Join(observed, "; "))
	}

	if isIdentityScopedUpstreamStatus(f.PutStatus) || isIdentityScopedUpstreamStatus(f.MergePatchStatus) {
		lines = append(lines, fmt.Sprintf("AUTHZ: Viewer's delegated token lacks update/patch (PUT status %d, PATCH status %d)", f.PutStatus, f.MergePatchStatus))
	}

	switch {
	case f.Check8Status == 0:
		lines = append(lines, "CHECK 8 (completedAt omitted): no response — see steps")
	case spike2xx(f.Check8Status):
		lines = append(lines, fmt.Sprintf("CHECK 8 (completedAt omitted): status %d — SIGNIFICANT: the current CRD accepted a record without completedAt", f.Check8Status))
	default:
		lines = append(lines, fmt.Sprintf("CHECK 8 (completedAt omitted): status %d, reason %q (plan expects 422)", f.Check8Status, f.Check8Reason))
	}
	return lines
}
