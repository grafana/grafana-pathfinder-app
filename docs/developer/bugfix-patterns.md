# Bugfix patterns

Patterns from resolved robustness issues. Loaded during `/bugfix` Phase 2 to inform classification and root cause hypotheses.

| Issue | Category   | Root cause pattern                                                                                                                                                                                | Files                                                                                             | Date       |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| #782  | State bug  | Static class flag survives across instances — use instance-level guards for per-lifecycle state                                                                                                   | docs-panel.tsx, ContextPanel.tsx, FloatingPanelManager.tsx                                        | 2026-04-27 |
| #778  | Visual bug | Redundant UI element removed — text glyph animated with CSS rotation but no fixed bounding box or transform-origin causes off-axis spin; duplicate progress indicator already covered the UX need | `src/components/interactive-tutorial/interactive-section.tsx`, `src/styles/interactive.styles.ts` | 2026-04-27 |
