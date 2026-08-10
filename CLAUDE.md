# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules
1. Reply in Chinese for all responses.
2. After completing a task, update the documentation promptly.
3. This project is currently in demo design stage (not launched, 0 users). Feel free to share your views on the project at any time — don't blindly follow the user's commands, but continuously raise reasonable challenges and suggestions, including but not limited to design proposals, technical planning, architecture, and database design. After completing a task, also reflect on whether the implementation can be simplified. As long as it makes the project better, you may propose rebuilding anything from scratch at any time.

## Documentation Maintenance & Reading Order

- **Reading order / responsibility & authority of each doc**: see "先读什么" (What to read first) in `README.md`.
- **Documentation maintenance rules** (what to sync when you change something): see `docs/handoff.md` §10.
- **Conflict priority**: running code / tests > `docs/handoff.md` (current facts) > this file (engineering constraints) > module README > `docs/design.md` (technical design) > `docs/prd.md` (vision).
- After completing a code task, you must sync affected docs, especially `docs/handoff.md`; do not only update the PRD.

## Project Overview

"AI-driven interactive story co-creation community" — users are both players and creators, collaborating via AI Agents to generate, experience, share, and re-create stories.

Tech stack: Go-Gin + PostgreSQL/GORM (backend), Next.js + React + Zustand (play frontend, built, see `frontend/`), Python FastAPI (agent service, standalone process, implemented and integrated; generation uses the lightweight in-house streaming pipeline `_stream_pipeline`, not langgraph).

## Build & Run

```powershell
# One-click (Windows): pre-checks + launch Agent service (:8001), backend (:8080), frontend (:3000) in separate windows
.\scripts\dev.ps1        # all; .\scripts\dev.ps1 -Only ai | -Only backend | -Only frontend to start one
```

```bash
# Build
cd backend && go build .

# Run (requires a running PostgreSQL; must be under backend/)
cd backend && go run .

# Test
cd backend && go test ./...

# Add a dependency
cd backend && go get <pkg> && go mod tidy

# Agent service (standalone process)
cd agent && uvicorn app.main:app --port 8001   # see agent/README.md

# Frontend (play, standalone process)
cd frontend && npm install && npm run dev   # :3000, see frontend/README.md
```

## Configuration

`backend/config/config.go` reads config via viper, with priority: **environment variables > config.yaml > defaults**. The env var template is in `backend/.env.example`.

Defaults are defined in `config.setDefaults()` (private): DB localhost/5432/postgres/story_editor, `SERVER_PORT=":8080"`, `AGENT_URL="http://localhost:8001"`.

> `main.go` uses `LoadHTMLGlob("../templates/*")` to load templates, and viper looks for config.yaml in `./config` and `.` — therefore you **must run under the `backend/` directory** (`cd backend && go run .`), otherwise the template path breaks.

## Architecture Patterns

### Layered Architecture (flat layering)

Strictly follows `handler → service → repository` unidirectional dependency. `model` and `pkg` are stateless common layers, forbidden from containing business logic.

```
backend/
├── main.go                     # Startup entry: config → db → DI → routes → run
├── config/config.go            # viper config management
├── internal/
│   ├── model/                  # Pure GORM data models + ToResponse() DTO
│   │   ├── user.go
│   │   ├── story.go
│   │   └── node.go
│   ├── handler/                # HTTP handler: param binding → call service → response
│   │   ├── user.go
│   │   ├── story.go
│   │   ├── node.go
│   │   └── community.go
│   ├── service/                # Business logic layer (pure Go, not tightly bound to HTTP)
│   │   ├── user.go
│   │   ├── story.go
│   │   ├── node.go
│   │   ├── ports.go            # Cross-module narrow interfaces (StoryReader) — the split seam
│   │   ├── ownership.go        # Unified resource-ownership check (requireOwner / ownerOrNotFound)
│   │   └── agent_client.go     # HTTP calls to the Python agent service
│   ├── repository/             # Data access layer (GORM operations)
│   │   ├── user.go
│   │   ├── story.go
│   │   └── node.go
│   ├── authz/                  # Lightweight RBAC single source of truth (role→permission, stateless, no DB)
│   │   └── authz.go
│   └── middleware/
│       ├── auth.go             # JWT Bearer parsing + RequirePermission (RBAC gate)
│       └── cors.go             # Cross-origin
└── pkg/                        # Utility packages with no business dependencies
    ├── jwt.go                  # JWT generation/verification
    ├── response.go             # Unified response format
    └── errors.go               # AppError + business error codes
```

### Layering Rules

1. `handler` may only call `service`, responsible for request binding/validation and response
2. `service` may only call `repository` or `agent_client`, responsible for business logic
3. `repository` only does database operations, accepts/returns `model` structs
4. `model` only defines data structures, forbidden from writing business logic
5. `pkg` has no business dependencies, may be referenced by any layer
6. **Module boundaries (modular monolith)**: modules = domains (user/story/play/llm/community). A module must **not** depend directly on another module's `repository`; cross-module reads go through a narrow interface in `service/ports.go` (e.g. `StoryReader`, satisfied by `*repository.StoryRepository`). This is the seam for future extraction. `internal/authz` is a stateless policy layer (role→permission, no DB) referenceable by any layer.

### Dependency Injection

Assembled manually in `main.go`: config → database → repository → service → handler → route registration.

On startup, `main.go` first executes `CREATE EXTENSION IF NOT EXISTS pgcrypto` (required by `gen_random_uuid()`), then `AutoMigrate` on the current five models: `User`, `UserCredential`, `Story`, `StoryNode`, `PlaySession`, followed by idempotent `seed()` that pre-seeds a guest user + demo works. `PlayService` takes story access as the `StoryReader` narrow interface (not the concrete story repo): `NewPlayService(sessionRepo, nodeRepo, storyRepo, aiClient, llmResolver)` — `storyRepo` satisfies `StoryReader` by duck typing. `NewNodeService(nodeRepo, storyRepo)` likewise takes `StoryReader` for node ownership checks. Cross-table writes in play (node + session) are done via `PlaySessionRepository.CreateNodeAndUpdateSession` / `DeleteSessionCascade`; the old `PlaySessionRepository.DB()` raw-connection leak was **removed**. Mounted at `/api/v1/play/*`.

### Route Registration

Routes are registered directly in route groups in `main.go`:
- `/api/v1/auth/*` — register/login/profile. **JWT now carries a `role` snapshot** (`pkg.GenerateToken(userID, role, secret)`); `middleware.RequireAdmin()` gates admin routes. The old single-key `/auth/settings` was **removed** — BYOK moved to `/llm/*` (see below).
- `/api/v1/llm/*` (AuthRequired) — **BYOK**. Connections are **account-level**, model choice is **per-work**: `GET/POST /connections`, `PUT/DELETE /connections/:id` (each = an OpenAI-compatible endpoint + AES-256-GCM key + default_model; reads masked hint only), `POST /connections/test` (one-shot ping via agent), `GET /connections/:id/models` (fetch the endpoint's `/models` for a dropdown; manual fallback), `GET/PUT /story-config/:storyId` (the player's per-work stage→{conn,model} choice, stored in `user_story_llm_configs`; stages: write/review). Creator's per-stage **recommended models** live in `stories.world_config.recommended_models` (display-only annotation, not auto-applied).
- `/api/v1/admin/llm/*` (AuthRequired + RequireAdmin) — platform LLM settings per stage (`platform_llm_settings` table): `GET/PUT /platform`, `POST /platform/test`. **First admin via manual DB promotion** (`UPDATE users SET role='admin'`), then re-login. See `docs/handoff.md §12`.
- `/api/v1/stories/*` — story CRUD + node creation; creation extras: `GET /mine` (my works incl. drafts, AuthRequired), `PUT /:id/status` (draft↔published, publish does strict world_config validation + sets PublishedAt); `GET /` (homepage) filters to published only
- `/api/v1/assist/*` — creation assistance forwarding to agent (AuthRequired): `POST /world|opening|polish|branches`. Requests may carry `connection_id` to override the creator's world-stage connection. Go resolves the creator's LLM config (via `LLMResolver`) and injects it before forwarding. Agent has no CORS/auth so the browser never calls it directly; Go forwards via `AgentClient` (180s `assistClient`)
- `/api/v1/nodes/*` — node query/update/delete
- `/api/v1/play/*` — (mounted with `AuthOptional`: with a token, belongs to the logged-in user; otherwise anonymous guest) play sessions: create empty session `POST /sessions` (no longer synchronously generates the opening), **claim anonymous progress after login `POST /sessions/migrate` (AuthRequired, only migrates sessions reported by this browser and owned by guest)**, **streaming opening `POST /sessions/:id/opening/stream` (SSE, idempotent; triggered when the play page sees current_node=null)**, list `GET /sessions` (the current player's/guest's history sessions, with `story_title`, for loading saves), query `GET /sessions/:id`, delete `DELETE /sessions/:id` (delete save, validates ownership then transactionally cascade-deletes all nodes of that run), **streaming choice `POST /sessions/:id/choice/stream` (SSE: delta/revise/done/error)**, backtrack `POST /sessions/:id/backtrack` (playable anonymously)
- `/api/v1/community/*` — community browse/detail/like/comment (handler stubs)

### Unified Error Handling

`pkg/errors.go` — `AppError` has two key fields:
- `StatusCode` — HTTP status code (not serialized to JSON)
- `BizCode` — business error code (serialized to `error.code` in JSON)

Predefined HTTP errors: `BadRequest(msg)`, `Unauthorized(msg)`, `NotFound(msg)`, `Forbidden(msg)`, `Conflict(msg)`, `Internal(msg)`.
Business error codes 10001-10011 use `NewBusinessError(code)` or `NewBusinessErrorWithMessage(code, msg)`.

Handlers directly return errors from the service layer, handled uniformly by `pkg.Error(c, err)` — which extracts `AppError` via type assertion and sets the correct HTTP status code.

### Unified Response Format

All JSON responses use `pkg/` helper functions; do not call `c.JSON()` directly:
```
{ "success": true, "data": {...}, "error": null, "meta": {...} }
```
Helper functions: `pkg.Success`, `pkg.Created`, `pkg.SuccessWithMeta`, `pkg.Error`, `pkg.NoContent`.

### Authentication & Authorization

`middleware.AuthRequired(secret)` — parses Bearer JWT, sets `c.Set("user_id", ...)` + `c.Set("role", ...)`.
In handlers, use `middleware.GetUserID(c)` / `middleware.GetRole(c)` to retrieve the values.

**RBAC (lightweight, code-level)** — two distinct concerns, kept separate:
- **Role → permission** (global actions): declared in `internal/authz` (`authz.Can(role, perm)`, single source of truth, stateless, no DB). Gate routes with `middleware.RequirePermission(perm)`; `RequireAdmin()` is kept as a backward-compatible alias delegating to `RequirePermission(authz.PermPlatformLLMManage)`. Role is a JWT snapshot — promotion (`UPDATE users SET role='admin'`) requires re-login.
- **Resource ownership** (owner == caller): NOT part of RBAC. Enforced in the service layer via `service.requireOwner(ownerID, callerID)` (→403) or `ownerOrNotFound` (→404, doesn't leak existence). Play sessions use `checkSessionOwner`; node CRUD checks via `node.StoryID → Story.CreatorID`. `GetSession`/`Backtrack`/`ChoiceStream`/`OpeningStream` and `NodeService.Update/Delete` all verify ownership (previously an IDOR/越权 gap).

> **Known limitation**: anonymous players all fall back to the single seeded `guest` PlayerID, so ownership checks don't isolate anonymous sessions from each other (logged-in users are fully protected). See `docs/handoff.md §9.2`.

## Key Design Conventions

### DTO Pattern

Each model has a `ToResponse()` method returning an external-facing DTO (e.g. `UserResponse`), hiding sensitive fields (`PasswordHash`, etc.). Handlers only return DTOs, never exposing models directly.

### Service Input Types

The service layer defines its own input structs (e.g. `service.StoryCreateInput`, `service.NodeCreateInput`), not depending on the handler's request structs. This keeps the service decoupled from the HTTP layer.

### Story Node Tree — JSONB Incremental Attribute Design

Core design idea (see `docs/design.md`): story attributes (HP, gold, affinity, etc.) are entirely customized by creators; the backend does not hardcode fields.

- **`StoryNode`** uses an adjacency list (`parent_id`) to form a tree, `depth` records the level, `is_ending` marks endings
- Attribute changes are stored as increments (`state_delta JSONB`); the current full state = all deltas along the path merged by type + initial values
- Postgres recursive CTE handles tree queries (backtrack path, subtree expansion), no application-layer recursion needed
- Attribute field names are transparent to the backend, directly using JSONB merge operations

**Attribute type system (number / scalar / set)**: creators declare the type of each attribute key in `world_config.attributes`; the AI and backend decide the format and merge strategy of `state_delta` accordingly —
- `number` (numeric accumulation, e.g. hp/gold): delta gives the increment/decrement `{"hp": -10}`, added on merge;
- `scalar` (overwrite, e.g. location/boolean flag): delta gives the new value, later value overwrites earlier;
- `set` (set add/remove, e.g. inventory items): delta gives `{"add": [...], "remove": [...]}`, added/removed and deduplicated per element;
- **keys without a declared type**: backward compatible — if both sides are numeric, accumulate; otherwise overwrite.

The merge logic lives in `service.mergeState` (`play.go`), with types coming from `WorldConfig.AttrTypes()`; on the Python side, `graph/story_graph.py`'s `normalize` regularizes LLM output by the same set of types (discards illegal keys, validates format). The two sides' semantics are strictly aligned, see `play_merge_test.go`.

**Hidden attributes (`"hidden": true`)**: an attribute declaration may add `hidden`, meaning "a behind-the-scenes gauge for AI reference only" (e.g. suspicion/alertness/fate value). It **still** enters `current_state`, merges with deltas, and passes through to the agent; the difference is — ① the player-side `AttrBar` filters out hidden keys per `world_config` and does not display them (the frontend separately fetches `GET /stories/:id` for the hidden list); ② agent `prepare` uses `_hidden_attrs` to inject hidden keys into the prompt, instructing the LLM to update their deltas as usual but **not to name or report numbers** in content/options, only reflecting them indirectly through the story; ③ the creation-side `WORLD_SYSTEM` lets the AI proactively mark pressure-type attributes as hidden when building the worldview. This is the foundation for a future "let players choose which attributes to hide".

**Genre tags (`world_config.tags: string[]`, optional)**: the work's genre labels, passed through exactly like `theme` (the backend's fixed `worldConfigShape` struct ignores unknown keys, so this needs zero backend changes). **Convention: `tags[0]` is the primary genre** — the homepage groups its filter chips by it; the remaining tags are display-only labels on the card and detail page. Keep this distinct from `theme`, which only selects the color skin: using the theme's display name as a genre produced cards like 《孤岛探案》 labelled "恐怖 · 怪谈". Seed works declare both (`backend/seed.go`). The creator picks them in the editor's worldview section; `lib/types.ts` `GENRES`/`TONES` are a **suggestion list, not a whitelist** — tags the AI or the author writes that are outside it survive round-trips untouched.

**Display bound (`"max": <positive number>`, optional, `number` only)**: declares the attribute's upper bound purely for **player-side display** — `AttrBar` draws a progress bar only for keys that declare `max` (width = value/max), and shows a plain number otherwise. Without a declared bound there is no meaning of "full": hardcoding 0–100 made `gold: 500` sit permanently full and `affinity: -20` permanently empty, which misleads more than no bar at all. It never participates in delta merging (`mergeState` ignores it) and is not pushed to the agent. Validated by `pkg.ValidateWorldConfig` rule 8 (positive number, `number` type only); editable per row in the creator's attribute table.

**Reveal-gated attributes (`"reveal": true`)**: distinct from `hidden` (never shown), a reveal-gated attribute is **hidden from the player until the story lets them discover it**, then shown — a per-session dynamic visibility the AI controls. The value is still tracked in `current_state` all along; only display is gated. Data: per-session `play_sessions.revealed_attrs` + per-node `story_nodes.revealed_snapshot` (restored on backtrack so backtracking before the discovery re-hides it). Flow: agent `prepare`/`_write_reveal_gated` injects the "not-yet-revealed gated attrs" into the prompt; the writer emits a `revealed: [...]` list when the narrative discovers them; `normalize` whitelists it against declared reveal keys; Go (`applyContinueResult`/`StartOpeningStream`) unions it into the session set + node snapshot; `AttrBar` shows a key iff not-hidden ∧ (not-gated ∨ revealed). Solves the "opening shows all initial_state attrs prematurely" problem (e.g. 《最后的深夜电台》 marks 物资 as reveal, so it isn't shown until the player organizes supplies — avoiding the illogical "5→4 on organize").

### AgentClient

`service/agent_client.go` is a standalone HTTP client calling the Python agent service's `/generate`, `/continue`, `/merge-check` endpoints. It does not depend on the repository layer. `CheckMerge` uses the generic `postInto` (`post` is its `AIResult`-specialized wrapper).

**Node semantic merge & dedup** (`tryMerge` in `play.go`, inside `applyContinueResult`): after the continuation stream ends and before creating a new node, take the current node's same-level children (`FindChildren`), first **hard-filter** by canonical JSON equality of `state_delta` (`deltaEqual`, saving an AI call), then call `CheckMerge` on the candidates to judge semantic equivalence; on a hit, reuse that child node (change the session pointer, `NodeCount` unchanged), otherwise create a new one. Conservative strategy: if the agent is unsure, do not merge.

## PostgreSQL / GORM

- Driver: `gorm.io/driver/postgres` + `gorm.io/gorm`
- Module name: `backend`, Go 1.25
- Database name: `story_editor` (configured via env var DB_NAME)
- Tables are auto-created by GORM AutoMigrate
- Model definitions are in `internal/model/`, using GORM tags

## Current Implementation Status

| Module                                    | Status |
|---------------------------------------|------|
| Project skeleton (config, pkg, middleware, DI, routes) | Done |
| User (register/login/JWT/profile)                  | Done (bcrypt password + user_credentials credential separation) |
| Story (CRUD + list)                      | Done |
| Node (node creation/children/update/delete)                  | Done |
| Play / play sessions (opening/choice/backtrack + attribute merge + session list)   | Done (`PlayService` + `/play` routes, incl. `GET /sessions` save-load list) |
| AgentClient + Agent service integration              | Done (`agent/` + Go HTTP orchestration, attribute type system number/scalar/set) |
| Play frontend (Next.js)                         | Done (`frontend/`: star-map theme; work selection → **story detail/transition page** (`/story/:id`) → play; play page shows the **script name** and uses a **left status rail (`AttrBar`) + centered story + right star-map drawer** layout; attribute visibility honors hidden/reveal-gated; history session save-load resume + delete; explored story lines shown as a glowing star map in the drawer, click node to backtrack; **optional login/register + guest session migration**) |
| Node semantic merge & dedup                            | Done (after continuation stream ends, `applyContinueResult`: same-level children hard-filtered by `state_delta` equality + agent `/merge-check` semantic equivalence judgment → reuse on hit instead of creating, avoiding near-synonymous branches polluting the story tree) |
| Agent pipeline Phase 1 (director beats + consequential choices + attributes in play + ④ incremental summary + quality review) | Done (low-temperature `review` callback audit after `generate`; on failure, **memory-equipped writer revises** (edits on the previous draft), up to `AI_REVIEW_MAX_RETRIES` times, **degrades to deliver the last draft when exceeded** (tolerates flaws, never lets the player's operation fail). `summary` is persisted and re-injected during continuation; old data falls back to a sliding window. See "AI agent" three phases in `docs/design.md`) |
| Full streaming output for opening + continuation (SSE, Phase 2 slice) | Done (continuation `/choice/stream`→`MakeChoiceStream`→agent `/continue/stream`; opening `StartSession` only creates an empty session, the play page triggers `/opening/stream`→`StartOpeningStream`→agent `/generate/stream`. Body text streams character-by-character separated by a sentinel, then merged/deduped/persisted after the end; review rejection emits revise. First-byte latency `ttfb_ms` telemetry ~0.4~1.5s vs full ~7.7s) |
| Preset opening completion | Done (opening for works with `opening_content`: body text as a single-frame delta + call `/opening/complete` to fill starting options + summary, avoiding an opening with only a free-input box) |
| Creation/editing system (creator editor) | Done (MVP) (backend: `StoryCreateInput`/`StoryUpdateInput` now accept `world_config`/`opening_content`; runtime validator `pkg.ValidateWorldConfig` (draft lenient / publish strict); publish transition `PUT /stories/:id/status`; my-works `GET /stories/mine`; homepage `List` filters to published; assist Go-forwarding `POST /api/v1/assist/world|opening|polish|branches` (agent stays internal, no CORS/auth; 180s `assistClient`). Frontend: `editorStore` + `/create`,`/edit/:id`,`/mine`; **AI-first flow** (idea→`/assist/world`→structured tweak→`/assist/opening`→publish); structured attribute table (type/initial/hidden/reveal), `initial_state` derived from attributes at save; star-map-themed form components) |
| User profile + personal settings | Done (backend: profile CRUD; `/me` — display + edit nickname/bio) |
| BYOK (multi-provider, per-work model choice, platform key in DB, min admin gate) | Done (backend: `llm_connections`(account-level) + `user_story_llm_configs`(per user+story model choice) + `platform_llm_settings` tables; `LLMResolver.ResolveForPlay(userID, storyID, stage)` = story-config > platform > nil, `ResolveForAssist(userID, override)` = editor-override > platform > nil; AES-256-GCM keys via `pkg.Encrypt`; JWT carries `role` + `RequireAdmin`; `/llm/*`, `/admin/llm/*`. Agent threads `llm_write`/`llm_review`/`llm` into `_build_ephemeral` (agent stays DB-free). Frontend: `/me` connections CRUD (`LLMSettings`), story-detail per-work config panel (`StoryLLMConfigPanel`, connection→`/models` dropdown + manual), editor recommended-model fields + connection dropdown, role-gated `/admin`. Play burns the player's own key, falls back to platform. First admin via manual DB promotion. See `docs/handoff.md §12`. **Deferred: platform-key quota limiting**; old `User.LLMKeyCipher` deprecated/orphaned) |
| Per-work theming (star map skin swap) | Done (v1, frontend-only, zero backend/migration: theme id in `world_config.theme`, passthrough. `globals.css` `:root`=default `star` + `[data-theme="ink"]`/`[data-theme="horror"]` override blocks (nebula bg variabilized to `--nebula-a/b`); `data-theme` mounted on `<html>` via `lib/useDocumentTheme.ts` — experience pages only (story detail/play), shell pages keep star. Editor swatch picker (`THEMES` in `lib/types.ts`), `editorStore.theme` round-trip, homepage `StoryCard` accent tint. Story tree auto-recolors via `--glow/--star`. See `docs/handoff.md §13`. **Deferred v2: player global skin override; presets beyond 3**) |
| Community (browse/detail/like/comment)                | handler stubs, all TODO |

## Database Design Blueprint (infa/sql/)

The SQL files under `infa/sql/` are the **complete data model design blueprint, ahead of the Go implementation** — GORM currently only AutoMigrates a subset of these tables. Before adding a new module, check the corresponding SQL first:
- `users.sql` (001) — users + credential separation
- `stories.sql` (002) — works + world_config/initial_state
- `play.sql` (003) — `play_sessions` (stores the **full state snapshot** `current_state JSONB`, complementary to the node tree's incremental delta design) + node tree
- `community.sql` (004) — likes/favorites/comments/route sharing, incl. redundant count fields like `stories.like_count`

## Agent Service (agent/, Python FastAPI)

A standalone process; the Go backend calls it via `AGENT_URL` (default `http://localhost:8001`), and it **does not touch the database**. DeepSeek credentials are pushed down to `agent/.env`; the Go side no longer connects directly to the LLM.

- `app/graph/story_graph.py` — **the only generation orchestration is in `_stream_pipeline` (true streaming)**; the historical non-streaming langgraph graph has been retired. `prepare` (build context / inject attribute types & hidden attributes), `normalize` (regularize deltas by type, filter illegal keys, regularize endings), and `review` are shared pure functions; `run_start`/`run_continue` are synchronous adapters that drain the stream (for tools unrelated to `/opening/complete` and for `/assist/opening`). **Agent pipeline Phase 1**: the writer outputs a single "body `<<<META>>>` JSON tail", doubling as "director + scribe" — beat-controlled body text (referencing attributes) + action-only options (no hints — options are plain in-world actions; consequences are experienced in the story, not previewed) + a rolling `summary`; body text streams character-by-character, and after the end the JSON tail is parsed by the sentinel (missing/illegal falls back to `STRUCTURE_SYSTEM`); then a low-temperature `review` audits continuity/attributes/delta and summary consistency, and on failure a **memory-equipped writer revises** (appends the previous draft's AIMessage + feedback HumanMessage into `writer_msgs`, editing on the previous draft rather than rewriting, reducing oscillation). At most `AI_REVIEW_MAX_RETRIES` additional rewrites (default 2), and **on exceeding, degrades to deliver the last draft** (emits `degraded=1` telemetry, no hard failure — attributes/delta are only auxiliary means, flaws are tolerable, never let the player's operation fail). Review is **tiered**: only blocks blocking-level hard defects (body contradictions/no progress/no options/summary tampering with key facts/broken JSON); fuzzy cases like delta precision and attempted-action accounting are all let through. Hidden attributes (`attributes[k].hidden`) are injected into the prompt by `_write_hidden`, having the LLM steer the direction with them but not leak them in body/options. Reveal-gated attributes (`attributes[k].reveal`) are injected by `_write_reveal_gated` (unrevealed ones only); the writer emits a `revealed` list to disclose them at the discovery moment (see "Reveal-gated attributes" above). Continuation context uses the **④ node tree incremental summary** (`_write_history_window`): the most recent non-empty `summary` rendered as `【前情提要】` (recap) + the most recent `_RECENT_RAW`(=2) raw segments, O(1); old sessions without summary fall back to a **sliding window** (`HISTORY_WINDOW`, default 8). Evolution in `docs/design.md` "AI agent", context strategy in `docs/context-strategy.md`
- `app/routers/generate.py` — `POST /generate/stream` `/continue/stream` (streaming SSE: delta/revise/done/error), `/opening/complete` (preset opening fills options + summary, non-streaming), `/merge-check` (node semantic merge judgment, non-streaming). The generation orchestration is all in `_stream_pipeline` in `graph/story_graph.py` (body `<<<META>>>` JSON tail, structurer fallback, review rejection → memory-equipped writer revision, degrade-on-exceed delivery)
- `app/routers/assist.py` — creation assistance `POST /assist/world|opening|polish|branches` (`/world` also produces `attributes` type declarations)
- `app/schemas.py` — request/response models; `WorldConfig.attributes` carries attribute type declarations, aligned with the Go contract. **BYOK**: `LLMConfig{provider,base_url,api_key,model}`; generate/continue/opening-complete requests carry `llm_write`/`llm_review`, assist requests carry `llm` (all optional; absent → agent uses `.env` default)
- `app/llm.py` — OpenAI-compatible client. `chat_json` forces `response_format=json_object` (used for review/merge/structuring/creation assistance); `chat_stream` does not force it (streaming writing, body text separated by a sentinel). `_build_llm(json_mode)` caches two platform-default instances; **`_build_ephemeral(cfg, json_mode)` builds a per-request uncached client for BYOK** (`chat_json`/`chat_stream` take an optional `llm_cfg`). In `story_graph`, the writer/structure-fallback use `llm_write`, `review` uses `llm_review` (threaded via `run_*_stream`/`run_start`/`complete_opening`)

> The full semantics of attribute types (number/scalar/set) are in "JSONB Incremental Attribute Design" above. `normalize` **passes through** keys whose type is not declared in `attributes`, with Go's `mergeState` inferring as a fallback, ensuring old works without `attributes` still work.

Startup: `cd agent && pip install -r requirements.txt && uvicorn app.main:app --port 8001` (see `agent/README.md`).

> Go's `NewAgentClient(cfg.AgentURL)` only does HTTP orchestration; the `StartStory`/`Continue` signatures are unchanged, and the `play` pipeline is unaffected.

## Modules To Be Implemented (in order)

1. ~~**save** — session resume/save-load~~ ✅ Done (`GET /play/sessions` list + frontend homepage save-load resume; already filtered by logged-in user, falls back to guest anonymously)
2. ~~**ai** — agent_client integration with Python agent service~~ ✅ Done (agent/ + Go integration)
2.5. ~~**play** — play session pipeline~~ ✅ Done (`PlayService` + `/play` routes, incl. backtrack)
2.8. ~~**play frontend** — Next.js work selection/play/save-load~~ ✅ Done (`frontend/`)
2.9. ~~**login integration** — frontend login + session migration~~ ✅ Done (optional login, AuthOptional, guest session migration)
3. **Agent pipeline evolution (retention-first, before expansion)** — Phase 1 (director beats + consequential choices + attributes in play + ④ incremental summary + quality review/memory-equipped revision/degrade-on-exceed) ✅ Done; **streaming (SSE, part of the original Phase 2) ✅ Done**.
   - Remaining Phase 2: split the single generation into independent director/recall/write/critic nodes; upgrade recall from node summary to ③ RAG.
   - Phase 3: when multiple NPCs are on scene, dispatch character sub-agents in parallel, with the main agent synthesizing (full multi-agent form). See `docs/design.md` "AI agent" and `docs/context-strategy.md`.
4. ~~**Creation/editing system**~~ ✅ Done (MVP) — creator editor: AI-first flow (idea → `/assist/world` → structured tweak → `/assist/opening` → publish) with a structured attribute table (type/initial/hidden/reveal). Backend extends `StoryCreateInput`/`StoryUpdateInput` to `world_config`/`opening_content` + runtime validator `pkg.ValidateWorldConfig` (draft lenient / publish strict) + publish transition + my-works list + assist Go-forwarding. Frontend `editorStore` drives `/create`,`/edit/:id`,`/mine`. Remaining polish: `/assist/polish` per-field wiring, `/assist/branches` in-editor use, cover upload, richer character fields.
5. **community** — work publishing/search/leaderboard/like/favorite/comment
6. **payment** — paid unlock/tipping/revenue share (can be stubbed for MVP)
7. **achievement** — achievement system

`templates/index.html` is a Gin template placeholder, to be replaced once the frontend is formally built.

## 前端设计规范（UI 事实源）

新增或改造任何前端界面前，**必须先读**：
- `docs/design/DESIGN.md` —— 可执行设计铁律 + 双态（管理态/阅读态）决策 + 组件约定 + 加新页面清单；
- `docs/design/tokens.css` —— 全部设计变量的唯一事实源（颜色/字阶/间距/圆角/动效/阴影/阅读态/作品主题色）；只引用变量，不写死数值。

`docs/design/prototypes/*.html` 是各屏静态高保真参考（视觉参照，非要照抄的代码）：
index(总览) · home-discover(书库) · story-detail(作品详情) · play-reading(游玩) ·
create-editor(创作) · my-space(我的空间) · settings(设置/BYOK) · community(社区) ·
login(登录) · design-system(可视规范)。

落地方式：把 tokens 合并进 `frontend` 的 `globals.css` 主题体系（阅读态映射到现有 `data-theme`），
用 Next.js/React 逐屏实现；交互逻辑以后端契约为准，原型里的假数据/定时器仅为演示。
