# CLAUDE.md

> **Language split.** This file is English — read by Claude Code, not browsed by humans. Chinese appears only as a literal quote of something defined in a Chinese doc (a heading to search for, a domain term, seed data); don't translate those away or the pointer stops resolving. Every other doc and every reply to the user are Chinese.

## Rules

1. Reply in Chinese.
2. After a task, sync affected docs — **by editing the lines that are now wrong**, never by appending a section or rewriting the file. Especially `docs/handoff.md`; don't only update the PRD.
3. Demo stage, not launched, 0 users. Challenge the user's premises when you disagree — design, architecture, schema, scope. After finishing, ask whether it could be simpler. Proposing a rebuild of anything is fair game.

## Docs

**Conflict priority**: running code / tests > `docs/handoff.md` (current facts) > this file (engineering constraints) > module README > `docs/design.md` (technical design) > `docs/prd.md` (vision).

| Where | Holds |
|---|---|
| `docs/handoff.md` | current facts: status §2, endpoints §7.1, known gaps §9.2, next §9.3, BYOK §12, theming §13, upload §14 |
| this file | invariants, boundaries, conventions — **never status** |
| `docs/design.md` | technical design & rationale: attribute system, data flow, node merge, scaling |
| `README.md` | entry point + "先读什么" reading order |

Docs are read every session; length is a real cost.

- **One fact, one doc.** Everywhere else links to it. About to restate a status, a route, or a rationale? Write a pointer instead.
- **Replace, don't append.** Rewrite the sentence that is now wrong. A dated "update" paragraph under a stale one is how a doc doubles in size while getting less trustworthy. Git is the changelog — a dated entry only when a *decision and its reason* must survive.
- **Keep the reason, drop the narrative.** "X because Y" earns its place; how you got to X does not. A failed experiment compresses to one line naming what was ruled out.
- **Prune while you're there.** Touching a stale section means deleting the dead part in the same pass.

## Overview & Run

"AI-driven interactive story co-creation community" — users are both players and creators. Go-Gin + PostgreSQL/GORM backend; Next.js + React + Zustand frontend; Python FastAPI agent service (standalone process; generation uses the in-house streaming pipeline `_stream_pipeline`, not langgraph).

```powershell
.\scripts\dev.ps1        # all three; -Only agent | -Only backend | -Only frontend for one
```

```bash
cd backend && go run .                         # needs PostgreSQL; MUST run from backend/
cd backend && go test ./...
cd agent && uvicorn app.main:app --port 8001   # see agent/README.md
cd frontend && npm run dev                     # :3000, see frontend/README.md
```

> **Run from `backend/`**: `main.go` does `LoadHTMLGlob("../templates/*")` and viper looks for config.yaml in `./config` and `.`; anywhere else breaks the template path.

**Config** — `backend/config/config.go`, viper, priority **env > config.yaml > defaults**. Defaults in the private `config.setDefaults()`; env template `backend/.env.example`. Adding a key means touching **four** places:

1. the `Config` struct field
2. a per-key `v.BindEnv(...)` — AutomaticEnv alone does not work with `Unmarshal`
3. `setDefaults()`
4. `backend/.env.example` **and** `deploy/docker/backend.env.example`

## Architecture

Strictly unidirectional: `handler → service → repository`. `model` and `pkg` are stateless shared layers with no business logic.

| Path | Responsibility |
|---|---|
| `main.go` | config → db → DI → routes → run (hand-wired, no DI framework) |
| `internal/model/` | GORM structs + `ToResponse()` DTO. Data shape only |
| `internal/handler/` | bind → call service → respond. No logic |
| `internal/service/` | business logic, pure Go, not bound to HTTP |
| `internal/service/ports.go` | cross-module narrow interfaces (`StoryReader`) — **the split seam** |
| `internal/service/ownership.go`, `access.go` | `requireOwner`/`ownerOrNotFound`; `canViewStory`/`canPlay` |
| `internal/repository/` | GORM only; takes/returns `model` structs |
| `internal/authz/` | role→permission policy. Stateless, no DB |
| `internal/middleware/` | JWT parsing, `RequirePermission`, CORS |
| `pkg/` | zero-business utilities; any layer may import |

The table is the whole rule for layers. The one that actually gets violated is the module seam:

> **Module boundaries (modular monolith).** Modules are domains (user/story/play/llm/community). A module must **never** import another module's `repository` — cross-module reads go through a narrow interface in `service/ports.go` (e.g. `StoryReader`, satisfied by `*repository.StoryRepository` via duck typing). That interface is the seam a future extraction cuts along; a direct repo import welds the modules together.

**DI** is hand-assembled in `main.go`: config → db → repository → service → handler → routes. Startup runs `CREATE EXTENSION IF NOT EXISTS pgcrypto` (for `gen_random_uuid()`), then `AutoMigrate`, then an idempotent `seed()`.

| Invariant | Why |
|---|---|
| `NewPlayService` takes story access as the **`StoryReader` interface**, not the concrete repo | it is the seam; a concrete repo welds play to story |
| Play's cross-table writes go through `PlaySessionRepository.CreateNodeAndUpdateSession` / `DeleteSessionCascade` | node write + session update must be one transaction. The old `DB()` raw-connection escape hatch was removed on purpose — don't reintroduce one |

## Routes

Registered in route groups in `main.go`. **The endpoint list lives in `docs/handoff.md` §7.1** — don't duplicate it. Constraints that are expensive to rediscover:

| Constraint | Why |
|---|---|
| **`/play/*` is `AuthRequired`; no anonymous play** | every anonymous session shared the one seeded `guest` PlayerID, so `checkSessionOwner` couldn't tell two anonymous players apart — anyone could read or delete anyone's save. Gone with it: `POST /play/sessions/migrate`, `MigrateGuestSessions`, the frontend's `guestSessions`. Old guest saves stay in the DB but are unreachable, a deliberate trade. Seeded `guest` survives only as the author of the demo works |
| **Drafts are author-only.** `GET /stories/:id` is `AuthOptional` | so the author can read their own draft. `canViewStory`/`canPlay` (`service/access.go`, pure, unit-tested) gate everyone else to `published` and answer **404, never 403** — a draft's existence is the author's business |
| **Unpublishing turns other players' running sessions read-only, not dead.** `storyGate` returns `playable`; `GetSession` sets `SessionResult.read_only`; every write path rejects with `readOnlyErr()` | the "reference mode" publish semantics (`docs/prd.md` §5.4.8): they can finish reading, they just can't advance. The error is 403 + a readable message rather than 404 — the player has already played this work, so hiding its existence buys nothing. Backtrack counts as a write: it rewrites `current_node_id` / `current_state`. **On the SSE routes the status is still 200** — `sseStart` commits the header before the service runs, so continue/opening deliver the message as an `event: error` frame instead. That is how every stream error behaves here; the frontend reads `detail` |
| **Non-authors never see hidden values — declarations *and* live values.** `sanitizeWorldConfig` (`access.go`) strips the story detail's `world_config`; `attrView` (`player_view.go`) strips every play DTO | half the job is no job: strip only the declaration and `current_state` still hands over the number. On the config: `hidden` whole, `reveal` initial from **both** `attributes[k].initial` and `initial_state[k]` (rule 5 forces them equal). On play DTOs: `hidden` always, `reveal` until revealed — nodes gate on their **own** `revealed_snapshot`, so the timeline can't spoil ahead and backtracking re-hides; sessions gate on `revealed_attrs`. Authors playing their own work get everything |
| **Node CRUD (`/nodes/*`, `/stories/:id/nodes`) and `/community/*` are not registered** | node CRUD wrote `uuid.Nil` into a non-null `session_id` and never checked authorship; the community stubs returned `success:true` for unimplemented likes. `StoryNode` + its repository stay, serving play sessions only — a visual author tree needs a separate `DraftNode` |
| **The browser never calls the agent** | the agent has no CORS and no auth. Go forwards `/assist/*` via `AgentClient` (180s `assistClient`) |
| **`/uploads` is mounted under `/api/v1`** | prod nginx proxies only `/api/v1/` to the backend; a bare `/uploads` would be routed to Next.js |
| **Upload type comes from sniffing the file header; SVG is excluded** | `Content-Type` and extension are caller-controlled. SVG carries inline script and we serve uploads same-origin, so accepting it is stored XSS |
| **Uploading yields only a URL** | binding is a separate save (`avatar_url` / `cover_url`) |
| **BYOK: connection is account-level, model choice is per-work** | `world_config.recommended_models` is the creator's display-only annotation, never auto-applied to a player |
| **No free fallback**: per-work user connection → platform key (only while the account has credit) → hard failure (`pkg.CodeNoLLMConfig`) | ¥1 credit at registration, metered by real token usage. Fail **before** calling the agent — it holds no default credentials and would only return an unreadable error. Math: `docs/handoff.md` §12 |
| **A storage failure is not "unconfigured"** | the resolver returns DB errors upward instead of silently falling back to the platform key — otherwise a DB blip spends platform credit and reports "you have no model configured" |
| **Publishing is the strict gate** | `PUT /stories/:id/status` strict-validates `world_config`; drafts stay lenient. `GET /stories/` (homepage) returns published only |

## Errors, Responses, Auth

| Concern | Rule |
|---|---|
| Error type | `pkg/errors.go` `AppError`: `StatusCode` (HTTP, not serialized) + `BizCode` (serialized as `error.code`) |
| HTTP helpers | `BadRequest` / `Unauthorized` / `NotFound` / `Forbidden` / `Conflict` / `Internal` |
| Business codes | `NewBusinessError(code)` / `NewBusinessErrorWithMessage`. **The allocated range is the comment block above `NewBusinessError`** — read it there, take the next free number, don't restate the list here |
| Propagation | handlers return service errors straight to `pkg.Error(c, err)`, which type-asserts and sets the status |
| JSON output | only `pkg.Success` / `Created` / `SuccessWithMeta` / `Error` / `NoContent` — never `c.JSON()`. Shape `{success, data, error, meta}` |
| Auth context | `middleware.AuthRequired(secret)` parses the Bearer JWT, sets `user_id` + `role`; read via `middleware.GetUserID(c)` / `GetRole(c)` |

**RBAC — two separate concerns, keep them separate:**

| | Role → permission | Resource ownership |
|---|---|---|
| Question | may this *role* do this action at all? | is the caller the *owner* of this row? |
| Lives in | `internal/authz` (`authz.Can`, stateless, no DB) — single source of truth | the service layer |
| Enforced by | `middleware.RequirePermission(perm)` (`RequireAdmin()` is a back-compat alias) | `requireOwner` → 403, `ownerOrNotFound` → 404 (doesn't leak existence), `checkSessionOwner` for play |
| Gotcha | role is a JWT snapshot — promotion requires re-login | every session-scoped route must verify it; this was an IDOR gap once |

## Conventions

| Convention | Rule |
|---|---|
| DTO | every model has `ToResponse()` returning an external DTO that hides sensitive fields. Handlers return DTOs, never models |
| Service inputs | the service layer defines its own input structs (`service.StoryCreateInput`), independent of handler request structs — keeps service decoupled from HTTP |
| Node tree | `StoryNode` is an adjacency list (`parent_id` + `depth`, `is_ending`). Tree queries use Postgres recursive CTEs — **never recurse in Go** |
| Attributes | creator-defined; **the backend hardcodes no field**. Stored as increments (`state_delta`); full state = initial + all deltas along the path, merged **by declared type** |
| Merge contract | `service.mergeState` (Go) and `normalize` (`agent/app/graph/story_graph.py`) **must stay aligned**; `play_merge_test.go` is the contract test — change one side, run it |
| `world_config` extension | unknown keys pass through untouched (the Go `worldConfigShape` ignores them). That's why `theme`/`tags` cost zero backend changes — **reach for a JSON key before adding a column** |

> Full attribute system — the type/delta/merge table, the `hidden` / `reveal` / `max` flags and why each exists, genre `tags` vs. colour `theme`, and `AgentClient` + `tryMerge` node dedup — is in **`docs/design.md`「属性类型分类」and「节点语义合并与去重」**. Read it before touching attributes, merging, or the play pipeline.

## Data layer

`gorm.io/driver/postgres`; module `backend`, Go 1.25; DB `story_editor` (`DB_NAME`).

| Source | Status |
|---|---|
| `AutoMigrate` over `internal/model/` | **the only thing that builds the running schema** |
| `infa/sql/` | design blueprint, **runs at no point in startup**, ahead of the Go implementation. `users` (001), `stories` (002), `play` (003), `community` (004, unimplemented). Check the relevant file before adding a module; don't mistake it for applied migrations |

Note `play_sessions.current_state` holds the full snapshot — complementary to the node tree's deltas, not a duplicate.

## Agent service (`agent/`, Python FastAPI)

Standalone process at `AGENT_URL` (default `http://localhost:8001`); see `agent/README.md`. Hard boundaries — breaking these breaks the architecture, not just a feature:

| Boundary | Why |
|---|---|
| **Never touches the database, holds no LLM credentials** | everything arrives in the request (`llm_write`/`llm_review` for play, `llm` for assist); a missing key/base_url/model raises `LLMConfigMissing` rather than falling back. The old `DEEPSEEK_*` defaults were deleted on purpose — an invisible, unmeterable server cost. Don't reintroduce one |
| **`llm_review` absent = the player turned review off** (per-work toggle, default off) | skip the audit and say so in telemetry (`review=off`) rather than pretending the draft passed |
| **Reports token usage, never money** | per-stage `usage` in the `done` frame; Go owns pricing, credit and deduction |
| **Not internet-facing** — no CORS, no auth | Go is the only caller |
| **`_stream_pipeline` in `app/graph/story_graph.py` is the only generation orchestration** | the old non-streaming langgraph graph is retired; `run_start`/`run_continue` are synchronous adapters draining the same stream. Don't add a second path |
| **Quality review must never fail the player's turn** | a rejected draft is revised by a memory-equipped writer at most `AI_REVIEW_MAX_RETRIES` times, then **delivered anyway** with `degraded=1`. Attributes are auxiliary; a flawed turn beats a blocked one |
| **`normalize` passes through keys whose type isn't declared** | lets Go's `mergeState` infer — this is what keeps pre-`attributes` works playable |

| File | Contents |
|---|---|
| `routers/generate.py` | `/generate/stream`, `/continue/stream`, `/opening/complete`, `/merge-check` |
| `routers/assist.py` | `/assist/world｜opening｜polish｜branches` |
| `schemas.py` | contract mirror of the Go DTOs |
| `llm.py` | OpenAI-compatible client. `chat_json` forces `response_format=json_object`, `chat_stream` doesn't; `_build_ephemeral` is the only constructor — per-request, uncached, no defaults |

Pipeline internals (writer beats, `<<<META>>>` JSON tail, tiered review, incremental summary + recap window): `docs/handoff.md` §6.1–6.3. Rationale and unbuilt phases: `docs/design.md`「AI agent」, `docs/context-strategy.md`.

## Frontend design system (the UI source of truth)

Read before adding or reshaping any frontend surface:

| File | Authority |
|---|---|
| `docs/design/DESIGN.md` | enforceable rules, the dual-mode decision (管理态 *management* / 阅读态 *reading*), component conventions, checklist for a new page |
| `docs/design/tokens.css` | **the single source of truth for every design variable**. Reference variables only, never hardcode; a new variable goes into `tokens.css` first, then `globals.css`. Already merged into `frontend/app/globals.css` as three layers: `:root` (管理态), `.od-reading` (阅读态), `[data-work-theme]` (per-work colours) |
| `docs/design/prototypes/*.html` | static high-fidelity references, one per screen — **visual targets, not code to copy**. Their fake data and timers demo the visuals only; behaviour always follows the backend contract |

## Not in this file

Status and roadmap, deliberately — a table here would be a second copy that goes stale. See the docs table above.

One sequencing constraint worth repeating: the agent pipeline's Phase 2/3 (separate director/recall/write nodes, RAG, per-NPC sub-agents) is **gated on real multi-turn telemetry**, not on being the next interesting thing to build.

`templates/index.html` is a leftover Gin placeholder, superseded by `frontend/`.
