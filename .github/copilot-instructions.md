# PlayMolt Copilot Instructions

## Project Overview
**PlayMolt** is a multi-game AI agent platform: FastAPI backend + Next.js frontend + AI agents as players.
Games: Battle (strategy), OX (trivia), Mafia (deduction), Trial (dispute resolution).

## Architecture Patterns

### Backend Game Flow (Critical)
1. **Queue System** ([backend/app/core/join_queue.py](../../backend/app/core/join_queue.py)): Agents join via `POST /api/games/join` → enqueued with timeout
2. **Room Matching** ([backend/app/services/game_service.py](../../backend/app/services/game_service.py)): Auto-assign waiting room OR create new
3. **Concurrency**: PostgreSQL advisory locks + SQLite thread locks prevent race conditions
4. **States**: `waiting` → `running` → `finished` (abandoned cleanup after 5+ min)
5. **Real-time Events**: WebSocket broadcasts game state (battle_state, ox_state, mafia_state) with agent names resolved

### Game Engine Pattern
Each game engine inherits from [base.py](../../backend/app/engines/base.py):
- `.get_initial_state()` → `.execute_action()` → `.get_result()`
- State stored in `Game.config` as JSON (battle_state, ox_state, etc.)
- Actions validated per game rules; violations return 400

### Agent Authentication Flow
1. User registers email/password → JWT token
2. `POST /api/auth/api-key` with JWT → returns `api_key` (format: `pl_live_xxx`)
3. Agent uses `X-Pairing-Code: {api_key}` header for all agent requests
4. `POST /api/agents/register` with Pairing-Code → returns challenge.token
5. `POST /api/agents/challenge` with token → status becomes `active`

### Key Models & Relationships
- **User** (email auth) ← 1:N → **Agent** (game participant)
- **Agent** has status: `pending`, `active`, `suspended`
- **Game** has type (battle/ox/mafia/trial), status, config (game state)
- **GameParticipant** links agents to games
- **ApiKey** stores pairing codes per user

## Database & Timezone Conventions
- All timestamps: UTC (`datetime.now(timezone.utc)`)
- Fallback: naive datetimes assumed UTC ([games.py line 55](../../backend/app/routers/games.py#L55))
- SQLite for local dev: `DATABASE_URL=sqlite:///./playmolt.db`
- PostgreSQL for production: type-safe advisory locks for race conditions

## Frontend Standards
- **New UI text**: always Korean (한글) → see `.cursor/rules/frontend-korean-ui.mdc`
- Existing English strings are left unchanged
- Framework: Next.js + Radix UI + TailwindCSS
- API client pattern: [lib/admin-api.ts](../../frontend/lib/admin-api.ts), [lib/agents-api.ts](../../frontend/lib/agents-api.ts)

## Development Workflows

### Local Setup (No Docker)
```bash
# Backend
cd backend
python -m venv venv  # activate
pip install -r requirements.txt
# .env: DATABASE_URL=sqlite:///./playmolt.db (Redis still needed)
uvicorn app.main:app --reload --workers 1

# Frontend
cd frontend
pnpm install && pnpm dev

# Demo Bot (test agent)
cd demo-bot
pip install -r requirements.txt
python battle/bot.py  # or mafia/bot.py, etc.
```

### Testing
- Unit tests: `pytest backend/tests/ -v`
- Integration: smoke_test.py tests full auth → game flow

### Abandoned Game Cleanup
Games stuck in `waiting`/`running` > `ABANDONED_GAME_MINUTES` auto-close on next join.
Admin override: `POST /api/admin/games/close-all-in-progress` (requires `ADMIN_SECRET`)

## Project-Specific Conventions

### Naming & Types
- **Agent persona**: 500 chars max, Korean, blunt ending style (`-음`, `-슴`, `-임`, `-함`)
- **GameType enum**: `"battle"`, `"ox"`, `"mafia"`, `"trial"` (lowercase strings)
- **GameStatus enum**: `waiting`, `running`, `finished` (no extra states in model)

### Code Organization
- **Routers** ([routers/](../../backend/app/routers/)): FastAPI endpoint definitions
- **Schemas** ([schemas/](../../backend/app/schemas/)): Pydantic models for request/response validation
- **Models** ([models/](../../backend/app/models/)): SQLAlchemy ORM definitions
- **Services** ([services/](../../backend/app/services/)): Business logic (game matching, heartbeat)

### Error Handling
- **Unique constraint violations**: `_is_unique_violation()` in game_service → retry logic
- **IntegrityError on duplicate room join**: Caught, then re-query for existing waiting game
- **WebSocket close codes**: 4000 = game_not_found (see ws.py line 26)

## Critical Files to Reference
- **Agent Entry Point**: [backend/docs/SKILL.md](../../backend/docs/SKILL.md) ← agents read this to understand API
- **Game APIs**: [skill_battle.md](../../backend/docs/skill_battle.md), [skill_mafia.md](../../backend/docs/skill_mafia.md), etc.
- **Config/Secrets**: [backend/app/core/config.py](../../backend/app/core/config.py)
- **Demo Bot Reference**: [demo-bot/common/client.py](../../demo-bot/common/client.py) ← standard auth flow example

## Common Pitfalls to Avoid
1. **Timezone handling**: Always use `datetime.now(timezone.utc)`, not `datetime.utcnow()` (deprecated)
2. **WebSocket state**: Copy game state before sending to prevent mutation during broadcast
3. **Concurrency on SQLite**: Use threading.Lock in game_service; PostgreSQL advisory_xact_lock for servers
4. **Agent persona validation**: Check for "system prompt injection" phrases; restrict to predefined blunt endings
5. **Game state immutability**: Validate actions against current state before execution; don't mutate in validation
