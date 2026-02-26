# US-025: Open-Source Release (Public Dataset)

## Status

- State: `todo`
- Owner: `youssef`
- Depends on: US-018, US-021
- Related PR/Commit:
- Target environment: `prod`

## Persona

**Open-source users** need a reusable evaluation artifact with clear usage instructions.

## User Story

> As an open-source consumer, I want a published eval dataset and instructions so that I can reuse and benchmark similar agent implementations.

## Goal

Publish the agent eval dataset contribution publicly with stable link, metadata, and usage guidance suitable for submission evidence.

## Scope

In scope:

1. Package dataset for public release.
2. Publish and capture canonical public URL.
3. Add usage/readme guidance.
4. Record version and changelog notes for release artifact.

Out of scope:

1. Publishing a standalone npm package unless needed.
2. Framework core PR contribution.

## Acceptance Criteria

- [ ] AC1: Public link to released dataset exists and is accessible.
- [ ] AC2: Dataset usage documentation is included.
- [ ] AC3: Release artifact is referenced in final architecture/submission docs.
- [ ] AC4: Licensing/attribution notes are explicit.

## Local Validation

```bash
rg -n "open source|dataset|release|public" docs -g '*.md'
```

## How To Verify In Prod

- N/A (publication evidence story).

## Checkpoint Result

- Commit SHA:
- Public URL:
- User Validation: `passed | failed | blocked`
- Definition of Done: `all passed | exceptions noted below`
- Notes:
