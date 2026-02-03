---
description: Comprehensive PR review checklist for Grafana Pathfinder
globs:
  - '**/*.ts'
  - '**/*.tsx'
---

# PR Review Guidelines

This document provides structured guidelines for conducting thorough code reviews on pull requests. All reviews should be conducted at a **Principal Engineer level**, focusing on long-term maintainability, testability, and adherence to established patterns.

## Review Process Overview

### Step 1: Understand the Change

- [ ] Read the PR description and linked issues
- [ ] Provide a brief one-paragraph summary of what the code does
- [ ] Note any major components being added, changed, or removed

### Step 2: Apply Required Rule Sets

Before reviewing the implementation details, apply the following rule sets:

- [ ] **React Anti-Patterns**: Read and apply rules from @react-antipatterns.mdc (R1-R15)
- [ ] **Security Guidelines**: Read and apply rules from @frontend-security.mdc (F1-F6)

### Step 3: Evaluate Code Quality Dimensions

---

## Testability

Evaluate whether the code can be effectively tested:

- [ ] Are functions pure where possible (same input → same output)?
- [ ] Are dependencies injected rather than hardcoded?
- [ ] Are side effects isolated and mockable?
- [ ] Do components accept props that enable testing different states?
- [ ] Is there appropriate separation between business logic and UI rendering?

**Red flags:**

- Functions that directly access global state or singletons
- Components that fetch data internally without abstraction
- Tightly coupled modules that require extensive mocking
- Missing or inadequate test coverage for critical paths

---

## Modularity

Evaluate the structural organization of the code:

- [ ] Does each module/component have a single, clear responsibility?
- [ ] Are boundaries between modules well-defined?
- [ ] Can components be reused in different contexts?
- [ ] Are imports/dependencies organized logically?
- [ ] Does the code follow the existing project structure patterns?

**Red flags:**

- Components doing too many unrelated things
- Circular dependencies
- God objects that accumulate unrelated functionality
- Utility functions scattered across multiple locations

---

## Maintainability

Evaluate long-term sustainability of the code:

- [ ] Is the code self-documenting with clear naming?
- [ ] Are complex algorithms or business rules documented?
- [ ] Is the code DRY (Don't Repeat Yourself)?
- [ ] Will future developers understand the intent?
- [ ] Are magic numbers and strings extracted to constants?

**Red flags:**

- Commented-out code left in place
- Unclear variable/function names
- Overly clever code that sacrifices readability
- Missing error handling or edge case coverage

---

## Vibe Coding Smells

Watch for signs of AI-assisted code that lacks human review.

**Important**: PR authors are **not responsible** for refactoring existing large components they touch. However, they **should not create new** components that violate these constraints. Focus your review on newly introduced code.

### Large Components

- [ ] **New** components should generally be under 200-300 lines
- [ ] Flag any **newly created** component file exceeding 400 lines
- [ ] Check for **new** components with more than 5-6 responsibilities
- [ ] Existing large components are technical debt but not blocking for the PR

### God Objects

- [ ] Watch for **new** classes/objects that try to do everything
- [ ] Flag **new** state objects with more than 10 unrelated properties
- [ ] Identify **new** "manager" or "handler" classes that accumulate logic

### Duplicated Logic

- [ ] Look for copy-paste patterns across files
- [ ] Identify similar components that could be abstracted
- [ ] Check for repeated utility functions that should be shared

### Excess Verbosity

- [ ] Flag unnecessarily complex solutions to simple problems
- [ ] Identify over-engineered abstractions
- [ ] Look for boilerplate that could be simplified

### Missing Integration

- [ ] Check if new code leverages existing utilities
- [ ] Verify pattern consistency with the rest of the codebase
- [ ] Confirm that new components follow established conventions

---

## Code Duplication & Pattern Reuse

### Before Approving, Verify:

- [ ] Has the author checked for existing utilities that solve the same problem?
- [ ] Does new code follow existing patterns in the codebase?
- [ ] Are there opportunities to extract shared logic?
- [ ] Is the code consistent with adjacent code in style and approach?

### Common Reusable Patterns in This Repo:

- Check `src/utils/` for existing utility functions
- Check `src/components/` for existing reusable components
- Check `src/styles/` for theme-aware styling functions
- Check `src/hooks/` for existing custom hooks

---

## Additional Quality Considerations

### Performance

- [ ] Are expensive calculations memoized appropriately?
- [ ] Are there potential memory leaks (uncleaned effects)?
- [ ] Are lists rendered efficiently with proper keys?

### Error Handling

- [ ] Are errors caught and handled gracefully?
- [ ] Is there appropriate user feedback for failure states?
- [ ] Are error boundaries in place where needed?

### Accessibility

- [ ] Are interactive elements keyboard-navigable?
- [ ] Are appropriate ARIA labels provided?
- [ ] Is color contrast sufficient?

### TypeScript

- [ ] Are types properly defined (avoid `any`)?
- [ ] Are interfaces/types exported where needed?
- [ ] Are generics used appropriately?

---

## Review Output Format

**Keep review responses terse and focused.** Do not recap every check performed.

### When All Checks Pass

If the PR has no issues, provide a brief response like:

> "LGTM. No security, anti-pattern, or vibe coding issues found. Approve to merge."

Do **not** enumerate every rule checked or every section of this guide. One line is sufficient for a clean PR.

### When Issues Are Found

Only elaborate on specific problems. For each issue:

- State the problem concisely
- Reference the relevant rule (e.g., R3, F2)
- Suggest a fix if straightforward

Avoid verbose explanations of rules the code already follows correctly.

---

## Review Disposition

After completing the review, provide one of these recommendations:

| Disposition                    | Criteria                                                 |
| ------------------------------ | -------------------------------------------------------- |
| **Approve to Merge**           | Code meets all standards, tests pass, no blocking issues |
| **Approve with Minor Changes** | Small improvements suggested but not blocking            |
| **Request Changes**            | Blocking issues that must be addressed before merge      |

### Final Checklist

- [ ] PR description accurately describes the change
- [ ] Tests are included for new functionality
- [ ] No new linting errors introduced
- [ ] Security rules (F1-F6) have been verified
- [ ] React anti-patterns (R1-R15) have been checked
- [ ] Code follows existing repo patterns
- [ ] No obvious vibe coding smells

---

## Review Comment Best Practices

When leaving feedback:

1. **Be specific**: Point to exact lines and explain the issue
2. **Be constructive**: Suggest alternatives, not just problems
3. **Prioritize**: Mark comments as blocking vs. suggestions
4. **Be respectful**: Critique code, not people
5. **Explain "why"**: Help the author learn, not just fix

### Comment Prefixes

Use these prefixes to clarify intent:

- `[blocking]` - Must be addressed before merge
- `[suggestion]` - Nice to have but not required
- `[question]` - Seeking clarification
- `[nit]` - Minor style/preference issue
- `[security]` - Security-related concern (reference F1-F6)
- `[react]` - React anti-pattern concern (reference R1-R15)
