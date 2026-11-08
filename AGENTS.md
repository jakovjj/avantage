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
   (`Access-Control-Allow-Origin`). If it doesn't, report that — don't build a proxy around it. The one exception
   is a `snapshot`: a saved GetFeature response shipped with the app, only where the user decided so (see Snapshots).
3. **Minimal codebase.** No new files, helpers, classes, wrappers, abstractions or dependencies unless clearly
   needed. No dead code, no commented-out code, no speculative options. Prefer deleting to adding.
4. **Separation of concerns** (see the table below). Generic logic goes to `src/lib/utils.js`, never glued into a
   component or a domain module.
5. **Measure, don't guess.** Before hardcoding anything about a service or layer (sizes, ids, zoom limits), check
   the real responses (GetCapabilities, `resultType=hits`, sample GetFeature). Prefer behaviour derived
   automatically from data or capabilities over per-layer hardcoded flags.
6. **Ask the user when something is unclear** instead of assuming.
7. **Minimal UI.** No explanatory text, taglines, hints, section headings, footers or decoration. See "UI and
   language" — this is enforced, not a suggestion.
8. **NO committing ahead of time.** When a change is done, tell the user what changed and ask them to test it.
   Commit only after the user says they are satisfied and tells you to commit.
9. **NEVER push to `main`.** Always work on a branch and open a PR into `main` when the work is done.

## Stack

| Thing | Choice | Notes |
|---|---|---|
| Runtime | Node **22.17+** | required by SvelteKit 3 |
| Framework | SvelteKit 3, Svelte 5 **runes** (forced in `vite.config.js`), Vite 8 | `@sveltejs/adapter-static` |
| Language | **JavaScript** (no TypeScript), ES modules | package manager: **npm** |
| Map | MapLibre GL JS 6 + OpenFreeMap `positron` style | |
| OGC client | `@camptocamp/ogc-client` | don't write your own capabilities parser |
| Photo lightbox | Viewer.js 1 | in ready layers' panels: free zoom (GLightbox only zooms to the photo's pixel size); transitions off |

Imports: inside `src/lib` use relative imports (`./ogc.js`); from `src/routes` use `#lib/...`
(defined in `package.json` `imports`).

## Where code goes

| File | Responsibility | Must not |
|---|---|---|
| `src/lib/sources.js` | Built-in services (`title`, `url`, optional `type`) and optional per-layer tweaks | contain logic beyond config |
| `src/lib/ogc.js` | Everything OGC: GetCapabilities, layer lists, GetMap/GetTile/GetFeature URLs, provider/attribution, legends; returns plain MapLibre source specs | import MapLibre or touch the map |
| `src/lib/map.js` | Everything MapLibre: create map, add/remove overlays, styling defaults, popups, feature diffing, view bbox | know about OGC |
| `src/lib/wfs.js` | WFS loading strategy (small vs. big layers), glues `ogc.js` + `map.js` | contain UI |
| `src/lib/utils.js` | Small domain-free helpers (escaping, bbox math, size-capped fetch, running-download counter) | know about OGC or MapLibre |
| `src/lib/Source.svelte` | UI for one service: layer list, toggles, status notes, legend, "`<TYPE>` endpoint" link | fetch data or build map layers itself |
| `src/lib/panels/*.svelte` | Hand-designed details panel of one ready layer, given the clicked feature's `properties` | fetch data or touch the map |
| `src/lib/snapshots/*.json` | Saved WFS GetFeature responses for `snapshot` layers, exactly as the server sent them | be edited by hand |
| `src/routes/+page.svelte` | Page layout, sidebar, "add service" form, map container, debug readout | contain map/OGC logic |

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
- Rendered as 512 px raster tiles (`WMS_TILE`; servers render each tile on request, so fewer bigger tiles load
  faster) in EPSG:3857 using the `{bbox-epsg-3857}` template; the browser and MapLibre cache tiles, so don't replace
  tiles with a single per-view image. Rasters sit under the basemap labels at 0.8 opacity.
- Not every server is faster with 512 px: measure. Bioportal's sensitivity maps take ~7 s per 512 px tile of
  Croatia but ~1.2 s per 256 px one, so they use `tileSize: 256` (all of Croatia 6.8 s → 4.4 s).
- `wmsZooms` turns the layer's `Min/MaxScaleDenominator` into the source's `minzoom`/`maxzoom`, so MapLibre skips
  empty requests and **enlarges the last real tiles** beyond the server's limit (e.g. Hrvatske vode flood maps).
  Remember: for 512 px tiles, MapLibre requests tile zoom ≈ map zoom.
- Show the layer's legend (`legendUrl`) when it is on.

**WMTS**
- Only layers with an EPSG:3857 tile matrix set starting at zoom 0 can be shown (MapLibre is Web Mercator only).

## Per-layer tweaks (`sources.js` → `layers`)

Keep these to what cannot be inferred automatically. Supported keys:
- `id(feature)` — stable feature key when the server's ids change between requests.
- `paint` — MapLibre paint overrides per kind: `{ fill, line, circle }` (e.g. habitat map coloured by NKS class).
- `group` — sidebar group title when it can't come from the `Group - layer` title prefix.
- `minZoom` — map zoom below which the layer is neither drawn nor requested.
- `details` — labelled fields shown first in the right-hand details panel: `{ fields: [{ keys, label }] }`; all other
  non-empty properties follow under their keys.
- `heatmap` — WMS URL; the layer is drawn as that server's rendered image instead of WFS features. For grids that
  are far too big as vectors (Bioportal sensitivity maps are a few dissolved polygons of several MB each).
- `hide` — leave the layer out of the sidebar (e.g. its data is shown from another service instead).
- `panel` — Svelte component (`src/lib/panels/`) replacing the properties table in the details panel.
- `loadAll` — WFS only: download the whole layer once, without the 100 KB cap, and never switch to viewport mode.
  Only after measuring that the full download is acceptable (compressed size, time).
- `images` — `{ name: SVG markup }` icons for `symbol`, drawn at half the SVG's pixel size so their edges stay sharp.
- `symbol` — `{ layout, paint }` of one extra MapLibre symbol layer on top of the layer's own: icons (markers circles
  can't draw, e.g. triangles) and labels (`text-font` must be a basemap font: `Noto Sans Regular/Bold/Italic`).
- `snapshot` — WFS only: URL (`import … from './snapshots/<layer>.json?url'`) of a saved GetFeature response, loaded
  whole instead of asking the server. For small layers whose server is very slow. See Snapshots.
- `tileSize` — WMS tile size in px (default 512).
- `exclusive` — key shared by layers of which only one may be on: turning one on turns the others off (the 11
  Bioportal sensitivity maps, which cover all of Croatia, share `group: 'Osjetljivost'` and `exclusive`). They keep
  checkboxes, so the active one can still be turned off.
- `overview` — WMS: `{ url, bounds: [w, s, e, n], maxZoom }`, a saved image of the whole layer (`./snapshots/*.png?url`)
  shown below `maxZoom` instead of the server's tiles, for layers the server renders very slowly when zoomed out. The
  tiles' source starts at `maxZoom` (not their layer), so it stays in use and the provider stays credited. See
  Snapshots.

New tweak types must be generic (applied by `map.js`/`wfs.js`/`Source.svelte`/the page), not special-cased per
source in code.

## Ready layers

Layers the user has designed by hand, one by one: own colours, own details panel, sometimes shown from one service
only. Their config sits in the "Ready layers" block at the top of `sources.js`. **Don't change them** unless the user
asks; every other layer keeps the automatic defaults. Add a layer here when the user says its design is done.

- **Lokacije odbačenog otpada** (AZO) — WFS only (`otpad:odbaceni_otpad`; the WMS layer is hidden), `loadAll`
  (14,195 points, 1.35 MB gzipped). Dots coloured by
  `status_lokacije_otpada` like the AZO WMS style; panel `OdbaceniOtpad.svelte` (status, place, description, waste
  type/amount/area, photo grid with Viewer.js; dot size by kg on a log scale).
- **Odlagališta otpada** (AZO) — WFS only (`otpad:v_odlagalista_geom`; the WMS layer is hidden), from a `snapshot`
  (317 points, 28 KB gzipped; the server takes ~11 s to start answering). Markers and names copied from the AZO WMS style via `images` + `symbol`: red triangle for `aktivno`,
  green circle for `zatvoreno`, cyan circle for `zatvoreno ex-situ` (otpad uklonjen); bold name with a white halo.
  Marker size by `kolicina_odlozenog_otpada` (tonnes) on a log scale, the biggest drawn underneath. Panel
  `Odlagaliste.svelte`: name, status with its marker, place, deposited amount, remediation, permit, data year,
  manager. Of the other fields, the `_tone` breakdowns, `zadnja_izmjena` and `izvjestajno_razdoblje` are empty.

## Snapshots

A snapshot replaces a slow WFS request with a copy of its response in `src/lib/snapshots/`, built into the app and
served gzipped by nginx (a WMS `overview` image likewise replaces the zoomed-out tiles). The layer still appears under its service (GetCapabilities and the attribution come from the
server); only its features come from the file. Snapshots go stale: **refresh them from time to time**, and whenever
the user asks, by downloading the same request the app would make and replacing the file unchanged:

```bash
curl -o src/lib/snapshots/v_odlagalista_geom.json "https://servisi.azo.hr/otpad/wfs?SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0&TYPENAMES=otpad%3Av_odlagalista_geom&OUTPUTFORMAT=application%2Fjson&SRSNAME=EPSG%3A4326"
```

The file's `timeStamp` field says when it was taken. Then check the app (markers, details) and commit.

An `overview` image is a WMS GetMap of the layer's `bounds` (here 13.4–19.55° E, 42.3–46.6° N) in EPSG:3857, at the
resolution of `maxZoom` (zoom 8: 305.75 m/px → 2239 × 2195 px), as an 8-bit PNG (0.75–1 MB). Bioportal needs 8–25
s per image. The `BBOX` is those bounds in Web Mercator metres; changing `bounds` or `maxZoom` means recomputing it and the
size:

```bash
for l in ocjena_priroda_solar ocjena_priroda_vjetar osjetljivost_stanista ascii_osjetljivost_sismisi_solar_import ascii_osjetljivost_sismisi_vjetar ascii_osjetljivost_vrsta_solar ascii_osjetljivost_vrsta_vjetar; do curl -o src/lib/snapshots/$l.png "https://services.bioportal.hr/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png8&TRANSPARENT=TRUE&CRS=EPSG:3857&STYLES=&LAYERS=$l&BBOX=1491681.18,5206024.46,2176296.05,5877026.55&WIDTH=2239&HEIGHT=2195"; done
```

| File | Layer | Taken |
|---|---|---|
| `v_odlagalista_geom.json` | AZO Odlagališta otpada | 2026-11-08 |
| `ocjena_priroda_solar.png` | Bioportal Karta osjetljivosti prirode - solar (overview) | 2026-11-08 |
| `ocjena_priroda_vjetar.png` | Bioportal Karta osjetljivosti prirode - vjetar (overview) | 2026-11-08 |
| `osjetljivost_stanista.png` | Bioportal Osjetljivost staništa (overview) | 2026-11-08 |
| `ascii_osjetljivost_sismisi_solar_import.png` | Bioportal Osjetljivost šišmiši - solar (overview) | 2026-11-08 |
| `ascii_osjetljivost_sismisi_vjetar.png` | Bioportal Osjetljivost šišmiši - vjetar (overview) | 2026-11-08 |
| `ascii_osjetljivost_vrsta_solar.png` | Bioportal Osjetljivost skupno - solar (overview) | 2026-11-08 |
| `ascii_osjetljivost_vrsta_vjetar.png` | Bioportal Osjetljivost skupno - vjetar (overview) | 2026-11-08 |

## Adding a built-in service

1. Check GetCapabilities and a GetMap/GetFeature request in the browser or with curl: CORS header present,
   WMS/WMTS works in EPSG:3857.
2. Add one entry to `sources.js` (`title` in Croatian, `url`, `type`). Nothing else should be needed.
3. For WFS, check sizes (`resultType=hits`, sample responses) and whether ids are stable; add hooks only if needed.
4. Test it in the running app (see Verification).

## UI and language

- UI text is **Croatian** and as short as possible; less text is better. Explanations for users will be added
  deliberately later, by the user — never add them on your own.
- **Not allowed** in the UI: subtitles/taglines (e.g. "Otvoreni prostorni podaci Hrvatske"), section headings
  (e.g. "Dodaj servis"), hint paragraphs (e.g. "Podržani su WMS, WFS i WMTS…"), footers or credits in the sidebar,
  logos, counters/badges, spinners, empty-state prose. The one loading indicator is the green bar below.
- **CSS stays small and plain**: native form controls (no custom checkboxes), no rounded corners, no shadows,
  gradients, animations or transitions, no colour themes/variables. A few lines per component is the target.
- Sidebar: `Avantage` title, the URL form, then one `<details>` per service. A service links to its
  GetCapabilities document with the text **`<TYPE> endpoint`** (e.g. "WFS endpoint"), nothing more.
- The data provider (from GetCapabilities) is credited in the MapLibre attribution, not in the sidebar.
- A layer row has an (i) after its type icon only when GetCapabilities gives an **official** description (`about` in
  `ogc.js`): an abstract that says more than the title (not the title again, "null", or the service's abstract); a
  metadata link alone isn't enough. It opens a box over the map, beside the sidebar and level with the row (one at a
  time; a click outside or Escape closes it): the layer's title, that text and "Više" with a new-tab icon linking to
  the metadata record (NIPP geoportal page), otherwise a "`<TYPE>` endpoint" link. Never write our own texts there. The NIPP records can't be read from the browser (the
  geoportal sends `Access-Control-Allow-Origin: *, *`, which browsers reject), so they are only linked.
- Numbers shown to users go through `formatNumber` (`utils.js`): thousands split by a thin space ("9 700 000"),
  **never a dot or comma** (they read as decimals); the decimal mark is a comma ("0,3").
- Details panel (right): a ready layer's own `panel`, otherwise the properties table. A panel starts with a small
  grey type label (`<h5>`, e.g. "Odlagalište otpada") above its heading, so it's clear what was clicked. The "Google Maps" link (points
  only) is centred and stuck to the bottom of the panel, also while its content scrolls.
- Each layer row has a small grey icon after its name showing its map type (markers / lines / areas / heatmap / image), derived from
  the service: one `DescribeFeatureType` per WFS (a sample feature when the schema says only "geometry").
- The map is limited to Croatia (`maxBounds`). `croatiaStyle` in `map.js` rewrites the basemap style before the first
  frame: no tiles beyond `maxBounds`, outside Croatia only grey land and the sea (`src/lib/croatia-mask.json`, from
  the OSM boundary; water is drawn above the mask) and labels only inside Croatia.
- Loading bar: a thin green (`#4caf50`) block sweeping along the top edge of the page while any download runs
  (`track` in `utils.js`: WFS, GetCapabilities, the basemap style) or WMS/WMTS tiles load (`onLoading` from `createMap`).
  Basemap tiles and re-tiling already loaded GeoJSON don't count.
- Debug readout: `lat, lon · z zoom` (two decimals each) in the **top-right** corner of the map. Map controls must
  not cover it.
- Code, identifiers and comments are **English**. Comments explain *why*, briefly.
- `localStorage` is only for per-user conveniences (custom services, enabled layers) and every access is wrapped in
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

- **NEVER push to `main`** and never commit on `main`. Create a branch before the first edit, and open a PR into
  `main` when the work is done.
- **NO committing ahead of time.** Finish the change, verify it yourself, then ask the user to test it. Commit only
  when the user explicitly says so; push and open the PR only when asked.
- Commit messages in **Croatian**, matching the history.
- **No AI attribution**: no `Co-Authored-By` trailers for AI tools and no "Generated with …" lines in commits or PRs.
- Don't commit `node_modules/`, `build/`, `.svelte-kit/` or IDE folders (`.idea/`).
