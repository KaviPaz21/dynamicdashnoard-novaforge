# NovaForge - fire-safety insight copilot

NASA Space Apps 2026 challenge: an interactive, AI-powered dashboard that summarises, ranks and
interprets microgravity fire research. A Power BI-style dashboard (70%) with an embedded copilot (30%).

```
FE/  Next.js 16 + Tailwind 4 + ECharts + Leaflet       -> http://localhost:3000
BE/  FastAPI + LangGraph + Azure Cosmos DB + LLM       -> http://localhost:8100
```

## Run it

```powershell
# backend
cd BE
python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env        # then fill in the endpoints / keys
.\.venv\Scripts\python -m uvicorn app.main:app --port 8100 --reload

# frontend (new terminal)
cd FE
npm install
npm run dev
```

Everything configurable lives in `BE/.env` (Cosmos endpoint/key, LLM + embedding endpoints, model names, limits)
and `FE/.env.local` (`NEXT_PUBLIC_API_URL`). With `COSMOS_ENDPOINT` empty the API uses an in-memory store
(data is lost on restart); the header shows which store is active.

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
load_context -> route -> plan_widgets -> execute_queries -(errors? replan once)-> [retrieve_docs] -> synthesize
```
`route` classifies intent (dashboard, modify_dashboard, data_analysis, document_qa, hybrid, general) and decides
whether KPIs are needed at all, whether tables must be queried, whether documents must be searched.
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

## API (prefix `/api`)
`GET /health` · `POST /sources/upload` · `GET /sources` · `GET /sources/{id}` · `GET /sources/{id}/preview` ·
`DELETE /sources/{id}` · `GET|PUT /semantic-model` · `POST /query` · `POST /chat` · `POST /chat/stream` ·
`GET /conversations` · `GET|DELETE /conversations/{id}` ·
`GET|POST /dashboards` · `GET|PUT|DELETE /dashboards/{id}` · `POST /geo/resolve`

Tables are read from Cosmos once and cached in the API process (invalidated on upload/delete), so a dashboard's
dozen queries do not each re-scan the table. Run a single API worker, or move the cache out of process first.

## Troubleshooting
- **Page looks unstyled (cards stacked, charts blank, your own chat message unreadable):** the Next dev server is
  serving a stale stylesheet. Stop it, delete `FE/.next`, run `npm run dev` again.
- **"API offline" in the header:** make sure the NovaForge API (not another app) is on the port in `FE/.env.local`;
  `http://localhost:8100/api/health` should return `{"status":"ok", ...}`.

## Tests
`cd BE; .\.venv\Scripts\python -m pytest` - ingestion, schema inference, query engine, cross-filter
propagation, the chat graph with a scripted LLM (including the planner retry) and the HTTP API, all on the
in-memory store.

## Assumptions to confirm
- The LLM (`gpt-6-luna`) is called through an OpenAI-compatible chat-completions endpoint with tool/function
  calling (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`). Embeddings use the same style of endpoint.
- `EMBEDDING_DIMENSIONS` must match the embedding model; it is fixed in the Cosmos vector policy when the
  `chunks` container is created.

## Credits
- Icons: [Flaticon UIcons](https://www.flaticon.com/uicons) (solid, rounded) via the @flaticon/flaticon-uicons package, used under the Flaticon licence, which requires crediting Flaticon (credited in the app's sidebar).
- Map shapes: us-atlas and world-atlas (Natural Earth / US Census); place names: GeoNames via geonamescache.
