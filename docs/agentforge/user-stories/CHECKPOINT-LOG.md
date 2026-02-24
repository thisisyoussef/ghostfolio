# Phase 1 Checkpoint Log

| Story  | Commit      | Ghostfolio URL | Local Validation | TDD Evidence | User Checkpoint | Status | Notes |
| ------ | ----------- | -------------- | ---------------- | ------------ | --------------- | ------ | ----- |
| US-002 | f580871 | `https://ghostfolio-production-e8d1.up.railway.app` | N/A (infra) | N/A (infra) | Passed | `done` | Ghostfolio deployed. 7 holdings seeded (AAPL, MSFT, GOOGL, BND, VWO, BTC-USD, XOM). Yahoo Finance non-functional on Railway — used MANUAL data source. Migrated to faithful-youthfulness Railway project. |
| US-003 | ea112a42f | `https://ghostfolio-production-e8d1.up.railway.app` | 5/5 tests pass | Red→Green confirmed | Passed | `done` | Agent NestJS module + market_data_fetch tool + Angular chat UI. MVP uses pattern matching (LangGraph deferred). Replaced yahoo-finance2 with direct fetch API. Migrated to faithful-youthfulness Railway project. |
| US-004 | 375e6f167 | `https://ghostfolio-production-e8d1.up.railway.app` | 17/17 tests pass | Red→Green confirmed | Passed | `done` | Portfolio risk analysis tool: concentration (HHI), allocation by asset class, performance summary. Routes via keyword matching. PortfolioService injected via NestJS DI. Empty portfolio returns graceful error. |
| US-005 | 375e6f167 | `https://ghostfolio-production-e8d1.up.railway.app` | Included in US-004 test run | Red→Green confirmed | Passed | `done` | ESG compliance checker with static dataset (25 tickers). Compliance score, violations by category, filtering. Deployed alongside US-004. |
| US-006 | Uncommitted | | | | Pending | `todo` | Session memory (in-memory Map) and classified error handling (NestJS exception filter). |
| US-007 | Uncommitted | | | | Pending | `todo` | Consolidated eval suite (≥12 cases), MVP evidence document, production gate. |
