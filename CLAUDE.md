# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Language split.** This file is written in **English** — it exists to be read by Claude Code, not browsed by humans. Chinese appears only where it is a literal quote of something defined in a Chinese doc (a heading to search for, a domain term, real seed data); don't translate those away or the pointer stops resolving. Every *other* doc in the repo (`README.md`, `docs/**`, module READMEs) and every reply to the user are Chinese.

## Rules
1. Reply in Chinese for all responses.
2. After completing a task, update the documentation promptly — **by editing the affected lines, never by appending a new section or rewriting the file**. See "Keep docs small" below; that constraint is part of this rule, not a suggestion.
3. This project is currently in demo design stage (not launched, 0 users). Feel free to share your views on the project at any time — don't blindly follow the user's commands, but continuously raise reasonable challenges and suggestions, including but not limited to design proposals, technical planning, architecture, and database design. After completing a task, also reflect on whether the implementation can be simplified. As long as it makes the project better, you may propose rebuilding anything from scratch at any time.

## Documentation Maintenance & Reading Order

- **Reading order / responsibility & authority of each doc**: see "先读什么" (What to read first) in `README.md`.
- **Documentation maintenance rules** (what to sync when you change something): see `docs/handoff.md` §10.
- **Conflict priority**: running code / tests > `docs/handoff.md` (current facts) > this file (engineering constraints) > module README > `docs/design.md` (technical design) > `docs/prd.md` (vision).
- After completing a code task, you must sync affected docs, especially `docs/handoff.md`; do not only update the PRD.

### Keep docs small — edit in place, don't accumulate

Docs are read every session; length is a real cost. **Updating a doc means editing the affected lines, not appending a new section and not rewriting the file.**

- **Write once, point elsewhere.** A fact lives in exactly one doc. Everywhere else links to it. Never restate status, route details, or design rationale in two files — if you're about to, replace the copy with a pointer.
- **Replace, don't append.** When behaviour changes, rewrite the sentence that is now wrong. Do not add a dated "update" paragraph below the stale one — that is how a doc doubles in size while getting less trustworthy.
- **No changelog sections.** Git history is the changelog. Only record a dated entry when a *decision* (and its reason) must survive, and keep it to a few lines.
- **Keep the reason, drop the narrative.** "X because Y" earns its place; the story of how you arrived at X does not. Failed experiments compress to one line stating what was ruled out.
- **This file holds constraints, not status.** Invariants, boundaries, and conventions that are expensive to rediscover. Progress/completion state belongs in `docs/handoff.md` §2 only.
- **Prune while you're there.** If a section you're touching has gone stale or duplicated, delete the dead part in the same pass.

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

Defaults are defined in `config.setDefaults()` (private): DB localhost/5432/postgres/story_editor, `SERVER_PORT=":8080"`, `AGENT_URL="http://localhost:8001"`, `UPLOAD_DIR="./uploads"`, `UPLOAD_MAX_MB=5`.

> Adding a config key means touching **four** places: the `Config` struct field, the per-key `v.BindEnv(...)` (AutomaticEnv alone does not work with `Unmarshal`), `setDefaults()`, and `backend/.env.example` + `deploy/docker/backend.env.example`.

> `main.go` uses `LoadHTMLGlob("../templates/*")` to load templates, and viper looks for config.yaml in `./config` and `.` — therefore you **must run under the `backend/` directory** (`cd backend && go run .`), otherwise the template path breaks.

## Architecture Patterns

### Layered Architecture (flat layering)

Strictly unidirectional: `handler → service → repository`. `model` and `pkg` are stateless shared layers and must contain no business logic.

| Path | Responsibility |
|---|---|
| `main.go` | config → db → DI → routes → run (manual wiring, no DI framework) |
| `config/` | viper: env > config.yaml > defaults |
| `internal/model/` | GORM structs + `ToResponse()` DTO. Data shape only |
| `internal/handler/` | bind → call service → respond. No logic |
| `internal/service/` | business logic, pure Go, not bound to HTTP |
| `internal/service/ports.go` | cross-module narrow interfaces (`StoryReader`) — **the split seam** |
| `internal/service/ownership.go` | `requireOwner` / `ownerOrNotFound` |
| `internal/repository/` | GORM only; takes/returns `model` structs |
| `internal/authz/` | role→permission policy. Stateless, no DB |
| `internal/middleware/` | JWT parsing, `RequirePermission`, CORS |
| `pkg/` | zero-business utilities; any layer may import |

The table is the whole rule for layers. The one that actually gets violated is the module seam:

> **Module boundaries (modular monolith).** Modules are domains (user/story/play/llm/community). A module must **never** import another module's `repository` — cross-module reads go through a narrow interface in `service/ports.go` (e.g. `StoryReader`, satisfied by `*repository.StoryRepository` via duck typing). That interface is the seam a future extraction cuts along; a direct repo import welds the modules together.

### Dependency Injection

Assembled by hand in `main.go`: config → db → repository → service → handler → routes. Startup runs `CREATE EXTENSION IF NOT EXISTS pgcrypto` (needed by `gen_random_uuid()`), then `AutoMigrate` over all models, then an idempotent `seed()` (guest user + demo works).

- `NewPlayService` / `NewNodeService` take story access as the **`StoryReader` interface**, not the concrete repo — keep it that way.
- Play's cross-table writes go through `PlaySessionRepository.CreateNodeAndUpdateSession` / `DeleteSessionCascade`. The old `DB()` raw-connection escape hatch was removed on purpose; don't reintroduce one.

### Route Registration

Registered directly in route groups in `main.go`. **The endpoint list lives in `docs/handoff.md` §7.1** — don't duplicate it here.

| Group | Auth |
|---|---|
| `/api/v1/auth/*` | public (register/login) + `AuthRequired` (profile) |
| `/api/v1/stories/*`, `/nodes/*` | reads public, writes `AuthRequired` |
| `/api/v1/play/*` | `AuthOptional` |
| `/api/v1/assist/*`, `/llm/*`, `/uploads/*` | `AuthRequired` |
| `/api/v1/admin/llm/*` | `AuthRequired` + `RequirePermission(authz.PermPlatformLLMManage)` |
| `/api/v1/community/*` | handler stubs, not usable |

Constraints that are expensive to rediscover:
- **`/play` is `AuthOptional`, but anonymous players can no longer generate.** The mount stays optional so existing anonymous sessions remain readable and migratable, and with a token the session belongs to the user. But generation needs a resolvable model, and the platform key is never given to anonymous callers — so the story detail page blocks the CTA and points to login. Every session-scoped route still verifies `session.PlayerID` (the anonymous-guest sharing weakness in `docs/handoff.md` §9.2 is now unreachable, **not fixed**).
- **The browser never calls the agent.** It has no CORS and no auth; Go forwards `/assist/*` through `AgentClient` (180s `assistClient`).
- **`/uploads` is mounted under `/api/v1` deliberately** — prod nginx only proxies `/api/v1/` to the backend, a bare `/uploads` would go to Next.js. Upload type is decided by sniffing the file header, never by `Content-Type`/extension; SVG is excluded (inline script + same-origin static serving = stored XSS). Uploading only yields a URL — binding is a separate save (`avatar_url` / `cover_url`).
- **BYOK: connection is account-level, model choice is per-work.** `world_config.recommended_models` is the creator's display-only annotation, never auto-applied to a player.
- **There is no free fallback.** Resolution is *per-work user connection → platform key (only while the account has credit) → hard failure* (`pkg.CodeNoLLMConfig`). Every account gets ¥1 of credit at registration, metered by real token usage; anonymous callers never get the platform key. Fail **before** calling the agent — it holds no default credentials and would only return an unreadable error. Details and the credit math: `docs/handoff.md` §12.
- **Publishing is the strict gate**: `PUT /stories/:id/status` runs strict `world_config` validation; drafts stay lenient. `GET /stories/` (homepage) returns published only.

### Unified Error Handling

`pkg/errors.go` — `AppError` has two key fields:
- `StatusCode` — HTTP status code (not serialized to JSON)
- `BizCode` — business error code (serialized to `error.code` in JSON)

Predefined HTTP errors: `BadRequest(msg)`, `Unauthorized(msg)`, `NotFound(msg)`, `Forbidden(msg)`, `Conflict(msg)`, `Internal(msg)`.
Business codes use `NewBusinessError(code)` / `NewBusinessErrorWithMessage(code, msg)`. **The allocated range and what each code means is the comment block above `NewBusinessError` in `pkg/errors.go`** — read it there and take the next free number; don't restate the list here.

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
- **Resource ownership** (owner == caller): NOT part of RBAC. Enforced in the service layer via `service.requireOwner(ownerID, callerID)` (→403) or `ownerOrNotFound` (→404, doesn't leak existence). Play sessions use `checkSessionOwner`; node CRUD checks via `node.StoryID → Story.CreatorID`. `GetSession`/`Backtrack`/`ChoiceStream`/`OpeningStream` and `NodeService.Update/Delete` all verify ownership (previously an IDOR gap).

> **Known limitation**: anonymous players all fall back to the single seeded `guest` PlayerID, so ownership checks don't isolate anonymous sessions from each other (logged-in users are fully protected). See `docs/handoff.md §9.2`.

## Key Design Conventions

### DTO Pattern

Each model has a `ToResponse()` method returning an external-facing DTO (e.g. `UserResponse`), hiding sensitive fields (`PasswordHash`, etc.). Handlers only return DTOs, never exposing models directly.

### Service Input Types

The service layer defines its own input structs (e.g. `service.StoryCreateInput`, `service.NodeCreateInput`), not depending on the handler's request structs. This keeps the service decoupled from the HTTP layer.

### Story Node Tree — JSONB Incremental Attribute Design

Story attributes (HP, gold, affinity…) are **entirely creator-defined; the backend hardcodes no field**. Rationale in `docs/design.md`.

- `StoryNode` is an adjacency list (`parent_id` + `depth`, `is_ending` marks endings). Tree queries (backtrack path, subtree) use Postgres recursive CTEs — never recurse in Go.
- Changes are stored as **increments** (`state_delta JSONB`). Current full state = initial values + all deltas along the path, merged by type.

**Attribute types** — declared per key in `world_config.attributes`; they decide both the delta format the AI must emit and the merge strategy:

| type | delta shape | merge |
|---|---|---|
| `number` (hp, gold) | the increment: `{"hp": -10}` | add |
| `scalar` (location, flag) | the new value | overwrite |
| `set` (inventory) | `{"add": [...], "remove": [...]}` | per-element add/remove, dedup |
| *undeclared* | — | both numeric → add, else overwrite (back-compat for pre-`attributes` works) |

**The two implementations must stay aligned**: `service.mergeState` (`play.go`, types from `WorldConfig.AttrTypes()`) and the agent's `normalize` (`graph/story_graph.py`, which also discards illegal keys). `play_merge_test.go` is the contract test — change one side, run it.

Three optional flags on an attribute declaration:

- **`"hidden": true`** — a behind-the-scenes gauge for the AI only (suspicion, fate). It still merges into `current_state` and is passed to the agent; what changes is that `AttrBar` filters it out, and the prompt tells the LLM to steer with it but **never name it or report its numbers** — it may only surface indirectly through the narrative.
- **`"reveal": true`** — hidden *until the story lets the player discover it*, then shown; a per-session visibility the AI controls. The value is tracked all along; only display is gated. State lives in `play_sessions.revealed_attrs` + `story_nodes.revealed_snapshot` (per-node, so **backtracking before the discovery re-hides it**). The writer emits a `revealed: [...]` list, `normalize` whitelists it against declared reveal keys, Go unions it in. `AttrBar` shows a key iff `not hidden ∧ (not gated ∨ revealed)`. This is what stops an opening from spoiling every `initial_state` attribute up front.
- **`"max": <positive number>`** (`number` only) — a **display** bound: `AttrBar` draws a progress bar only for keys that declare it, plain number otherwise. There is no meaning of "full" without a declared bound — a hardcoded 0–100 left `gold: 500` permanently full and `affinity: -20` permanently empty, which misleads more than no bar. Never participates in merging, never sent to the agent. Enforced by `pkg.ValidateWorldConfig` rule 8.

**Genre tags (`world_config.tags: string[]`)** — `tags[0]` is the primary genre (homepage groups its filter chips by it); the rest are display-only labels. **Keep distinct from `theme`, which only picks a color skin** — using the theme's display name as a genre produced cards like 《孤岛探案》 labelled "恐怖 · 怪谈". `GENRES`/`TONES` in `lib/types.ts` are a **suggestion list, not a whitelist**; tags outside it survive round-trips untouched.

> `world_config` unknown keys pass through untouched (the Go `worldConfigShape` struct ignores them). That's why `theme`/`tags` cost zero backend changes — reach for it before adding a column.

### AgentClient

`service/agent_client.go` is a standalone HTTP client calling the Python agent service's `/generate`, `/continue`, `/merge-check` endpoints. It does not depend on the repository layer. `CheckMerge` uses the generic `postInto` (`post` is its `AIResult`-specialized wrapper).

**Node semantic merge & dedup** (`tryMerge` in `play.go`, inside `applyContinueResult`): after the continuation stream ends and before creating a new node, take the current node's same-level children (`FindChildren`), first **hard-filter** by canonical JSON equality of `state_delta` (`deltaEqual`, saving an AI call), then call `CheckMerge` on the candidates to judge semantic equivalence; on a hit, reuse that child node (change the session pointer, `NodeCount` unchanged), otherwise create a new one. Conservative strategy: if the agent is unsure, do not merge.

## PostgreSQL / GORM

- Driver: `gorm.io/driver/postgres` + `gorm.io/gorm`
- Module name: `backend`, Go 1.25
- Database name: `story_editor` (configured via env var DB_NAME)
- Tables are auto-created by GORM AutoMigrate
- Model definitions are in `internal/model/`, using GORM tags

## Database Design Blueprint (infa/sql/)

The SQL files under `infa/sql/` are the **complete data model design blueprint, ahead of the Go implementation** — GORM currently only AutoMigrates a subset of these tables. Before adding a new module, check the corresponding SQL first:
- `users.sql` (001) — users + credential separation
- `stories.sql` (002) — works + world_config/initial_state
- `play.sql` (003) — `play_sessions` (stores the **full state snapshot** `current_state JSONB`, complementary to the node tree's incremental delta design) + node tree
- `community.sql` (004) — likes/favorites/comments/route sharing, incl. redundant count fields like `stories.like_count`

## Agent Service (agent/, Python FastAPI)

A standalone process reached via `AGENT_URL` (default `http://localhost:8001`). Startup: `cd agent && pip install -r requirements.txt && uvicorn app.main:app --port 8001` (see `agent/README.md`).

Hard boundaries — breaking these breaks the architecture, not just a feature:
- **The agent never touches the database, and holds no LLM credentials at all.** Everything arrives in the request (`llm_write` / `llm_review` for play, `llm` for assist); a missing key/base_url/model raises `LLMConfigMissing` rather than falling back. The old `DEEPSEEK_*` defaults were deleted on purpose — an invisible, unmeterable, un-admin-able server cost. Don't reintroduce one.
- **`llm_review` absent means the player turned quality review off** (per-work toggle, default off): skip the audit entirely and say so in telemetry (`review=off`), rather than pretending the first draft passed.
- **The agent reports token usage, never money.** It returns per-stage `usage` in the `done` frame; Go owns pricing, credit and deduction.
- **The agent is not internet-facing** — no CORS, no auth. Go is the only caller.
- **`_stream_pipeline` in `app/graph/story_graph.py` is the only generation orchestration.** The historical non-streaming langgraph graph is retired; `run_start`/`run_continue` are synchronous adapters that drain the same stream. Don't add a second path.
- **Quality review must never fail the player's turn.** A rejected draft is revised by a memory-equipped writer at most `AI_REVIEW_MAX_RETRIES` times, then **delivered anyway** with `degraded=1` telemetry. Attributes/deltas are auxiliary; a flawed turn beats a blocked one.
- **`normalize` passes through keys whose type isn't declared** in `attributes`, letting Go's `mergeState` infer — this is what keeps pre-`attributes` works playable.

Files: `routers/generate.py` (`/generate/stream`, `/continue/stream`, `/opening/complete`, `/merge-check`), `routers/assist.py` (`/assist/world|opening|polish|branches`), `schemas.py` (contract mirror of the Go DTOs), `llm.py` (OpenAI-compatible client; `chat_json` forces `response_format=json_object`, `chat_stream` does not; `_build_ephemeral` is the only client constructor — per-request, uncached, no defaults).

How the pipeline actually works (writer beats, `<<<META>>>` JSON tail, tiered review, incremental summary + recap window): `docs/handoff.md` §6.1–6.3. Design rationale and the unbuilt phases: `docs/design.md` "AI agent", `docs/context-strategy.md`.

## Status & roadmap are NOT in this file

Deliberately — a status table here would be a second copy that goes stale. Completion state: `docs/handoff.md` §2. What to build next: §9.3. Per-feature deep dives: BYOK §12, dual-mode design + per-work theming §13, image upload §14.

The one sequencing constraint worth repeating: the agent pipeline's Phase 2/3 (splitting director/recall/write into separate nodes, RAG, per-NPC sub-agents) is **gated on real multi-turn telemetry**, not on it being the next interesting thing to build. See `docs/design.md` "AI agent" and `docs/context-strategy.md`.

`templates/index.html` is a leftover Gin placeholder, superseded by `frontend/`.

## Frontend Design System (the UI source of truth)

**Read these two before adding or reshaping any frontend surface:**
- `docs/design/DESIGN.md` — enforceable design rules, the dual-mode decision (管理态 *management mode* / 阅读态 *reading mode*), component conventions, and the checklist for adding a page.
- `docs/design/tokens.css` — **the single source of truth for every design variable** (color, type scale, spacing, radius, motion, shadow, reading mode, per-work theme colors). Reference variables only; never hardcode a value. Adding a variable means writing it into `tokens.css` first, then `globals.css`.

Tokens are already merged into `frontend/app/globals.css` as three layers: `:root` (管理态), `.od-reading` (阅读态), `[data-work-theme]` (per-work theme colors).

`docs/design/prototypes/*.html` are static high-fidelity references per screen — **visual targets, not code to copy**: `index` (overview), `home-discover` (library), `story-detail`, `play-reading`, `create-editor`, `my-space`, `settings` (incl. BYOK), `community`, `login`, `design-system` (visual spec). Behaviour always follows the backend contract; the prototypes' fake data and timers exist only to demo the visuals.
