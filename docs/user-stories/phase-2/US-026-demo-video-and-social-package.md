# US-026: Demo Video and Social Package

## Status

- State: `todo`
- Owner: `youssef`
- Depends on: US-023, US-024, US-025
- Related PR/Commit:
- Target environment: `prod`

## Persona

**Reviewer/Admissions audience** needs a concise walkthrough and public communication artifact.

## User Story

> As a reviewer, I want a short demo and social summary so that project value and outcomes are quickly understandable.

## Goal

Produce final demo video package (3-5 minutes) and publishable social post content with feature summary, screenshots, and links.

## Scope

In scope:

1. Demo script covering architecture, tools, evals, observability, and FAB UX.
2. Final demo video link.
3. Social post draft/content package with required references.
4. Link package into final submission document.

Out of scope:

1. Long-form tutorial production.
2. Paid promotion.

## Acceptance Criteria

- [ ] AC1: Demo video link is published and accessible.
- [ ] AC2: Demo includes agent workflow, eval outcomes, and observability evidence.
- [ ] AC3: Social post package is ready with links/screenshots summary.
- [ ] AC4: Artifacts are linked from final submission bundle.

## Local Validation

```bash
rg -n "demo|video|social|linkedin|x" docs -g '*.md'
```

## How To Verify In Prod

- N/A (artifact publication story).

## Checkpoint Result

- Commit SHA:
- Demo URL:
- Social URL(s):
- User Validation: `passed | failed | blocked`
- Definition of Done: `all passed | exceptions noted below`
- Notes:
