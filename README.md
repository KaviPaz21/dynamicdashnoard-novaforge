# NovaForge - fire-safety insight copilot

NASA Space Apps 2026 challenge: an interactive, AI-powered dashboard that summarises, ranks and
interprets microgravity fire research. A Power BI-style dashboard (70%) with an embedded copilot (30%).

```
FE/  Next.js 16 + Tailwind 4 + ECharts + Leaflet       -> http://localhost:3000
BE/  FastAPI + LangGraph + Azure Cosmos DB + LLM       -> http://localhost:8001  (any free port, see FE/.env.local)
```

## Run it

```powershell
# backend
cd BE
python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env        # then fill in the endpoints / keys
.\.venv\Scripts\python scripts\gen_secrets.py   # JWT secret, transport signing key pair, first admin (prints the password once)
.\.venv\Scripts\python -m uvicorn app.main:app --port 8001 --reload   # any free port; keep it in sync with FE/.env.local

# frontend (new terminal)
cd FE
npm install
npm run dev
```

Everything configurable lives in `BE/.env` (Cosmos endpoint/key, LLM + embedding endpoints, model names, limits,
secrets) and `FE/.env.local` (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SECURE_SIGNING_PUBKEY`). With `COSMOS_ENDPOINT` empty
the API uses an in-memory store (data is lost on restart); the sidebar shows which store is active.

Install the dependencies into **the Python you start the API with** (`pip install -r BE/requirements.txt`); sign-in,
the encrypted transport and PDF export need `cryptography`, `PyJWT` and `reportlab`.

Try it with the synthetic demo data in `BE/sample_data/` (clearly labelled synthetic, not real NASA results).
`python BE/scripts/make_sample_data.py` regenerates it.

## How it works

### Ingestion agent (LangGraph) - `BE/app/agents/ingest_graph.py`
Uploads are routed by what they are:

| Upload | Pipeline |
|---|---|
| CSV / TSV / XLSX (one table per sheet) / JSON | parse -> infer types, roles (measure, dimension, date, geo, id), stats -> LLM writes a description and per-column notes -> rows stored one document per row in Cosmos (`rows`, partition `/source_id`) -> relationships to other tables detected |
| PDF / DOCX / TXT / MD | extract text -> chunk with overlap -> embed -> stored with a vector index (`chunks`) -> LLM summary + topics |

The schema, description and stats live in the `sources` catalog; the agents read that catalog to plan queries.

### Chat orchestrator (LangGraph) - `BE/app/agents/chat_graph.py`
```
load_context -> guard -(flagged & refused)-> finalize_blocked -> END
                  |
                  v
            select_data -> route -> plan_widgets -> execute_queries -(errors? replan once)-> [retrieve_docs] -> synthesize
```
- `guard` (`agents/guard.py`) is the safety node: regexes for known prompt-injection / jailbreak / system-prompt
  extraction phrasings plus an LLM classifier for hate speech, harassment, sexual content, violence, self-harm, illegal
  activity and malicious code. Medium/high severity is refused with a fixed reply and nothing else runs; low severity is
  answered but flagged. Every flagged prompt is stored with the user, time, prompt, the model's reply, categories and
  severity, and shows up for administrators (Admin -> Flagging, unread count on the Admin button).
- `select_data` decides which kind of knowledge the request needs, because they are searched differently: **tables**
  (filters/grouping/aggregation, planned and executed as queries) versus **documents** (semantic chunk retrieval, with
  a query rewrite and second search when the best match is weak). It can pick both, or neither, and which sources.
- `route` classifies intent (dashboard, modify_dashboard, data_analysis, document_qa, hybrid, general) and decides
  whether KPIs are needed at all, constrained by what the selector chose.

The agents stream what they are doing as `trace` events over the same SSE connection (safety result, knowledge chosen
and why, thinking, every query with rows/ms, retries with the errors being fixed, retrieved passages with scores); the
chat shows them live and keeps them with each answer ("how I got this").
The planner emits typed widget specs; they are executed and their encodings repaired against the real output
columns before anything reaches the UI. `synthesize` writes the grounded answer with citations, key insights
and follow-up suggestions. `POST /api/chat/stream` streams the agent's steps as server-sent events.

### Dashboard & semantic model - `FE/src/components`
Widgets: KPI card (value, change vs previous period, sparkline), bar, column, stacked bar/column, line, area,
pie, donut, treemap, funnel, scatter, bubble, heatmap, radar, gauge, table, matrix, map, slicer (list / dropdown /
numeric range / date range), insight.

- **Canvas:** a 12-column grid like a Power BI report page. Drag a tile by its title, resize it from the
  bottom-right corner; KPI figures and sparklines scale with the tile.
- **Cross-filtering:** click any mark to filter the whole dashboard; slicers filter everything. Filters travel through
  the **semantic model** (`relationships` between tables, auto-detected by column name and editable), so a slicer on
  one table also filters visuals built on a related table.
- **Copilot widget:** closed, it is a borderless Siri-style orb bottom-right: a circle of slow blue smoke with cyan,
  pink and purple wisps, soft colour blobs orbiting inside, a gentle float/breathe and a glow that drifts
  blue -> purple -> cyan (it churns faster while the agent works, and pings when an answer arrived while closed). Opening it hides the
  orb and docks the chat at full height inside the page's 12px margins, level with the sidebar, so it never covers the
  dashboard's controls (close with X or Esc; the arrows make it wider). Asking from a suggestion or starter opens it automatically.- **Shell:** a collapsible left sidebar holds the views (Dashboard, Data), your previous sheets (most recently
  saved first) and the light/dark toggle; its state is remembered. The bar above the canvas shows the open
  sheet's name (click to rename), the filters applied on it, and a **Save** button (also Ctrl+S).
- **Sheets:** every dashboard is a saved *sheet* in the Cosmos `dashboards` container, saved together with its
  layout, visuals and **applied filters**, so reopening a sheet restores exactly what you left. Changes
  autosave shortly after you make them (the Save button shows unsaved / saving / saved). A new
  "build me a dashboard" request opens a new sheet, follow-up edits change the current one. Query results are
  never stored, they are re-queried on open.
- **Theme:** modelled on the Saaslu reference dashboard, with colours sampled from the image: lavender page
  (#EDEEF7), white cards with soft shadows, a floating steel-blue sidebar (#477B99 -> #4E80A0), teal (#009688),
  mint/soft-red change chips and near-black ink (#0E0C14); its orange promo card is deliberately not used. Light is the
  default; dark is the same steel-blue family on deep teal-navy. UI colours are CSS tokens in
  `FE/src/app/globals.css`; charts and maps draw on canvas and read the same palette from `FE/src/lib/palette.ts`
  (keep the two in sync). Chart series use six hues (no orange/yellow) in an order checked for colour-blind
  separation with the dataviz validator. The choice is remembered and applied before first paint.
- Each visual can be switched to a related chart type, viewed as a table, focused full screen, or removed.
- **Maps understand place *names*, not just coordinates.** On upload, a text column is recognised as countries,
  US states or cities from its **values** (whatever it is called: `Origin`, `Hub`, `State`...), and a text column of
  `"lat, lon"` pairs is split into latitude/longitude columns. The planner then builds a filled map for countries and
  states, bubbles for cities (a state/country column disambiguates "Springfield"), or points for coordinates.
  Everything is offline: names resolve through the bundled GeoNames data (`geonamescache`) and shapes come from the
  `us-atlas` / `world-atlas` npm packages, so there is no tile server or API key. Tables uploaded before this
  feature are backfilled when the API starts. Unrecognised names are reported on the map ("3 of 49 not recognised").

## Accounts, roles and knowledge
- **Sign-in:** email + password -> a signed token (JWT, 8 h, renewed while you work, revoked on sign-out). Passwords
  are stored only as scrypt hashes (salted, memory-hard). Five failed attempts lock that email/IP for 15 minutes.
  The first administrator is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` when the user table is empty
  (`scripts/gen_secrets.py` fills these in). Accounts made by an admin get a one-time temporary password and must
  choose their own at first sign-in.
- **Roles are enforced by the API, not the UI.** Every `/api/admin/*` route depends on `require_admin`, which re-reads
  the user from the database on each request (role and active flag are never taken from the token; a role change,
  deactivation or password reset bumps the user's token version and ends their sessions immediately). The Admin
  button is rendered from the server-provided role and its code is only downloaded by administrators, but hiding it
  is not what protects anything. The last active admin cannot be demoted, deactivated or deleted, and nobody can
  delete or demote themselves.
- **Admin popup:** Add users (name, email, role; temporary password shown once), Manage users (list by name and ID;
  role, last active, usage: prompts, sessions, tokens in/out, flags, uploads; activate/deactivate, change role, reset
  password, delete), Flagging (users with flagged prompts -> prompt, flag, model response, metadata, mark reviewed),
  Global knowledge (the full Data manager, for everyone's shared knowledge).
- **Knowledge:** *Data* is your **local** knowledge, visible only to you (not even to admins). *Global* knowledge is
  uploaded by admins and readable by everyone. *Knowledge* is a read-only view of both. In the chat header choose
  **Both / Local / Global**: the API builds what the assistant may use from that setting and your permissions; ids
  sent by the browser are never trusted. Files attached to a chat (paperclip) are always included for that chat.
- **Chats:** history sidebar in the copilot (auto-named from the first message, deletable), a column of dots on the
  right to jump between your prompts (the prompt you're looking at is shown while scrolling), export as PDF (logo,
  diagonal NovaForge watermark and a "for reference only" notice on every page). Sheets and chats are per user.
- The assistant knows the signed-in user's name; the sidebar shows your name and user ID, with Sign out.
- Deleting a source is quick: it disappears at once and is removed from every sheet and relationship, the row
  documents are purged in the background (and finished on the next start if the API restarts mid-way).

## Encrypted transport (frontend <-> API)
Passwords, tokens and every payload are encrypted at the application layer on top of whatever TLS you deploy with:
1. **Handshake** - the browser makes an ephemeral **ECDH P-256** key pair; the API answers with its own ephemeral key,
   a random salt and an **ECDSA P-256 signature** (long-term key, public half pinned in the browser build as
   `NEXT_PUBLIC_SECURE_SIGNING_PUBKEY`) so a man in the middle cannot substitute keys. Both derive two **AES-256-GCM**
   keys with **HKDF-SHA256**. Fresh keys per session give forward secrecy.
2. **Every call** goes through `POST /api/secure/call`; method, path, query, bearer token and body (JSON, multipart
   uploads, anything) are inside one AES-GCM ciphertext. A timestamp bound into the GCM authentication data (+/- 5
   min) and a per-session nonce cache stop replays and tampering. Replies, including downloads such as the PDF, are
   sealed the same way, and server-sent event streams are sealed frame by frame.
3. Plaintext access to the API is refused (`SECURE_TRANSPORT=required`, the default); only `/health` and the handshake
   are open. `optional` / `off` exist for debugging.

Limits worth knowing: this protects the content and the token on the wire, not metadata such as request sizes and
timing; it needs WebCrypto, i.e. `https://` or `http://localhost`; and it complements, not replaces, TLS in
production (also serve the API over HTTPS and set `CORS_ORIGINS`). Implementation: `BE/app/security/transport.py`,
`FE/src/lib/secure.ts`; the test suite contains an independent client that checks nothing readable crosses the wire.

## API (prefix `/api`)
Public: `GET /health` · `POST /secure/handshake` · `POST /auth/login`.
Everything else is called through `POST /secure/call` and needs a bearer token:
`/auth/{me,refresh,logout,change-password}` · `GET /system` · `GET /sources?scope=all|mine|global` ·
`POST /sources/upload?visibility=private|global&conversation_id=` · `GET /sources/{id}[/preview]` · `DELETE /sources/{id}` ·
`GET|PUT /semantic-model` · `POST /query` · `POST /chat` · `POST /chat/stream` · `GET /conversations` ·
`GET|DELETE /conversations/{id}` · `GET /conversations/{id}/export` (PDF) · `GET|POST /dashboards` ·
`GET|PUT|DELETE /dashboards/{id}` · `POST /geo/resolve`.
Admin only: `/admin/users[/{id}[/reset-password]]` · `/admin/flags[/users|/summary|/{id}]`.

Tables are read from Cosmos once and cached in the API process (invalidated on upload/delete), so a dashboard's
dozen queries do not each re-scan the table. Run a single API worker, or move the cache out of process first.

## Troubleshooting
- **Page looks unstyled (cards stacked, charts blank, your own chat message unreadable):** the Next dev server is
  serving a stale stylesheet. Stop it, delete `FE/.next`, run `npm run dev` again.
- **"API offline" / sign-in says it can't reach the server:** make sure the NovaForge API (not another app) is on the
  port in `FE/.env.local`; `<that url>/health` should return `{"status":"ok", ...}`. After changing `.env.local`
  restart `npm run dev`.
- **"The server's identity could not be verified":** `NEXT_PUBLIC_SECURE_SIGNING_PUBKEY` in `FE/.env.local` doesn't
  match `SECURE_SIGNING_KEY` in `BE/.env` (both come from `scripts/gen_secrets.py`). Restart the frontend after fixing.
- **"Secure session expired" flashes after an API restart:** normal, the browser silently re-handshakes and retries.
- **PDF export says 501:** `pip install reportlab` in the Python that runs the API.

## Tests
`cd BE; .\.venv\Scripts\python -m pytest` - ingestion, schema inference, query engine, cross-filter
propagation, the chat graph with a scripted LLM (planner retry, selector before router), sign-in and token
revocation, admin-only enforcement, per-user isolation of knowledge/sheets/chats, the safety node, chat history,
PDF export and the encrypted transport (replay, tamper, clock, session, SSE, multipart), all on the in-memory store.

## Assumptions to confirm
- The LLM (`gpt-6-luna`) is called through an OpenAI-compatible chat-completions endpoint with tool/function
  calling (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`). Embeddings use the same style of endpoint.
- `EMBEDDING_DIMENSIONS` must match the embedding model; it is fixed in the Cosmos vector policy when the
  `chunks` container is created.

## Credits
- Icons: [Flaticon UIcons](https://www.flaticon.com/uicons) (solid, rounded) via the @flaticon/flaticon-uicons package, used under the Flaticon licence, which requires crediting Flaticon (credited in the app's sidebar).
- Map shapes: us-atlas and world-atlas (Natural Earth / US Census); place names: GeoNames via geonamescache.
