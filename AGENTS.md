# Agent instructions — Avantage

Read this before changing anything. These rules are binding for every agent working in this repo.

## What the app is

A map of Croatia for **end users and developers** to explore open spatial data from data.gov.hr and related
public services (WMS / WFS / WMTS). Raw OGC services are not friendly for ordinary people; this app reads them,
shows the layers on a map in a readable way, and **always says where the data comes from**.

## Hard rules

1. **Pure client-side SPA.** Everything runs in the browser and builds to static files (`npm run build` → `build/`,
   served by nginx in Docker). Do **not** add a backend, API routes, `+server.js`, `+page.server.js`,
   `hooks.server.js`, server-side proxies, or SSR. `src/routes/+layout.js` stays `ssr = false`, `prerender = true`.
2. **Talk to OGC services directly from the browser.** A service is usable only if it sends CORS headers
   (`Access-Control-Allow-Origin`). If it doesn't, report that — don't build a proxy around it.
3. **Minimal codebase.** No new files, helpers, classes, wrappers, abstractions or dependencies unless clearly
   needed. No dead code, no commented-out code, no speculative options. Prefer deleting to adding.
4. **Separation of concerns** (see the table below). Generic logic goes to `src/lib/utils.js`, never glued into a
   component or a domain module.
5. **Measure, don't guess.** Before hardcoding anything about a service or layer (sizes, ids, zoom limits), check
   the real responses (GetCapabilities, `resultType=hits`, sample GetFeature). Prefer behaviour derived
   automatically from data or capabilities over per-layer hardcoded flags.
6. **Ask the user when something is unclear** instead of assuming.

## Stack

| Thing | Choice | Notes |
|---|---|---|
| Runtime | Node **22.17+** | required by SvelteKit 3 |
| Framework | SvelteKit 3, Svelte 5 **runes** (forced in `vite.config.js`), Vite 8 | `@sveltejs/adapter-static` |
| Language | **JavaScript** (no TypeScript), ES modules | package manager: **npm** |
| Map | MapLibre GL JS 6 + OpenFreeMap `positron` style | |
| OGC client | `@camptocamp/ogc-client` | don't write your own capabilities parser |

Imports: inside `src/lib` use relative imports (`./ogc.js`); from `src/routes` use `#lib/...`
(defined in `package.json` `imports`).

## Where code goes

| File | Responsibility | Must not |
|---|---|---|
| `src/lib/sources.js` | Built-in services (`title`, `url`, optional `type`) and optional per-layer tweaks | contain logic beyond config |
| `src/lib/ogc.js` | Everything OGC: GetCapabilities, layer lists, GetMap/GetTile/GetFeature URLs, provider/attribution, legends; returns plain MapLibre source specs | import MapLibre or touch the map |
| `src/lib/map.js` | Everything MapLibre: create map, add/remove overlays, styling defaults, popups, feature diffing, view bbox | know about OGC |
| `src/lib/wfs.js` | WFS loading strategy (small vs. big layers), glues `ogc.js` + `map.js` | contain UI |
| `src/lib/utils.js` | Small domain-free helpers (escaping, bbox math, size-capped fetch) | know about OGC or MapLibre |
| `src/lib/Source.svelte` | UI for one service: layer list, toggles, status notes, legend | fetch data or build map layers itself |
| `src/routes/+page.svelte` | Page layout, sidebar, "add service" form, map container | contain map/OGC logic |

## Data loading rules (don't break these)

**WFS** (`src/lib/wfs.js`)
- When a layer is turned on, its whole content is downloaded with a **100 KB cap** (`SMALL_BYTES`, enforced while
  streaming via `fetchText`). If it finishes under the cap, the layer is kept in memory and never refetched.
  Otherwise the layer switches to viewport mode and that decision is remembered.
- Viewport mode: request only the current view grown **1.2×** (`VIEW_SCALE`) with a `BBOX` in EPSG:4326 lon/lat.
  Don't refetch while the view stays inside the last complete response. Abort stale requests on every new one.
- Per-view limits: **5000 features** (`MAX_FEATURES`) and **4 MB** (`VIEW_BYTES`). Over the limit, show the
  "približi kartu" note instead of loading more.
- Updating the map: **never** replace all features. Use `syncFeatures` (MapLibre `updateData`) to remove only the
  features that disappeared and add only the new ones, keyed by feature `id`.
- GeoServer feature ids (`layer.123`) are stable and are used as-is. If a layer's ids are generated per request
  (`layer.fid-…`), add an `id` hook for it in `sources.js` using a real key property.
- Features are requested as GeoJSON in EPSG:4326 (`outputCrs`), which MapLibre expects.

**WMS** (`src/lib/ogc.js`)
- Rendered as 256 px raster tiles in EPSG:3857 using the `{bbox-epsg-3857}` template; the browser and MapLibre
  cache tiles, so don't replace tiles with a single per-view image.
- `wmsZooms` turns the layer's `Min/MaxScaleDenominator` into the source's `minzoom`/`maxzoom`, so MapLibre skips
  empty requests and **enlarges the last real tiles** beyond the server's limit (e.g. Hrvatske vode flood maps).
  Remember: for 256 px tiles, MapLibre requests tile zoom ≈ map zoom + 1.
- Show the layer's legend (`legendUrl`) when it is on.

**WMTS**
- Only layers with an EPSG:3857 tile matrix set starting at zoom 0 can be shown (MapLibre is Web Mercator only).

## Per-layer tweaks (`sources.js` → `layers`)

Keep these to what cannot be inferred automatically. Supported keys:
- `id(feature)` — stable feature key when the server's ids change between requests.
- `paint` — MapLibre paint overrides per kind: `{ fill, line, circle }` (e.g. habitat map coloured by NKS class).

New tweak types must be generic (applied by `map.js`/`wfs.js`), not special-cased per source in code.

## Adding a built-in service

1. Check GetCapabilities and a GetMap/GetFeature request in the browser or with curl: CORS header present,
   WMS/WMTS works in EPSG:3857.
2. Add one entry to `sources.js` (`title` in Croatian, `url`, `type`). Nothing else should be needed.
3. For WFS, check sizes (`resultType=hits`, sample responses) and whether ids are stable; add hooks only if needed.
4. Test it in the running app (see Verification).

## UI and language

- UI text is **Croatian** and short; less text is better. Explanations for users will be added deliberately later.
- Code, identifiers and comments are **English**. Comments explain *why*, briefly.
- Always show the data provider (from GetCapabilities) and link to the GetCapabilities document; MapLibre
  attribution carries the provider too.
- `localStorage` is only for per-user conveniences (e.g. custom services) and every access is wrapped in
  `try/catch`.

## Known pitfalls

- MapLibre 6 must get its worker via `setWorkerUrl(...?url)` in `map.js`; without it the map is blank after bundling.
- `vite.config.js` marks `ol/*` external because ogc-client lazily imports OpenLayers; never call
  `getOpenLayersTileGrid` and don't add `ol`.
- `WmtsEndpoint` has no `getCapabilitiesUrl()`; `inspect` stores `capabilitiesUrl` for all types.
- Don't pass a format hint to ogc-client's WMTS `getLayerResourceLink`/`getTileUrl` (it crashes when the format is
  missing).
- Some Bioportal layers are huge (up to ~840k features; the 2016 habitat map is ~8 MB for a city-sized view).
  Never load a WFS layer without the size caps above.

## Verification

- `npm run build` must pass without errors.
- Run the dev server (`npm run dev`, or the `dev` entry in `.claude/launch.json`) and check the change in a
  browser: layers toggle, no console errors, network requests look as intended.
- Docker build (`docker compose up --build`) should keep working; it serves `build/` via `nginx.conf`.

## Git

- Work on a branch and open a PR into `main`; don't commit directly to `main`.
- Commit messages in **Croatian**, matching the history.
- **No AI attribution**: no `Co-Authored-By` trailers for AI tools and no "Generated with …" lines in commits or PRs.
- Don't commit `node_modules/`, `build/`, `.svelte-kit/` or IDE folders (`.idea/`).
