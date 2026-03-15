# ProvidenceX Product Roadmap PRD

## Product Name
ProvidenceX

## Product Vision
ProvidenceX is a mentor-led trading automation platform where trusted signal providers publish trade ideas, followers can subscribe and automate execution with fine-grained controls, and the platform provides transparency, analytics, safety, and monetization for both mentors and users.

## Product Mission
Replace unreliable Telegram and WhatsApp signal chaos with a structured platform that enables:
- mentor discovery
- verified performance
- controlled auto-trading
- update propagation
- safer execution
- recurring revenue for mentors and the platform
- referral-driven growth

---

## 1. Problem Statement

Retail traders often rely on free or paid signal groups on Telegram and similar channels. These channels have major problems:

- users miss signals
- users enter late
- users misread entries, stop loss, and take profits
- users fail to follow later updates like breakeven or SL movement
- there is little verified performance transparency
- it is hard to know which mentor is actually profitable
- there is poor risk control for followers
- signal providers have weak monetization and limited tooling

ProvidenceX solves this by giving mentors a platform to publish structured signals and giving followers the ability to subscribe, verify mentor performance, and automate execution safely.

---

## 2. Product Goals

### Primary Goals
- Build a trusted marketplace for trading mentors
- Enable verified auto-copy trading with user control
- Monetize through subscriptions and platform fees
- Enable user and mentor referral growth
- Create retention through analytics, automation, and transparency

### Secondary Goals
- Support future ingestion from Telegram, Discord, and webhooks
- Expand to more brokers over time
- Build a mentor operating system, not just a signal board

---

## 3. User Personas

### Mentor / Instructor / Signal Provider
A trader who wants to:
- publish trade ideas
- build a follower base
- monetize subscriptions
- show verified performance
- automate update propagation
- run a trading business from one dashboard

### Follower / Subscriber
A user who wants to:
- find credible mentors
- inspect verified performance
- manually follow or auto-copy signals
- choose risk and TP preferences
- avoid missing signals
- receive updates automatically
- control risk carefully

### Admin / Platform Operator
A platform operator who wants to:
- manage mentors
- monitor trust and fraud
- handle billing and referrals
- review disputes
- control featured and verified mentors
- ensure system reliability

---

## 4. Current Product Baseline

### Already Implemented in the Repo
- mentor profiles (capability model, admin approval)
- mentor signals (symbol, direction, entry, SL, TP1-TP4, idempotency)
- signal updates (move SL, breakeven, partial close, close all, cancel)
- follower subscriptions (per-account, risk mode, TP levels, symbol filter)
- copied trades (one per TP level, full audit trail)
- mentor dashboard (signal compose, signal management, update actions)
- copy-trading orchestrator (parallel fanout to all subscribers)
- update propagator (SL moves, breakeven, close → open copied trades)
- follower pages (browse mentors, subscribe, copy trading dashboard)
- mentor performance analytics (win rate, PnL, profit factor)
- user trading settings (risk mode, sessions, trading pairs)
- hybrid broker support (MT5 + Deriv)
- multi-account MT5 (parallel execution via worker pool)
- ICT strategy engine (internal/system strategy)
- onboarding wizard (connect account → select strategy → live)
- Railway deployment (all services live)

### Current Stage
Working copy-trading MVP with mentor analytics

### Missing for Commercial Scale
- verified analytics depth (charts, monthly breakdown, symbol stats)
- public mentor marketplace maturity (filters, leaderboard, badges)
- paid subscriptions (Stripe, plans, access gating)
- referral system (codes, attribution, commissions)
- notifications (in-app, email, Telegram bot)
- stronger safety controls (daily loss limits per mentor, slippage tolerance)
- admin moderation (approve/reject/suspend mentors, disputes)
- Telegram and Discord signal ingestion
- shadow and simulation mode

---

## 5. Product Roadmap Phases

### Phase 1 — Trust and Discovery Foundation
**Objective:**
Make the platform trustworthy and discoverable.

**Features:**
- verified mentor analytics with charts
- public mentor profile pages
- marketplace discovery filters (by symbol, risk, return, followers)
- mentor risk labels (low/medium/high based on drawdown)
- performance charts (equity curve, monthly returns)
- symbol breakdown (win rate per pair)
- monthly performance table
- recent signal outcome feed

**Success Criteria:**
- users can discover mentors
- users can evaluate mentors before subscribing
- performance metrics are platform-computed and trusted

---

### Phase 2 — Monetization Foundation
**Objective:**
Turn the copy-trading product into a revenue-generating platform.

**Features:**
- platform subscription tiers (free, pro, premium)
- mentor paid plans (mentors set their own price)
- Stripe checkout integration
- billing webhooks
- subscription enforcement (access gating)
- mentor earnings dashboard
- platform fee and revenue split
- payout tracking

**Success Criteria:**
- users can pay for platform features
- mentors can charge for subscriptions
- platform can collect revenue automatically

---

### Phase 3 — Referral and Growth Engine
**Objective:**
Create viral and incentivized growth loops.

**Features:**
- user referral code and link
- mentor affiliate referrals
- referral attribution at signup
- commission ledger
- referral dashboard
- payout status
- anti-abuse controls

**Success Criteria:**
- users can refer others and earn
- mentors can acquire followers through referral
- platform tracks referral ROI clearly

---

### Phase 4 — Safety and Retention
**Objective:**
Increase user trust and reduce follower losses from poor execution control.

**Features:**
- max daily loss per mentor subscription
- max concurrent trades per subscription
- allowed and blocked symbols per subscription
- session filters per subscription
- slippage tolerance (reject if price moved too far)
- late-entry tolerance (reject if signal is old)
- auto-disable on drawdown threshold
- breakeven sync toggle
- close-all sync toggle
- copied trade lifecycle timeline
- richer audit trail

**Success Criteria:**
- followers can tailor automation safely
- platform becomes trusted for real-money use
- users stay longer because they feel in control

---

### Phase 5 — Notifications and Engagement
**Objective:**
Keep users informed and engaged in real time.

**Features:**
- in-app notification system
- signal published notification
- copied trade opened notification
- TP hit notification
- SL moved notification
- close-all executed notification
- subscription paused notification
- account disconnected notification
- payment success/failure notification

**Future Channels:**
- email notifications
- Telegram bot notifications
- push notifications (mobile)

**Success Criteria:**
- users stop missing critical events
- mentor and follower engagement increases
- support burden drops

---

### Phase 6 — Marketplace Maturity
**Objective:**
Make ProvidenceX the place to discover quality mentors.

**Features:**
- mentor leaderboard (ranked by return, win rate, followers)
- advanced filters (drawdown, return, followers, symbols, risk tier)
- badges (verified, top performer, consistent, new)
- featured mentors (admin-curated)
- reviews and ratings foundation
- shareable public profile pages (SEO-friendly)
- category pages (forex, gold, indices, crypto, swing, scalper, low risk)

**Success Criteria:**
- mentors can grow audiences organically
- followers can compare mentors quickly
- marketplace pages become acquisition channels

---

### Phase 7 — External Signal Ingestion
**Objective:**
Capture the original Telegram and Discord signal problem directly.

**Features:**
- Telegram signal ingestion (bot reads channel messages)
- Discord webhook ingestion
- signal parser (extract symbol, direction, entry, SL, TP from text)
- review queue (mentor approves parsed signals before publishing)
- structured signal conversion into the existing mentor_signals table

**Success Criteria:**
- mentors can bridge off-platform channels
- signals become structured and automatable
- users no longer miss updates from noisy chat groups

---

### Phase 8 — Simulation and Optimization
**Objective:**
Improve onboarding and reduce user fear before live auto-trading.

**Features:**
- shadow mode (simulate copied trades without real execution)
- simulated P&L tracking
- side-by-side live vs simulated reporting
- mentor strategy trial mode (free trial period)
- follower backtest-like experience on signal history

**Success Criteria:**
- users can test before risking money
- conversion into paid and live plans increases
- churn drops

---

### Phase 9 — Admin and Platform Control
**Objective:**
Support safe scale.

**Features:**
- mentor approval and rejection workflow
- mentor suspension and moderation
- dispute tools
- trust and fraud monitoring
- referral abuse review
- payout approvals
- audit tooling

**Success Criteria:**
- platform remains clean and trustworthy
- abusive actors can be managed
- operations can scale

---

### Phase 10 — Long-Term Moat
**Objective:**
Become a full mentor operating system.

**Features:**
- AI risk assistant
- mentor business dashboard
- churn and follower analytics
- earnings forecasting
- cohort analytics
- multi-broker expansion
- advanced mentor recommendations
- mentor segmentation and private tiers

**Success Criteria:**
- ProvidenceX becomes the operating system for trading mentors
- not easily replaceable by Telegram groups or basic copy-trading tools

---

## 6. Core Product Principles
- verified data over self-reported claims
- follower safety before blind automation
- modular architecture over feature sprawl
- mentor empowerment with platform control
- trust, monetization, and retention before vanity features
- reuse the current copy-trading engine rather than replacing it

---

## 7. Key Systems Required

### Trading Domain
- mentor signals
- signal updates
- copied trades
- follower controls
- broker execution

### Trust Domain
- analytics service
- risk labelling
- historical performance aggregation
- public mentor profiles

### Revenue Domain
- billing
- subscriptions
- plans
- earnings
- payouts

### Growth Domain
- referrals
- discovery
- leaderboards
- badges
- notifications

### Operations Domain
- moderation
- admin controls
- disputes
- audit trail

---

## 8. Monetization Model

### Platform Revenue Sources
- platform subscription plans (free/pro/premium)
- mentor subscription fee split (platform takes X%)
- premium automation controls
- future analytics premium upsells

### Mentor Revenue
- monthly paid subscription plans (mentor sets price)
- tiered access in future
- featured marketplace placement in future

### Referral Revenue Mechanics
- recurring commissions on referred paid users
- mentor affiliate commissions
- optional capped recurring structure

---

## 9. KPIs

### Trust KPIs
- mentor profile views to subscription conversion
- analytics page engagement
- percentage of mentors with verified stats displayed
- reduction in support disputes

### Monetization KPIs
- monthly recurring revenue (MRR)
- average revenue per paying user (ARPU)
- mentor subscription revenue
- platform take rate
- referral-driven revenue

### Retention KPIs
- follower retention by 30, 60, and 90 days
- active auto-trading users
- average subscriptions per follower
- churn by mentor type

### Growth KPIs
- referral signups
- public mentor page traffic
- organic mentor discovery traffic
- mentor share-link conversion

---

## 10. Recommended Build Order
1. Phase 1 — verified analytics and public mentor discovery
2. Phase 2 — billing and paid subscriptions
3. Phase 3 — referral program
4. Phase 4 — safety controls
5. Phase 5 — notifications
6. Phase 6 — marketplace maturity
7. Phase 7 — external signal ingestion
8. Phase 8 — shadow mode
9. Phase 9 — admin control
10. Phase 10 — AI and long-term moat

---

## 11. Engineering Guidance
- do not rebuild the current copy-trading engine
- extend the existing architecture
- keep mentor marketplace, billing, referrals, notifications, and admin as separate modules
- prefer auditable service-layer logic over frontend-only calculations
- build v1 simply, then optimize with caching and background jobs later
- avoid shipping all phases at once
- each phase should be deployable independently
- maintain backward compatibility with existing routes and data

---

## 12. Implementation Status Tracker

| Phase | Status | Key Files |
|-------|--------|-----------|
| **Pre-Phase: Copy Trading MVP** | DONE | copytrading/*, routes/mentorSignals.ts, routes/copyTrading.ts |
| **Pre-Phase: Broker Adapters** | DONE | brokers/MT5BrokerAdapter.ts, DerivBrokerAdapter.ts |
| **Pre-Phase: Multi-Account MT5** | DONE | worker_pool.py, account_manager.py |
| **Pre-Phase: Trading Pair Selection** | DONE | TradingSettings.tsx, user_config.symbols |
| **Pre-Phase: Mentor Analytics** | DONE | CopyTradingRepository.getMentorPerformance() |
| **Phase 1: Trust & Discovery** | NOT STARTED | — |
| **Phase 2: Monetization** | NOT STARTED | — |
| **Phase 3: Referrals** | NOT STARTED | — |
| **Phase 4: Safety Controls** | PARTIAL | user_config has sessions/symbols/max_losses |
| **Phase 5: Notifications** | NOT STARTED | — |
| **Phase 6: Marketplace** | NOT STARTED | — |
| **Phase 7: Signal Ingestion** | NOT STARTED | — |
| **Phase 8: Simulation** | NOT STARTED | — |
| **Phase 9: Admin Control** | PARTIAL | mentor approval flag exists |
| **Phase 10: Long-Term** | NOT STARTED | — |
