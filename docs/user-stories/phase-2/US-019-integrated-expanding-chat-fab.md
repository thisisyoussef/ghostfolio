# US-019: Integrated Expanding Chat FAB

## Status

- State: `todo`
- Owner: `youssef`
- Depends on: US-018
- Related PR/Commit:
- Target environment: `prod`

## Persona

**Sam, the End User** wants fast assistant access from anywhere in the authenticated app without leaving context.

## User Story

> As Sam, I want an expanding chat FAB integrated into the main UI so that I can open assistant chat from any internal page.

## Goal

Add a production-grade FAB-based chat dock that coexists with existing header assistant, supports desktop panel/mobile sheet layouts, and shares session state with `/agent`.

## Locked Decisions

1. Show FAB on all authenticated internal routes.
2. Hide FAB on public/auth routes.
3. Keep header `gf-assistant` intact in this phase.
4. Keep `/agent` route as full-page fallback.
5. Desktop: right-side overlay panel.
6. Mobile: bottom-sheet style panel.
7. Desktop widths: compact `420px`, expanded `640px`.
8. Persist session/messages across route changes (same browser tab).

## Scope

In scope:

1. New frontend chat dock state service:
   - `isOpen`, `isExpanded`, `presentationMode`, `sessionId`, `messages`.
2. Extract reusable chat surface from current agent page.
3. Embed shared chat surface into:
   - `/agent` page
   - FAB panel/sheet container
4. Add keyboard/accessibility controls:
   - focus trap when open
   - `Esc` closes
   - aria labels on FAB and panel controls
5. Keep all existing assistant menu behavior unchanged.

Out of scope:

1. Removing/replacing existing header assistant.
2. Marketing/public route FAB exposure.

## Pre-Implementation Audit

1. `apps/client/src/app/app.component.*` — global shell placement.
2. `apps/client/src/app/pages/agent/*` — current chat surface.
3. `apps/client/src/app/components/header/*` and `libs/ui/src/lib/assistant/*` — coexistence constraints.
4. `apps/client/src/styles.scss` — existing FAB and layout conventions.

## Acceptance Criteria

- [ ] AC1: FAB appears on authenticated internal routes only.
- [ ] AC2: FAB opens/closes chat dock on desktop and mobile.
- [ ] AC3: Desktop expand/collapse toggles 420px/640px widths.
- [ ] AC4: Session/messages persist across internal navigation and are shared with `/agent`.
- [ ] AC5: Header `gf-assistant` continues to function unchanged.
- [ ] AC6: Accessibility requirements (focus trap, Esc, aria labels) pass manual checks.

## Local Validation

```bash
npx nx test client --testPathPattern="agent|app.component|header"
npx nx build client
```

## How To Verify In Prod

1. Navigate across authenticated pages and confirm FAB visibility.
2. Open FAB chat, send messages, navigate to another internal page, confirm history persists.
3. Open `/agent`, confirm same session/messages.
4. Use keyboard-only flow: open, tab cycle, `Esc` close.
5. Confirm header assistant menu still opens and works.

## Checkpoint Result

- Commit SHA:
- Production URL(s):
- User Validation: `passed | failed | blocked`
- Definition of Done: `all passed | exceptions noted below`
- Notes:
