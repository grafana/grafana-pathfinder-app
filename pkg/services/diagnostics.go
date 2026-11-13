package services

type ProxyDiagnostic struct {
	Stage            string         `json:"stage,omitempty"`
	Resource         string         `json:"resource,omitempty"`
	Operation        string         `json:"operation,omitempty"`
	Outcome          string         `json:"outcome"`
	Reason           string         `json:"reason,omitempty"`
	UpstreamStatus   int            `json:"upstreamStatus,omitempty"`
	Cache            string         `json:"cache,omitempty"`
	CacheAgeMS       int64          `json:"cacheAgeMs"`
	ManifestFailures map[string]int `json:"manifestFailures,omitempty"`
	BudgetExhausted  bool           `json:"budgetExhausted,omitempty"`
}
