# CLAUDE.md

> **Language split.** This file is English — read by Claude Code, not browsed by humans. Chinese appears only as a literal quote of something defined in a Chinese doc (a heading to search for, a domain term, seed data); don't translate those away or the pointer stops resolving. Every other doc and every reply to the user are Chinese.

## Rules

1. Reply in Chinese.
2. After a task, sync affected docs — **by editing the lines that are now wrong**, never by appending a section or rewriting the file. Especially `docs/handoff.md`; don't only update the PRD.
3. Demo stage, not launched, 0 users. Challenge the user's premises when you disagree — design, architecture, schema, scope. After finishing, ask whether it could be simpler. Proposing a rebuild of anything is fair game.
4. **A grep is a lead, not a fact.** Before writing "X is only called by Y", narrow to the actual receiver or function body. Field names collide: `PlayService` and `LLMService` both have a field named `resolver`, so a package-wide `s.resolver.*` grep credits `LLMService`'s calls to `PlayService`. The same trap applies to file counts from a too-narrow `ls`. And when a script is written to do the verifying, verify the script first — a scan that reported `PlayService` and `FindByID` as absent from the repo was collecting into an empty set; one assertion on a known-present symbol would have caught it before its output was believed.
5. **Before proposing where to intervene in a function, write out its side-effect order.** For `StartOpeningStream` that order is generate → charge → persist; a guard placed at the third step leaves the first two unprotected. Reading a function to locate one mechanism and stopping there is how a fix ends up aimed at the wrong step.
6. **Close every edit with a global re-scan, and read back what was written.** grep the terms you just changed to find the old form surviving elsewhere — decisions changed in one section routinely survive in three others. When a file was edited programmatically, re-read the changed region and check bytes, not intent (an escape like backslash-f inside a Python string once wrote a literal form feed into a shell command).
7. **A plan is a specification — audit it as one, not as a document.** Checking that paths and line numbers resolve only proves the prose isn't stale; it says nothing about whether following the plan produces code that compiles. Before handing a plan over, run three passes over it: **(a)** every type, method and signature the plan names gets checked against the actual declaration in the repo (`TestMain(m *testing.M)` has no `*testing.T`; `StoryReader` has exactly one method; `CREATE INDEX IF NOT EXISTS` is a silent no-op when the object exists); **(b)** every new capability gets its call site traced — "the executor adds `StoryCounter`; where does the call site obtain something with that method?" answers itself the moment it is asked; **(c)** every test design gets asked what state the database or process must be in for the assertion to be reachable — a setup step that creates the index makes "duplicate rows cause an error" unreachable. Plans assembled across several rounds of review are where this bites: each fragment is correct against the comment that prompted it, and nothing re-derives the whole mechanism.

## Docs

**Conflict priority**: running code / tests > `docs/handoff.md` (current facts) > this file (engineering constraints) > module README > `docs/design.md` (technical design) > `docs/prd.md` (vision).

| Where | Holds |
|---|---|
| `README.md` | session entry point: "先读什么" reading order, product snapshot, run and verification commands |
| `docs/handoff.md` | current facts: status §2, endpoints §7.1, known gaps §9.2, next §9.3, BYOK §12, theming §13, upload §14 |
| `docs/design.md` | technical design & rationale: attribute system, data flow, node merge, scaling |
| `docs/context-strategy.md` | why and how generation context uses summaries, recent raw turns, and future recall/RAG evolution |
| `docs/prd.md` | product scope, MVP priorities, roles, and open product/architecture decisions |
| `frontend/README.md` | frontend module entry: pages, state, components, API contracts, and frontend verification |
| this file §Frontend design system | UI design-system source of truth: modes, themes, tokens, component, and accessibility constraints |
| this file | invariants, boundaries, conventions — **never status** |

Before proposing or changing architecture, Agent workflows, data models, context/memory, cost/latency tradeoffs, or product scope: read `README.md` first, then the relevant sections of `docs/handoff.md`, `docs/design.md`, `docs/context-strategy.md`, and `docs/prd.md`. A code-only conclusion is insufficient for these decisions.

Docs are read every session; length is a real cost.

- **One fact, one doc.** Everywhere else links to it. About to restate a status, a route, or a rationale? Write a pointer instead.
- **Replace, don't append.** Rewrite the sentence that is now wrong. A dated "update" paragraph under a stale one is how a doc doubles in size while getting less trustworthy. Git is the changelog — a dated entry only when a *decision and its reason* must survive.
- **Keep the reason, drop the narrative.** "X because Y" earns its place; how you got to X does not. A failed experiment compresses to one line naming what was ruled out.
- **Prune while you're there.** Touching a stale section means deleting the dead part in the same pass.
- **A review is not a changelog.** When someone corrects a document, fix the claim and delete the wrong one — do not record what it used to say, why it changed, or that it was once wrong. Under review the pull is to write for the reviewer; the document belongs to whoever executes it. Test each sentence: would a reader who never saw the review need this? "Why the code must be this way" stays; "why this document changed" goes.

## Overview & Run

"AI-driven interactive story co-creation community" — users are both players and creators. Go-Gin + PostgreSQL/GORM backend; Next.js + React + Zustand frontend; Python FastAPI agent service (standalone process; generation uses the in-house streaming pipeline `_stream_pipeline`, not langgraph).

```powershell
.\scripts\dev.ps1        # all three; -Only agent | -Only backend | -Only frontend for one
```

```bash
cd backend && go run .                         # needs PostgreSQL; MUST run from backend/
cd backend && go test ./...
cd frontend && npm run lint && npm run typecheck   # lint is --max-warnings 0
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

**DI** is hand-assembled in `main.go`: config → db → repository → service → handler → routes. Startup runs `CREATE EXTENSION IF NOT EXISTS pgcrypto` (for `gen_random_uuid()`), then `AutoMigrate`. **No seeding** — a fresh database starts completely empty (no users, no works); register an account and create one. The old `seed()` ran fixture code against the production DB on every boot, deletes included.

| Invariant | Why |
|---|---|
| `NewPlayService` takes story access as **two narrow interfaces** — `StoryReader` (read) + `StoryCounter` (play-count write-back) | that pair is the seam; a concrete repo welds play to story. Keep them separate: `ports.go` calls `StoryReader` the module's *read-only* entry, and putting a write method on it makes that sentence a lie |
| `PlayService`'s five same-module deps (`sessions`/`nodes`/`ai`/`resolver`/`credit`) are narrow interfaces in `service/play_deps.go`, **not** `ports.go` | `ports.go` is the *cross-module* seam; these are same-module test seams. Mixing them blurs what `ports.go` means. Without them `play_opening_test.go` cannot assert "AI called once, charged once" |
| Play's cross-table writes go through `PlaySessionRepository.CreateNodeAndUpdateSession` / `DeleteSessionCascade` | node write + session update must be one transaction. The old `DB()` raw-connection escape hatch was removed on purpose — don't reintroduce one |

## Routes

Registered in route groups in `main.go`. **The endpoint list lives in `docs/handoff.md` §7.1** — don't duplicate it. Constraints that are expensive to rediscover:

| Constraint | Why |
|---|---|
| **`/play/*` is `AuthRequired`; no anonymous play** | every anonymous session shared the one seeded `guest` PlayerID, so `checkSessionOwner` couldn't tell two anonymous players apart — anyone could read or delete anyone's save. Gone with it: `POST /play/sessions/migrate`, `MigrateGuestSessions`, the frontend's `guestSessions`. Old guest saves stay in the DB but are unreachable, a deliberate trade. The once-seeded `guest` is now just legacy data in the existing DB (it authors the demo works there); a fresh DB has neither |
| **Drafts are author-only.** `GET /stories/:id` is `AuthOptional` | so the author can read their own draft. `canViewStory`/`canPlay` (`service/access.go`, pure, unit-tested) gate everyone else to `published` and answer **404, never 403** — a draft's existence is the author's business |
| **Unpublishing turns other players' running sessions read-only, not dead.** `storyGate` returns `playable`; `GetSession` sets `SessionResult.read_only`; every write path rejects with `readOnlyErr()` | the "reference mode" publish semantics (`docs/prd.md` §5.4.8): they can finish reading, they just can't advance. The error is 403 + a readable message rather than 404 — the player has already played this work, so hiding its existence buys nothing. Backtrack counts as a write: it rewrites `current_node_id` / `current_state`. **On the SSE routes the status is still 200** — `sseStart` commits the header before the service runs, so continue/opening deliver the message as an `event: error` frame instead. That is how every stream error behaves here; the frontend reads `detail` — and `detail` always comes from `pkg.SafeDetail`, so only an `AppError.Message` reaches the browser. **Never put a lower-level error's text into that `Message`**: `AgentClient` errors embed the agent's full response body and its internal URL |
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
| HTTP helpers | `BadRequest` / `Unauthorized` / `NotFound` / `Forbidden` / `Conflict` / `Internal`. For an internal fault the user cannot act on, use **`pkg.InternalDefault()`** — it carries the one shared Chinese fallback (`internalDetail`, `response.go`); a bespoke `Internal("...")` string ships that string to the browser |
| Business codes | `NewBusinessError(code)` / `NewBusinessErrorWithMessage`. **The allocated range is the comment block above `NewBusinessError`** — read it there, take the next free number, don't restate the list here |
| Propagation | handlers return service errors straight to `pkg.Error(c, err)`, which type-asserts and sets the status. A non-`AppError` is logged server-side and answered with a fixed message — never `err.Error()`, which carries table/column/constraint names. `pkg.SafeDetail` is the single place that decides what may go out; SSE error frames call it directly |
| Message language | every `AppError.Message` is **user-facing Chinese** — the frontend has no code→copy map (`lib/api.ts` renders `error.message` verbatim), so what is written here is what the user reads. No English, no JSON field names as subjects (`idea 不能为空`), no internal terms (env var names, routes, 端点/落库), and never a lower-level error's text |
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
| **Every synchronous LLM call inside `_stream_pipeline` must be wrapped in `await asyncio.to_thread(...)`** | it is an async generator iterated on the event loop by `StreamingResponse`, and `chat_json` → `llm.invoke()` is blocking network I/O. Call it directly and one player's structure/review stage freezes every other player's token stream in that worker. `chat_stream` is already async and must NOT be wrapped |
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

The set was replaced wholesale in `6fb2c39`. The old files (`tokens.css`, a `prototypes/` subdir) are gone, and so is the direction they encoded — **anything describing a white background, `#1677ff`, or a 管理态/阅读态 dual mode is voided**. `frontend/app/globals.css` now implements the replacement and is the only stylesheet outside per-page CSS Modules.

| File | Authority |
|---|---|
| `docs/design/DESIGN.md` | the enforceable spec: §3 global tokens · §4 hue system · §5 typography · §6 motion · §7 per-page delivery (7.1–7.13) · §8 data contract · §9 hard-constraint checklist · §10 delivery boundaries. Frontend implementation follows this file |
| `docs/design/wanxiang-design-brief.md` | direction only — why the language is what it is, and which paths are already dead. To change direction, change it here first, then land the result in `DESIGN.md` |
| `docs/design/brand-spec.md` | one-page token cheat-sheet. On conflict `DESIGN.md` wins and this gets backfilled |
| `docs/design/*.html` (13 files, flat — **no `prototypes/` subdir**) | static high-fidelity references, one per screen — **visual targets, not code to copy**. Their demo data and timers show visuals only; behaviour always follows the backend contract. `derivation-graph.html` is the one with no route behind it — see `docs/handoff.md` §13 |
| `docs/design/assets/works-data.js` | identity fields for the 12 demo works. Fake — a real surface reads `/api/v1/stories` |

**There is no `tokens.css`.** Tokens live in `DESIGN.md` §3 (global `:root`) and §4 (`.world-scope` role tokens); `frontend/app/globals.css` is their implementation, not a second source. Page-specific geometry belongs in that page's CSS Module — only genuinely shared things (tokens, reset, backdrop/sky/figure, topbar, subnav, form controls, buttons, switch, dialog, toast, the five `wx-*` keyframes) go in the global sheet.

| Invariant | Why |
|---|---|
| **Deep-space ink ground on every screen; a white background is a regression.** No mode split, no per-mode class on `<html>` | a dark ground is the physical precondition for per-work colour to read as light |
| **One `--hue` per work; every `--w-*` role token hardcodes L and C and varies only H** | otherwise changing hue collapses the lightness/saturation hierarchy |
| **`--w-*` must be declared on the element that consumes it, never `:root`** | `var()` substitutes at the declaration site — on `:root` every card locks to one hue |
| **Derived colours are `oklch()`; no hex in any stylesheet** | hex can't express the fixed-L/C-varying-H rule above |
| **Warm gold `--accent` ≤2 stable-state uses per screen, never hue-tinted** | focus rings are transient and exempt; anything else wanting emphasis uses neutral bright `oklch(0.88 0.008 265)` |

## Not in this file

Status and roadmap, deliberately — a table here would be a second copy that goes stale. See the docs table above.

One sequencing constraint worth repeating: the agent pipeline's Phase 2/3 (separate director/recall/write nodes, RAG, per-NPC sub-agents) is **gated on real multi-turn telemetry**, not on being the next interesting thing to build.

`templates/index.html` is a leftover Gin placeholder, superseded by `frontend/`.
