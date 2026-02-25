# User Stories

Use this folder as the source of truth for build order and implementation scope.

## Ground rule: production-grade only

Every story ships to a production environment serving real users. There are no "demo" or "prototype" phases.

- **No mocks, stubs, or fake data in production code.** Mocks are for test files only.
- **No placeholder implementations.** Every feature must work end-to-end with real data sources before it is marked `done`.
- **"MVP" = scope, not quality.** Phase 1 defines _which features_ ship first. It does NOT mean those features can be half-built, hardcoded, or faked.
- **If it's not real, it doesn't ship.** A tool that returns hardcoded JSON is not a tool. A service that skips error handling is not a service.

## Architecture

All agent code lives **inside the Ghostfolio fork** as new NestJS modules (API) and Angular components (client). See `docs/IMPLEMENTATION_STRATEGY.md` for full details on Approach A.

## Build Workflow

1. Select the next story by ID (`todo` -> `in-progress`).
2. Implement exactly the story scope — all code changes go in this repo.
3. Run tests defined in the story (`npx nx test api --testPathPatterns=...`).
4. Deploy to production (single Ghostfolio Railway service).
5. Execute and report the story's "How To Verify In Prod" checks.
6. Mark story `done` with commit/PR reference.

## Story Index

### Phase 0: Infrastructure

| ID     | Title                         | Status | Priority | Depends On |
| ------ | ----------------------------- | ------ | -------- | ---------- |
| US-001 | Railway deploy and fork setup | `done` | P0       | —          |

### Phase 1: MVP (all required for MVP gate)

| ID     | Title                                                         | Status | Priority | Depends On             |
| ------ | ------------------------------------------------------------- | ------ | -------- | ---------------------- |
| US-002 | Deploy Ghostfolio on Railway with seeded portfolio            | `done` | P0       | US-001                 |
| US-003 | Agent NestJS module + market data tool + Angular chat UI      | `done` | P0       | US-001                 |
| US-004 | Portfolio risk analysis tool (Ghostfolio service integration) | `done` | P0       | US-002, US-003         |
| US-005 | ESG compliance checker with domain verification               | `done` | P0       | US-002, US-003         |
| US-006 | Conversation memory and error handling                        | `in-review` | P0   | US-003, US-004, US-005 |
| US-007 | MVP eval suite and production gate                            | `todo` | P0       | US-006                 |

### Phase 2: MVP + Core Completion (required to reach 100%)

| ID     | Title                                                              | Status | Priority | Depends On                     |
| ------ | ------------------------------------------------------------------ | ------ | -------- | ------------------------------ |
| US-008 | LLM orchestration migration (LangGraph + Claude tool-calling)      | `done` | P0       | US-006                         |
| US-009 | Verification systems expansion (3+ checks)                         | `todo` | P0       | US-008                         |
| US-010 | Observability depth (latency/token/tool metrics + feedback loop)   | `todo` | P0       | US-008                         |
| US-011 | Release-green build and CI gate                                    | `todo` | P0       | US-008, US-009, US-010         |
| US-012 | Agent UI contract alignment (tool payloads, rendering, UX states)  | `todo` | P1       | US-008, US-009                 |
| US-013 | MVP evidence closure + core sign-off                               | `todo` | P0       | US-007, US-011, US-012, US-014 |
| US-014 | 50-case eval dataset + adversarial/multi-step coverage             | `todo` | P0       | US-009, US-010                 |

### Execution Order

1. US-002 ✅ + US-003 in parallel
2. US-004 + US-005 in parallel (after both US-002 and US-003 complete)
3. US-006 sequentially
4. US-007 sequentially (formal MVP gate)
5. Start Phase 2
6. US-008 sequentially (architecture gap closure)
7. US-009 + US-010 in parallel (verification + observability)
8. US-012 after US-009 (UI contract alignment)
9. US-011 sequentially (build/CI hard gate)
10. US-014 sequentially (final eval depth gate)
11. US-013 sequentially (final evidence + sign-off)

## Tech Stack (Approach A — In-Fork)

| Layer           | Technology                                |
| --------------- | ----------------------------------------- |
| Agent Framework | `@langchain/langgraph` (JS/TS)            |
| LLM             | Claude Sonnet via `@langchain/anthropic`  |
| Backend         | NestJS (new `agent` module in Ghostfolio) |
| Frontend        | Angular (new chat page in Ghostfolio)     |
| Market Data     | `yahoo-finance2` npm                      |
| Testing         | Jest via Nx                               |
| Deployment      | Railway (single Ghostfolio service)       |

## Files

- `TEMPLATE.md`: canonical template for every story.
- `HOW_TO_CREATE_USER_STORIES.md`: authoring guide and checklist.
- `CHECKPOINT-LOG.md`: phase progress and deployment history.
- `US-*.md`: individual stories executed step-by-step.
