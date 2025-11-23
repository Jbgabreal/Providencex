# ProvidenceX — Build Log

## 2024-11-19

### [global]
- Created monorepo structure with pnpm workspaces
- Set up shared packages: `shared-types`, `shared-utils`, `shared-config`
- Created root configuration files: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Moved architecture document to `docs/ProvidenceX_Full_System_Architecture_and_Master_Prompt.md`
- Created `.env.example` template

### [news-guardrail]
- Implemented full News Guardrail microservice
- Created database schema for `daily_news_windows` table
- Implemented ScreenshotOne integration for ForexFactory calendar capture
- Implemented OpenAI Vision API integration for news event extraction
- Created daily cron job (08:00 NY time, Mon-Fri) for automated news scanning
- Implemented endpoints:
  - `GET /news-map/today` - Returns today's news map
  - `GET /can-i-trade-now` - Checks if trading is currently safe
  - `POST /admin/trigger-scan` - Manual scan trigger (dev/testing)
  - `GET /health` - Health check
- Created News Guardrail PRD document: `docs/ProvidenceX_News_Guardrail_Master_Prompt_and_PRD.md`

### [trading-engine]
- Created Trading Engine service skeleton
- Implemented service stubs:
  - `MarketDataService` - Market data feed (stubbed)
  - `StrategyService` - SMC/Order Block strategy logic (stubbed)
  - `RiskService` - Risk calculation and limits (stubbed)
  - `GuardrailService` - Integration with news-guardrail service
  - `ExecutionService` - Trade execution via MT5 Connector
- Created endpoints:
  - `GET /health` - Health check
  - `POST /simulate-signal` - Test endpoint for signal simulation
- Configured for symbols: XAUUSD, EURUSD, GBPUSD, US30

### [mt5-connector]
- Created MT5 Connector service skeleton
- Implemented `MT5Service` with stubbed MT5 integration (TODOs for real implementation)
- Created endpoints:
  - `POST /api/v1/trades/open` - Open trade
  - `POST /api/v1/trades/close` - Close trade
  - `GET /health` - Health check
- Added validation for trade requests

### [portfolio-engine]
- Scaffolded Portfolio Engine service
- Created basic Express server with health endpoint
- TODO: Implement product management and user positions

### [farming-engine]
- Scaffolded Farming Engine service
- Created basic Express server with health endpoint
- TODO: Implement farming cycle management

### [api-gateway]
- Scaffolded API Gateway service
- Implemented basic proxy routes to news-guardrail
- Created basic Express server with health endpoint
- TODO: Add authentication middleware and full routing

---

## 2025-11-19 / 2025-11-20

### [global]
- Fixed database connection issues (Switched to Supabase Connection Pooler for IPv4 compatibility)
- Added workspace package dependencies to root package.json for test scripts
- Created database connection test script (`scripts/test-db-connection.ts`)
- Fixed ScreenshotOne API parameters (delay limit, removed unsupported parameters)

### [news-guardrail]
- **Enhanced OpenAI prompt** for improved event analysis:
  - Expanded prompt to include macro analyst perspective
  - Added guidance for evaluating low-impact events that may be critical
  - Improved risk classification criteria
  - Added detailed description requirement for each event
- **Updated NewsWindow type** (`packages/shared-types`):
  - Added `is_critical: boolean` field
  - Added `risk_score: number` (0-100)
  - Added `reason: string` field
  - Added `detailed_description: string` field
  - Updated `currency` to strict union type: `'USD' | 'EUR' | 'GBP'`
  - Updated `impact` to include `'low'` option: `'high' | 'medium' | 'low'`
  - Made `event_name` required (removed optional `?`)
- **Updated OpenAI service** (`openaiService.ts`):
  - Replaced fixed 30-minute avoid windows with model-based `avoid_before_minutes` and `avoid_after_minutes`
  - Updated JSON parsing to include all new fields
  - Enhanced logging to show critical events and risk scores
- **Updated trading check service**:
  - Enhanced logging to include risk_score and reason when blocking trades
  - Added critical event warnings in logs
- **Updated news scan service**:
  - Added scan summary logging with critical event count and average risk score
- **Fixed screenshot URL** to explicitly use `?day=today` parameter
- **Note**: Database schema uses JSONB for `avoid_windows`, so new fields are automatically stored without schema migration

### [shared-types]
- Rebuilt package with updated NewsWindow interface

### [trading-engine] - v1 Full Implementation
- **Implemented Trading Engine v1** according to PRD (`docs/ProvidenceX_Trading_Engine_v1_PRD.md`)
- **Created complete module structure**:
  - `server.ts` - Main server with tick loop and decision flow orchestration
  - `config/` - Typed configuration loader for all env variables
  - `types/` - TypeScript interfaces (TradeSignal, GuardrailDecision, RiskContext, etc.)
  - `routes/health.ts` - Health check endpoint
  - `routes/simulateSignal.ts` - Debug endpoint for simulating trade decisions
  - `utils/DecisionLogger.ts` - Trade decision logging service
- **Implemented all services**:
  - `MarketDataService` - Mock candle data for v1 (easy to replace with real feed)
  - `StrategyService` - SMC v1 logic (HTF trend, LTF structure, Order Blocks, liquidity sweeps)
  - `GuardrailService` - Calls News Guardrail with strategy parameter, maps to GuardrailDecision
  - `RiskService` - Two profiles (low/high), position sizing, daily limits, guardrail-aware adjustments
  - `ExecutionService` - Sends TradeRequest to MT5 Connector
- **Tick loop** implemented:
  - Runs every `TICK_INTERVAL_SECONDS` (default: 60 seconds)
  - Processes all configured symbols on each tick
  - Complete decision flow: Signal → Guardrail → Risk → Execution → Log
  - In-memory daily stats tracking (resets daily)
- **Integration**:
  - News Guardrail: `GET /can-i-trade-now?strategy={low|high}`
  - MT5 Connector: `POST /api/v1/trades/open`
  - Decision logging: Postgres table or console (auto-creates schema)
- **Fail-safe rules** implemented (from PRD section 9):
  - Blocks if guardrail `can_trade = false` or `mode = blocked`
  - Blocks if active window `risk_score ≥ 80`
  - Blocks if daily loss cap reached
  - Blocks if max trades per day reached
  - Skips if spread too wide, HTF sideways, or OB mitigated
- **Configuration**:
  - All env variables from PRD implemented
  - `.env.example` created with all options
  - `README.md` with complete setup guide
  - `LOG.md` documenting implementation
- **Testing**:
  - Health endpoint: `GET /health`
  - Simulate endpoint: `POST /simulate-signal` (can test full flow)
  - Service starts and tick loop runs successfully
  - Guardrail integration tested
  - Full decision flow tested via simulate-signal

### [mt5-connector] - v1 Full Implementation
- **Implemented MT5 Connector v1** according to PRD (`docs/MT5_Connector_v1_PRD.md`)
- **Created Python FastAPI service**:
  - `src/main.py` - FastAPI app with endpoints (`/api/v1/trades/open`, `/api/v1/trades/close`, `/health`)
  - `src/mt5_client.py` - MT5 connection management and trade execution logic
  - `src/models.py` - Pydantic models for request/response validation (supports both PRD format and Trading Engine format)
  - `src/config.py` - Environment variable loader (loads from root `.env`)
  - `src/utils.py` - Structured logging utilities
- **Features implemented**:
  - MT5 connection with automatic initialization on first trade
  - Symbol validation before trade execution
  - Market order execution with stop loss and take profit
  - Position closing by ticket ID
  - Comprehensive error handling with MT5 error codes
  - Health check endpoint with MT5 connection status
  - Backward compatibility with Trading Engine request format
- **Dependencies**:
  - FastAPI for REST API
  - MetaTrader5 Python library for MT5 integration
  - Pydantic for request/response validation
  - python-dotenv for environment variable loading
- **Configuration**:
  - Loads credentials from root `.env` file
  - Environment variables: `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER`, `MT5_PATH`, `FASTAPI_PORT`
  - `.env.example` created with all required variables
- **Documentation**:
  - `README.md` with complete setup instructions
  - Usage examples for all endpoints
  - Troubleshooting guide
  - Integration guide for Trading Engine
- **Integration**:
  - Compatible with Trading Engine `ExecutionService`
  - Supports both PRD request format and Trading Engine format
  - Maps field names automatically (e.g., `stop_loss_price` -> `stop_loss`)

### [news-guardrail] - Architecture Improvements
- **Enhanced `/can-i-trade-now` endpoint**:
  - Added metadata (total_windows, critical_windows, checked_at) to response
  - Improved transparency about how many windows were checked
- **Database schema cleanup**:
  - Added automatic cleanup of unused columns (is_critical, risk_score, reason, detailed_description) if they exist
  - These columns were manually added but aren't used - all data stored in JSONB
  - Added GIN indexes on JSONB `avoid_windows` for better query performance
- **Created comprehensive documentation**:
  - `docs/NEWS_GUARDRAIL_ARCHITECTURE.md` - Full system architecture
  - `docs/HOW_TRADING_BLOCKING_WORKS.md` - Deep dive on trading blocking logic
  - Explains how system determines when NOT to trade (time window checking)
  - Documents correct schema design (JSONB for flexible data)
  - Clarifies why same row updates on each scan (correct behavior - one row per day)
- **Performance optimization**:
  - Added GIN indexes for efficient JSONB queries
  - Created migration script for index creation

