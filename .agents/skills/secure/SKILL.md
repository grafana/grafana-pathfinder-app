---
name: secure
description: Security audit — frontend (F1-F6 rules from `.cursor/rules/frontend-security.mdc`), Go backend (URL allowlists, token handling, hardcoded secrets, unbounded reads), MCP HTTP transport (size / wallclock / concurrency caps, Zod-validated tool inputs), and dependency audit (`npm audit` high+critical, Go module advisories). Reports findings with concrete remediation per rule. Never edits source — the user applies fixes.
---

Read `.cursor/skills/secure/SKILL.md` and follow it exactly.
