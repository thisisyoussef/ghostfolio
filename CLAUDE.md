# CLAUDE.md

Canonical agent instructions for this workspace.
If any instruction in other local instruction files conflicts with this file, this file wins.

## Product philosophy — non-negotiable

This is a **production product**, not a prototype, demo, or proof-of-concept. Every line of code ships to real users on Railway.

**Absolute rules:**

- **No mocks in production code.** Mocks belong exclusively in test files (`*.spec.ts`). Production code must use real services, real APIs, real data.
- **No stub/placeholder implementations.** If a feature isn't ready, don't ship a fake version. Either implement it fully or don't ship it.
- **No hardcoded sample data.** Production tools must fetch from real data sources (Yahoo Finance, Ghostfolio DB, etc.). Static datasets like `esg-violations.json` are reference data, not placeholders.
- **No "MVP behavior" shortcuts.** The word "MVP" in user stories refers to the _scope_ of the first release, not a license to cut quality. Every feature within that scope must be production-grade.
- **No TODO-driven development.** Don't leave `// TODO: implement real version` in code. If it's not implemented, it shouldn't be merged.

When in doubt: _"Would I trust this code to handle a real user's financial data?"_ If no, it's not ready.

## Engineering preferences

- DRY is important; flag repetition aggressively.
- Well-tested code is non-negotiable; prefer more tests over fewer.
- Build code that is engineered enough: avoid both fragile hacks and premature abstraction.
- Err toward handling edge cases thoughtfully.
- Prefer explicit over clever.

## Test-Driven Development (TDD) — mandatory

Every feature and bugfix follows Red → Green → Refactor:

1. **Red**: Write failing tests first. Tests must fail for the right reason before any implementation.
2. **Green**: Write the minimum implementation to make tests pass.
3. **Refactor**: Clean up while keeping tests green.

Rules:

- No implementation code without a failing test that motivates it.
- Each story must include a **TDD Plan** section listing specific failing tests before implementation begins.
- Run the full test suite after each green step. Do not accumulate untested code.
- When fixing bugs, write a regression test that reproduces the bug (red), then fix (green).
- Preparation phase is mandatory: read relevant code and docs _before_ writing tests.

Every story must include:

- **Preparation Phase**: audit local code, check external docs, document expected shapes and planned failing tests.
- **TDD Plan**: explicit list of test files, test cases, and the order they will be written. Must cover all 5 test layers (see below).
- **Local Validation**: lint, test, and build commands that must all pass before deployment.

## Testing taxonomy — 5 layers (mandatory)

Every story's TDD Plan must address all applicable layers. Layers 1-4 run on every commit. Layer 5 runs pre-deploy.

### Layer 1: Unit tests (per tool or service function)

**Minimum 10 tests per tool.** Breakdown:

- **3 happy path**: valid inputs → correct outputs, multiple valid variations.
- **3 edge cases**: empty array, single item, max-length input, special characters (Unicode, emoji), symbols with hyphens/dots (e.g., `BTC-USD`, `BRK.A`).
- **2 error/failure modes**: network timeout (mock `fetch` to reject), malformed API response (missing fields, null body), HTTP 429/500 responses.
- **2 boundary conditions**: empty string `""`, very long string (10K+ chars), `0`, negative numbers, `Number.MAX_SAFE_INTEGER`, `null`/`undefined` where applicable.

### Layer 2: Integration tests (NestJS DI wiring)

**Minimum 5 tests per controller endpoint.** Must cover:

- Full request→controller→service→tool chain with real NestJS DI (service mocked at tool boundary, not at service level).
- HTTP status codes: 200 success, 400 bad request, 422 unprocessable entity, 500 internal error.
- Request/response DTO shape validation (snake_case ↔ camelCase mapping).
- Error propagation: tool throws → controller returns structured error JSON, not stack trace.
- Guard/auth behavior if the endpoint is protected.

### Layer 3: Agent behavioral tests (planned — US-006/US-007)

**Status: Not yet implemented.** Will be added when LLM-based routing replaces keyword matching.

**Minimum 8 tests per story that touches the agent.** Required scenarios:

- **Tool routing accuracy**: "price of AAPL" → invokes `market_data_fetch` (not `portfolio_risk_analysis`).
- **Ambiguous query handling**: vague query like "tell me about AAPL" still routes correctly or asks for clarification.
- **Hallucination guard**: response numbers/data must trace back to actual tool output — assert response contains data from the mock tool result, not fabricated values.
- **Multi-turn context**: second message references first message's data correctly (e.g., "what about MSFT?" after asking about AAPL).
- **Graceful degradation**: when a tool fails mid-conversation, agent explains the error to the user instead of crashing or hallucinating.
- **Session isolation**: two different `session_id` values in parallel do not leak state between each other.
- **Refusal behavior**: out-of-scope requests (e.g., "write me a poem") get a polite decline, not a tool invocation.
- **Non-determinism handling**: use `expect(result).toMatch(/pattern/)` or `expect(result).toContain(substring)`, NEVER exact string equality for LLM outputs.

### Layer 4: Contract tests (API shape stability)

**Minimum 3 tests per endpoint.** Must verify:

- Response body matches the documented TypeScript interface/DTO exactly (no missing or extra fields).
- Snake_case ↔ camelCase mapping is correct in both request and response.
- Error responses follow a consistent shape: `{ error: string, type: string, statusCode: number }`.

### Layer 5: Production eval suite — 5-stage framework

**Stages 1+2 (implemented):** Golden Sets + Labeled Scenarios

Deterministic binary checks against 20 golden test cases in `apps/api/src/app/agent/evals/golden-data.yaml`. No LLM judge — all checks are code-based.

Each case has 3 binary checks:

- `tool_selection`: Did the expected tool(s) appear in `tool_calls`?
- `content_validation`: Do all `must_contain` substrings appear in the response? (case-insensitive)
- `negative_validation`: Do none of the `must_not_contain` substrings appear? (case-insensitive)

**Run commands:**

```bash
# Test the eval runner's own logic (fast, no server needed)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent/evals/eval-runner"

# Run evals against local dev server
EVAL_ACCESS_TOKEN=<token> npx tsx apps/api/src/app/agent/evals/eval-runner.ts

# Run evals against production
EVAL_ACCESS_TOKEN=<token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

**Pass gate:** ≥80% of cases must pass. Exit code 0 on pass, 1 on fail.

**4 rules:**

1. Start small (20 cases, grow organically)
2. Run on every commit (eval-runner.spec.ts) and pre-deploy (standalone runner)
3. Add from production bugs (every bug becomes a golden case)
4. NEVER change expected output to make tests pass — fix the agent

**Stages 3-5 (planned, not yet implemented):**

- Stage 3: Replay Harnesses — record real sessions as JSON fixtures, replay with ML metrics
- Stage 4: Rubrics — multi-dimensional scored eval with LLM judge + calibration
- Stage 5: Experiments — A/B test prompt/model changes with same test set

Design doc: `docs/agentforge/plans/2026-02-24-eval-framework-stage1-stage2-design.md`

### Mandatory edge case categories

Every tool's TDD Plan must include at least one test from EACH of these categories:

1. **Empty/null inputs** — `[]`, `null`, `undefined`, `""`.
2. **Boundary values** — `0`, `1`, `-1`, `Number.MAX_SAFE_INTEGER`, 10,000-character string.
3. **Malformed external data** — API returns wrong shape, missing fields, HTML instead of JSON.
4. **Network failures** — timeout, connection refused, HTTP 429 rate limit, HTTP 500.
5. **Concurrent access** — parallel requests to same session, race conditions on shared state.
6. **Special characters in user input** — Unicode, emoji, `<script>` tags, SQL-like strings (`'; DROP TABLE`).
7. **LLM non-determinism** — pattern matching assertions, never exact string equality for agent responses.

### Test file naming convention

```
*.tool.spec.ts          → Layer 1 unit tests
*.controller.spec.ts    → Layer 2 integration + Layer 4 contract tests
*.behavioral.spec.ts    → Layer 3 agent behavioral tests
evals/eval-runner.ts    → Layer 5 production eval suite (LangSmith, NOT Jest)
```

### Test commands

```bash
# All agent tests (Layers 1-4 via Jest)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="app/agent/"

# Specific layer (Jest)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="tool.spec"        # Unit
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="controller.spec"  # Integration
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="behavioral.spec"  # Behavioral

# Layer 5: Production eval suite (LangSmith — standalone script, NOT Jest)
LANGSMITH_API_KEY=$LANGSMITH_API_KEY \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

## Build verification — mandatory

Unit tests alone do not prove production readiness. After Green phase:

1. **Production build**: Run `npx nx build api --configuration=production` and verify it completes.
2. **Bundle smoke test**: Verify the compiled `dist/apps/api/main.js` can load without errors: `node -e "require('./dist/apps/api/main.js')"` (may fail on missing DB, but must not fail on missing modules).
3. **External dependency check**: Any npm package that uses native bindings, complex internal module structure (cookie managers, fetch wrappers), or dynamic `require()` calls MUST be marked as a webpack external in `apps/api/webpack.config.js`. Examples: `yahoo-finance2`, any package with `.node` binaries.
4. **Generated package.json audit**: After production build, verify `dist/apps/api/package.json` includes all runtime dependencies that were marked as externals.

This catches the class of bugs where tests pass (because they mock externals) but production fails (because webpack mangled the dependency).

## Review protocol (when reviewing/planning before code changes)

- Explain concrete tradeoffs for each issue/recommendation.
- Provide an opinionated recommendation.
- Ask for user input before assuming a direction.

Before starting a review, ask user to choose one mode:

1. BIG CHANGE: interact section-by-section (Architecture -> Code Quality -> Tests -> Performance), max 4 top issues per section.
2. SMALL CHANGE: one question per review section.

For each issue found:

- Include file and line reference.
- Provide 2-3 options (including do nothing where reasonable).
- For each option: implementation effort, risk, impact on other code, maintenance burden.
- Put recommended option first.
- Ask user whether to proceed with recommended option or choose another.

Do not assume user priorities on timeline or scale. After each section, pause for feedback.

## Workspace model (authoritative)

- This repo is the **single source of truth** — a fork of `https://github.com/ghostfolio/ghostfolio.git` with agent code added as new NestJS modules and Angular components.
- Agent code: API at `apps/api/src/app/agent/`, client at `apps/client/src/app/`.
- Language: **TypeScript**. Agent routing: **keyword-based pattern matching** (no LLM framework yet — LangGraph planned for future). Tests: **Jest via Nx**.
- Build by user story from `docs/agentforge/user-stories/`, execute steps in order, and report status by Story ID.
- Planning/eval docs live in `docs/agentforge/`. Feature code/tests live alongside the rest of the Ghostfolio codebase.

## Agent module architecture

### Authentication flow (mandatory for all agent endpoints)

All agent endpoints use JWT authentication. **Never use PrismaService to look up users** — the user identity always comes from the JWT token.

```
JWT token → AuthGuard('jwt') → HasPermissionGuard → @Inject(REQUEST) request.user.id
         → AgentService.chat({ message, sessionId, userId })
         → tool functions receive userId as a parameter
```

Controller pattern:

```typescript
@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Post('chat')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  async chat(@Body() body: ChatRequestDto) {
    return this.agentService.chat({
      message: body.message,
      sessionId: body.session_id,
      userId: this.request.user.id  // Always from JWT, never from DB lookup
    });
  }
}
```

### Routing logic

`AgentService.chat()` uses keyword arrays to route messages:

- `ESG_KEYWORDS` → `handleComplianceQuestion()` → `complianceCheck()` tool
- `PORTFOLIO_KEYWORDS` → `handlePortfolioQuestion()` → `portfolioRiskAnalysis()` tool
- Extracted ticker symbols → `marketDataFetch()` tool
- No match → help message listing capabilities

### Tools (pure functions, no DI)

| Tool                    | File                               | Signature                                   | Data source                                     |
| ----------------------- | ---------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| `marketDataFetch`       | `tools/market-data.tool.ts`        | `(input: { symbols: string[] })`            | Yahoo Finance direct fetch                      |
| `portfolioRiskAnalysis` | `tools/portfolio-analysis.tool.ts` | `(input, portfolioService, userId: string)` | Ghostfolio PortfolioService (NestJS DI)         |
| `complianceCheck`       | `tools/compliance-checker.tool.ts` | `(input: { holdings, filterCategory? })`    | Static ESG dataset (`data/esg-violations.json`) |

### Key files

```
apps/api/src/app/agent/
├── agent.module.ts              # NestJS module (imports PortfolioModule)
├── agent.controller.ts          # JWT-protected POST /api/v1/agent/chat
├── agent.controller.spec.ts     # Integration + contract tests
├── agent.service.ts             # Keyword routing + response formatting
├── data/
│   └── esg-violations.json      # 25 ESG violations across 5 categories
└── tools/
    ├── market-data.tool.ts      # Yahoo Finance price fetch
    ├── market-data.tool.spec.ts
    ├── portfolio-analysis.tool.ts   # HHI, allocation, performance
    ├── portfolio-analysis.tool.spec.ts
    ├── compliance-checker.tool.ts   # ESG cross-reference
    └── compliance-checker.tool.spec.ts
```

## Environment setup

### Prerequisites

- PostgreSQL running locally (or via Docker)
- Redis running locally (or via Docker)

### First-time setup

```bash
cp .env.example .env           # Copy and edit with your local DB credentials
npm install                    # Install deps + generate Prisma client (postinstall hook)
npm run database:push          # Push schema to local DB
npm run database:seed          # Seed initial data
```

### Database commands

```bash
npm run database:migrate       # Run pending migrations (production)
npm run database:push          # Push schema changes (development)
npm run database:seed          # Seed/re-seed data
npm run database:gui           # Open Prisma Studio (visual DB browser)
npm run database:generate-typings  # Regenerate Prisma client after schema changes
```

## Local development commands

```bash
npm run start:server           # Start API dev server (watch mode)
npm run start:client           # Start Angular client (separate terminal)
npm run test:api               # Run API tests (loads .env.example automatically)
npm run test:common            # Run common lib tests
npm test                       # Run ALL tests in parallel
npx nx build api               # Build API
npx nx build client            # Build client
npx nx lint api                # Lint API
npx nx lint client             # Lint client
```

## Gotchas

- Tests require `.env.example` to exist — the test runner loads it via `dotenv-cli`.
- Prisma client must be regenerated after any schema change (`npm run database:generate-typings`).
- API and client must be started in **separate terminals** — there is no single combined dev command.
- **MANUAL data source holdings have UUID symbols** — When holdings are added via Ghostfolio's MANUAL data source (used in production because Yahoo Finance is unreliable on Railway), the `symbol` field is a UUID (e.g., `6dafd93a-323e-432e-a3ea-f2685cde232c`), not a ticker. Use the `name` field for human-readable matching. The compliance checker does name-based matching to handle this.
- **Agent endpoints must use JWT auth** — Never use `PrismaService` to look up users in agent code. Always get `userId` from `request.user.id` via `AuthGuard('jwt')`. See "Agent module architecture" section above.
- **Pre-commit hook ESM error** — The pre-commit hook may fail with `eslint-plugin-storybook` ESM errors unrelated to agent code. Use `--no-verify` if the hook fails on unrelated issues (but fix lint errors in your own code first).

## Delivery requirements (every completed change)

- Always commit and push changes when done.
- Always deploy to production before closing the task.
- Follow `./DEPLOYMENT_SETUP.md`.
- Assume user validates every change in production.
- Always include direct prod checks with browser-first verification: exact page URL(s), what to click/view, expected UI/result, and clear success/failure signals.
- Do not provide `curl` or terminal verification commands unless the user explicitly asks for them.

## Definition of Done (required checklist)

**Canonical checklist**: [`docs/agentforge/DEFINITION_OF_DONE.md`](docs/agentforge/DEFINITION_OF_DONE.md) — use that file as the authoritative completion gate for every story.

Quick summary (see canonical file for full testing requirements):

- [ ] Story scope completed and status updated in `docs/agentforge/user-stories/`.
- [ ] Layer 1 unit tests pass (≥10 per tool; see Testing Taxonomy above).
- [ ] Layer 2 integration tests pass (≥5 per controller endpoint).
- [ ] Layer 3 behavioral tests pass (≥8 per story) — _when implemented (US-006+)_.
- [ ] Layer 4 contract tests pass (≥3 per endpoint).
- [ ] Layer 5 eval suite passes (≥80% golden cases) — _when implemented (US-007)_.
- [ ] All 7 mandatory edge case categories covered.
- [ ] Code committed and pushed to remote.
- [ ] Production deployment completed successfully.
- [ ] Production verification executed with explicit evidence:
  - [ ] URL(s) opened in browser
  - [ ] expected page state/output observed
  - [ ] success/failure outcome recorded
  - [ ] LangSmith eval experiment link recorded — _when Layer 5 implemented (US-007)_
- [ ] Rollback path identified for the change.
- [ ] Handoff includes: Story ID, commit SHA, deployed URL(s), verification result, LangSmith experiment URL.
