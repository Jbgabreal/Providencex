# ProvidenceX — Full System Architecture & Master Prompt for Cursor

> **Project:** ProvidenceX  
> **Mission:** God-aligned, risk‑first wealth automation platform (trading + farming + portfolios)  
> **Audience:** Cursor AI (Coder), acting as Senior Architect + Multi-service Backend Engineer

This document is the **master blueprint** for the ProvidenceX backend ecosystem.  
You (Cursor) must treat this file as the **source of truth for architecture and structure**.

Lower-level, detailed PRDs for individual microservices (like the News Guardrail) will live in separate `docs/*.md` files but **must remain consistent with this master document**.

---

## 1. Global Operating Rules for Cursor

### 1.1 Your Role & Mindset

You are acting as:

- **Senior Backend Engineer**
- **Solution Architect**
- **DevOps‑aware Implementer**

You must:

- Design **modular**, **clean**, and **testable** code.
- Prefer **clarity + maintainability** over clever one‑liners.
- Think in **microservices**, with **clear contracts** between them.
- Keep everything ready for **Dockerization** and **cloud deployment** (Render / Railway / Fly.io / etc.).

### 1.2 Core Tech Stack (System‑wide)

Unless otherwise specified, use:

- **Runtime:** Node.js (LTS)
- **Language:** TypeScript
- **Backend Framework:** Express or Fastify (pick one and use it consistently per service)
- **Database:** Postgres (Supabase compatible) as main transactional store
- **Messaging (future):** Redis / BullMQ or similar (for queues/events)
- **HTTP Client:** `axios`
- **Date/Time:** `luxon` or `dayjs` with timezone support
- **Env Management:** `dotenv`
- **OpenAI SDK:** Official Node SDK
- **Screenshot API:** ScreenshotOne
- **Package Manager:** `pnpm` (preferred) or `npm` with workspaces
- **Monorepo Tooling (optional later):** Turborepo or Nx

### 1.3 Project Layout — Monorepo

You must organize ProvidenceX as a monorepo:

```text
providencex/
  ├─ services/
  │   ├─ news-guardrail/
  │   ├─ trading-engine/
  │   ├─ mt5-connector/
  │   ├─ portfolio-engine/
  │   ├─ farming-engine/
  │   └─ api-gateway/
  ├─ packages/
  │   ├─ shared-types/
  │   ├─ shared-utils/
  │   └─ shared-config/
  ├─ docs/
  │   ├─ ProvidenceX_Full_System_Architecture_and_Master_Prompt.md
  │   └─ ProvidenceX_News_Guardrail_Master_Prompt_and_PRD.md   (existing micro‑PRD)
  ├─ LOG.md               # root system‑wide log
  ├─ package.json         # monorepo/workspace config
  ├─ pnpm-workspace.yaml  # if using pnpm
  ├─ tsconfig.base.json
  └─ README.md
```

> **You are building this repo structure.**  
> Start by scaffolding the monorepo, then create skeletons for each service.

### 1.4 How You Must Use PRDs

- This file = **global master doc**.
- Each microservice may have its own detailed PRD in `docs/` (e.g. News Guardrail already has one).
- Before any major change that affects:
  - architecture,
  - service boundaries,
  - database schemas,
  - environment variables,
  - HTTP endpoints,
  
  you must:
  
  1. Re-scan this master file.  
  2. Confirm consistency.  
  3. If requirements evolve, update or add notes to the relevant `docs/*.md` **and** reflect that in comments or TODOs.

### 1.5 Logging Progress — Root `LOG.md` + Service Logs

You must maintain at least:

- A root `LOG.md` at monorepo root.
- Optional: per‑service logs (e.g. `services/trading-engine/LOG.md`).

**Root `LOG.md` format:**

```markdown
# ProvidenceX — Build Log

## YYYY-MM-DD
- [global] Short description of major architectural decisions or repo‑wide changes.
- [news-guardrail] What was added/changed.
- [trading-engine] What was added/changed.
- [mt5-connector] What was added/changed.
```

Update this whenever you complete a major step (new service, major feature, structural refactor).

---

## 2. ProvidenceX — System Overview

### 2.1 Business Vision (High Level)

ProvidenceX is a **God-aligned, risk‑first wealth automation platform** that:

- Helps users **grow money intelligently and transparently**.
- Provides products like:
  - Algo trading plans (starting with forex + gold + indices)
  - Farming investment cycles (3/6/12 months)
  - Diversified portfolios (high/medium/low risk buckets)
- Protects users from scams, greed and emotional trading via:
  - Automated risk guardrails
  - News filters
  - Strict risk & exposure rules
  - Transparent performance logs

### 2.2 Core Domains

- **Market Guardrails** — news risk, volatility filters.
- **Trading Engine** — algorithmic execution (SMC, order blocks, risk engine).
- **Broker Connectivity** — MT4/MT5 account integration/bridging.
- **Portfolio & Products** — user plans, allocations, and performance.
- **Farming/Yield** — real‑world agricultural investment cycles.
- **User & Access** — auth, roles, accounts, and API Gateway.

### 2.3 Microservices Overview

We will have these backend services:

1. `news-guardrail` — Daily news scanner using ScreenshotOne + OpenAI Vision; exposes `can-i-trade-now` and `news-map` endpoints.
2. `trading-engine` — Implements SMC + order block strategies, risk engine, and trade decision logic.
3. `mt5-connector` — Handles communication with MT5/MT4 (via MetaAPI or bridge) and executes trades.
4. `portfolio-engine` — Manages user products, risk tiers, allocations, and portfolio performance.
5. `farming-engine` — Manages farming investment cycles, yield calculation, and distribution schedules.
6. `api-gateway` — Exposes public/private APIs to frontend and external systems; routes calls to internal services.

> In Phase 1, we focus on **(1) news-guardrail**, **(2) trading-engine**, and **(3) mt5-connector**.  
> Portfolio & farming can be scaffolded but implemented later.

---

## 3. Shared Foundation (Packages)

Create shared packages under `packages/`:

### 3.1 `packages/shared-types`

Contains TypeScript interfaces/types used across services, for example:

- `NewsWindow`, `DailyNewsMap`
- `TradeRequest`, `TradeStatus`
- `StrategyId`, `RiskSettings`
- `UserId`, `ProductId`, `PortfolioPosition` (future)

### 3.2 `packages/shared-utils`

Utility functions:
- Date/time helpers (wrapping `luxon`/`dayjs`)
- Logger setup
- Error classes
- Validation helpers (e.g. Zod schemas for shared objects)

### 3.3 `packages/shared-config`

Centralized config loader:
- Reads env
- Provides typed config for each service
- E.g. `getNewsGuardrailConfig()`, `getTradingEngineConfig()`

---

## 4. Microservice PRDs (High Level)

Below are **high-level PRDs** for each service. Detailed PRDs (like the one already written for News Guardrail) live in `docs/` and should drill down further.

### 4.1 Service 1 — News Guardrail (`services/news-guardrail`)

> **Detailed PRD:** `docs/ProvidenceX_News_Guardrail_Master_Prompt_and_PRD.md` (already created).

#### 4.1.1 Purpose (Summary)

- Once per trading day (e.g. 08:00 America/New_York):
  - Capture ForexFactory calendar screenshot using ScreenshotOne.
  - Use OpenAI Vision to detect high/medium impact news for USD/EUR/GBP.
  - Build `avoid_windows[]` timeframe list (New York time).
  - Store a `DailyNewsMap` row in Postgres (`daily_news_windows` table).

- All day:
  - Answer: **“Can I trade right now?”** via `GET /can-i-trade-now`.

#### 4.1.2 Key Endpoints

- `GET /news-map/today` → returns full `DailyNewsMap` JSON.
- `GET /can-i-trade-now` → returns `{ can_trade, inside_avoid_window, active_window }`.

The details of fields, table schema, cron logic, and OpenAI prompt are already defined in the news-guardrail PRD doc.

Cursor must **link this service to the shared types** (e.g. `DailyNewsMap` in `shared-types`).

---

### 4.2 Service 2 — Trading Engine (`services/trading-engine`)

This is the **algorithmic brain** of ProvidenceX.

#### 4.2.1 Purpose

- Implement SMC + Order Block trading strategies for:
  - XAUUSD (main)
  - EURUSD, GBPUSD, US30 (initial set)
- Enforce risk & discipline:
  - Uses News Guardrail (`/can-i-trade-now`) to avoid bad news periods.
  - Limits daily loss, daily trades, risk per trade.
- Produces **trade instructions** for MT5 Connector (does not directly talk to broker).

#### 4.2.2 Responsibilities

- Maintain market state per symbol (HTF + LTF candles, structure, etc.).
- Implement one or more strategies (start with `smc_v1`):
  - Higher timeframe trend detection (H1/H4)
  - BOS/CHoCH identification
  - Order block identification
  - Liquidity sweep detection
- For each symbol and timeframe, periodically check for setups:
  - Algorithm uses incoming candles/price feed.
- Before creating a trade:
  - Calls `news-guardrail` → `GET /can-i-trade-now`.
  - Queries internal risk engine (`RiskService`) for remaining risk budget.
- If conditions are satisfied:
  - Generate normalized `TradeRequest` and send to MT5 Connector via HTTP.

#### 4.2.3 Integration with News Guardrail

- `trading-engine` must **NOT** implement its own news logic.
- Instead, it must call `news-guardrail` periodically or before each potential trade decision.
- If `can_trade = false`, **abort trade**.

#### 4.2.4 Integration with MT5 Connector

- `trading-engine` calls:
  - `POST mt5-connector/api/v1/trades/open`
  - Later: `POST mt5-connector/api/v1/trades/close`
- Each `TradeRequest` must include:
  - `symbol`, `direction`, `entry_type`, `risk_percent` or lot size, `stop_loss_price`, `take_profit_price`, `strategy_id`, metadata.

#### 4.2.5 Internal Modules (Structure)

Suggested internal modules:

- `MarketDataService` — feeds OHLC data into the strategy (stubbed for now, can simulate or read from DB).
- `StrategyService` — SMC/Order Block logic, returns optional trade setup for a symbol.
- `RiskService` — calculates position size, tracks daily drawdown and max trades.
- `GuardrailService` — wraps HTTP calls to `news-guardrail`.
- `ExecutionService` — orchestrates final trade sending to MT5 Connector.
- `Scheduler` — simple intervals/cron to trigger scans per symbol.

For now, keep data & backtest logic simple; real tick integration can come later.

---

### 4.3 Service 3 — MT5 Connector (`services/mt5-connector`)

This is the **bridge** to MT5/MT4 broker accounts.

#### 4.3.1 Purpose

- Receive high-level trade instructions from `trading-engine`.
- Execute trades on MT5 (your live/demo accounts) using either:
  - MetaTrader5 Python library (run as sidecar), or
  - MetaAPI / 3rd-party MT5 gateway, or
  - Local bridge via custom integration.
- Return trade ticket IDs and status back to `trading-engine` (via HTTP response or separate callback pattern).

#### 4.3.2 v1 Scope (Simplified)

- Single MT5 account (your main ProvidenceX account).
- Provide HTTP endpoints:

  - `POST /api/v1/trades/open`
    - Accepts `TradeRequest`.
    - Translates into MT5 order.
    - Responds with `mt5_ticket`, `status`.

  - `POST /api/v1/trades/close`
    - Accepts `mt5_ticket` and optional `reason`.
    - Closes the position.

- Internally, use a chosen connector (MetaAPI, or python bridge). For now, define interface types and stub integration, with clear TODOs.

#### 4.3.3 Data Model (Optional)

Minimal logging table (either in this service’s DB or a shared schema):

- `executed_trades` with fields:
  - `id`, `symbol`, `direction`, `lot_size`, `entry_price`, `sl`, `tp`, `opened_at`, `closed_at`, `pnl`, `ticket`, `strategy_id`, etc.

---

### 4.4 Service 4 — Portfolio Engine (`services/portfolio-engine`)

This comes **after** the trading core is working, but we define it now to shape the system.

#### 4.4.1 Purpose

- Manage investment **products** (plans) and user **positions** in those products.
- Support different risk tiers and product types:
  - Trading strategies (algo plans)
  - Farming cycles
  - Mixed portfolios

#### 4.4.2 Responsibilities

- Store product metadata:
  - Name, type (`TRADING`, `FARMING`, `MIXED`), risk level, lock period, min amount, strategy hooks.
- Manage user allocations:
  - User invests into a product → a `user_position` is created.
  - Later, returns can be calculated from performance of underlying engines (trading/farming).

#### 4.4.3 API (High Level)

- `GET /products`
- `GET /products/:id`
- `GET /users/:userId/portfolio`
- `POST /users/:userId/positions` (create new investment position)

Detailed PRD for Portfolio Engine can be added later in `docs/ProvidenceX_Portfolio_Engine_PRD.md`.

---

### 4.5 Service 5 — Farming Engine (`services/farming-engine`)

This represents your **real-world farm yield products** (3/6/12‑month cycles).

#### 4.5.1 Purpose

- Track farming cycles (start/end dates, capital, expected yield).
- Attach user positions (from portfolio-engine) to cycles.
- Compute and record yields on completion of cycles.

#### 4.5.2 High Level

- `farming_cycles` table: `id`, `product_id`, `start_date`, `end_date`, `yield_rate`, `status`.
- Batch jobs to close cycles and credit yields to portfolios.

This will be detailed later in its own PRD.

---

### 4.6 Service 6 — API Gateway (`services/api-gateway`)

#### 4.6.1 Purpose

- Single entry point for frontend / external clients.
- Simplify auth & routing.
- Optionally aggregate data from multiple services.

#### 4.6.2 Responsibilities

- Handle auth tokens (JWT or Supabase auth integration).
- Route requests to:
  - `news-guardrail` for risk status
  - `portfolio-engine` for portfolio APIs
  - `farming-engine` for farming data
  - `trading-engine` for summary stats (not raw controls in v1)

---

## 5. Environments & Configuration

### 5.1 Global Env Conventions

Use a `.env` at the root for shared patterns, plus per-service `.env` files if needed.

Core envs:

```bash
# Global DB (can be same for all in v1, separated later)
DATABASE_URL=postgres://user:password@host:5432/providencex

# Timezone (core assumption)
PX_TIMEZONE=America/New_York

# OpenAI (used by news-guardrail and possibly others later)
OPENAI_API_KEY=...

# ScreenshotOne (news-guardrail)
SCREENSHOTONE_ACCESS_KEY=...

# Per-service ports (for local dev)
NEWS_GUARDRAIL_PORT=3010
TRADING_ENGINE_PORT=3020
MT5_CONNECTOR_PORT=3030
PORTFOLIO_ENGINE_PORT=3040
FARMING_ENGINE_PORT=3050
API_GATEWAY_PORT=3000
```

Each service should expose a `PORT` env and read it through `shared-config` or its local config.

### 5.2 Deployment Targets (Future)

You should keep code compatible with:

- Containerized deployment (Dockerfiles per service).
- Simple PaaS like Render / Railway / Fly.io.
- Either:
  - Each microservice as separate app, or
  - Some microservices grouped for v1 (e.g. trading-engine + mt5-connector together).

---

## 6. Initial Implementation Plan (For Cursor)

You must treat this as the **build order**:

### Phase 1 — Scaffolding & News Guardrail

1. Create monorepo structure (`providencex/`).
2. Setup `pnpm` workspaces or npm workspaces.
3. Create `packages/shared-types`, `packages/shared-utils`, `packages/shared-config` with basic boilerplate.
4. Create `services/news-guardrail`:
   - Copy details from `docs/ProvidenceX_News_Guardrail_Master_Prompt_and_PRD.md`.
   - Implement full microservice (cron + ScreenshotOne + OpenAI + DB + endpoints).
5. Ensure `LOG.md` at root is created and the first entries are logged.

### Phase 2 — Trading Engine & MT5 Connector Skeleton

6. Create `services/trading-engine` with:
   - Basic server skeleton.
   - Stubs for `MarketDataService`, `StrategyService`, `RiskService`, `GuardrailService`, `ExecutionService`.
   - Config for target symbols: XAUUSD, EURUSD, GBPUSD, US30.
   - A simple endpoint like `GET /health` and a manual `POST /simulate-signal` for testing risk/guardrail integration.

7. Create `services/mt5-connector` with:
   - HTTP endpoints `POST /api/v1/trades/open` and `POST /api/v1/trades/close` (even if mt5 bridge is stubbed).
   - Types for `TradeRequest` and basic validation.

8. Wire `trading-engine` to call `news-guardrail` and `mt5-connector` (use local URLs in dev).

### Phase 3 — Portfolio/Farming/API Gateway Scaffolds

9. Scaffold `services/portfolio-engine`, `services/farming-engine`, and `services/api-gateway`:
   - Basic Express/Fastify app.
   - `GET /health` endpoint.
   - Hook them into workspace tooling.

10. Add minimal `README.md` at root and per‑service READMEs with:
    - How to run
    - How to configure `.env`
    - How to test basic endpoints

---

## 7. Acceptance Criteria for “Main Structure Ready”

We consider the **“complex project with the complete structure”** ready when:

1. The monorepo structure exists as described, with all service directories and shared packages created.
2. `services/news-guardrail` is fully implemented and working per its dedicated PRD:
   - Cron job runs (can be triggered manually in dev).
   - DB table `daily_news_windows` is created and populates.
   - `GET /news-map/today` and `GET /can-i-trade-now` work.
3. `services/trading-engine` runs, calls `news-guardrail` (even if strategies are stubbed).
4. `services/mt5-connector` runs and accepts basic `TradeRequest` payloads (even if actual MT5 integration is stubbed with TODOs).
5. `services/portfolio-engine`, `services/farming-engine`, and `services/api-gateway` at least start and respond on `/health`.
6. Root `LOG.md` is present and contains structured entries documenting:
   - Monorepo creation
   - News Guardrail implementation
   - Trading Engine & MT5 Connector scaffolding
7. All services can be started together via a root script (e.g. `pnpm dev` or similar), or at least documented commands exist in root `README.md`.

---

## 8. How to Use This File as a Master Prompt in Cursor

When you (the human) start work in Cursor, you should:

1. Add this file to `docs/ProvidenceX_Full_System_Architecture_and_Master_Prompt.md` in the repo.
2. In Cursor’s chat, instruct:

   > “Use `docs/ProvidenceX_Full_System_Architecture_and_Master_Prompt.md` as the master architecture document.  
   > Set up the monorepo and implement Phase 1 (News Guardrail microservice) exactly according to the spec.  
   > Maintain `LOG.md` and keep the structure consistent with the doc.”

3. For subsequent phases, remind Cursor:

   > “Continue following the master architecture doc and start implementing Phase 2 (Trading Engine + MT5 Connector skeletons).”

Cursor must **always treat this file as authority** for structure, naming, and service boundaries.
