# Bugfix patterns

Patterns from resolved robustness issues. Loaded during `/bugfix` Phase 2 to inform classification and root cause hypotheses.

| Issue | Category  | Root cause pattern                                                                              | Files                                                      | Date       |
| ----- | --------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| #782  | State bug | Static class flag survives across instances — use instance-level guards for per-lifecycle state | docs-panel.tsx, ContextPanel.tsx, FloatingPanelManager.tsx | 2026-04-27 |
