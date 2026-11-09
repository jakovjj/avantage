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
| `src/lib/wms.js` | Clicks on WMS-drawn layers (`featureInfo`): GetFeatureInfo → details panel + outline, glues `ogc.js` + `map.js` | contain UI |
| `src/lib/utils.js` | Small domain-free helpers (escaping, bbox math, size-capped fetch, running-download counter) | know about OGC or MapLibre |
| `src/lib/Source.svelte` | UI for one service: layer list, toggles, status notes, opacity slider, legend | fetch data or build map layers itself |
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
- Show the layer's legend (`legendUrl`) when it is on, unless it's a single unlabelled swatch (≤ 20 × 20 px, e.g. DGU).
- The source's `bounds` is the layer's lon/lat extent from GetCapabilities (`wmsBounds`), so no tiles are asked for
  beyond it (DGU draws those black).
- A click on a `featureInfo` layer (`wms.js`) sends GetFeatureInfo for a 9 px box around the click, JSON, one feature,
  with `PROPERTYNAME` listing the layer's attributes from WFS DescribeFeatureType: without it the answer carries the
  geometry, and one big Bioportal habitat polygon is 23.5 MB (5 s) instead of 0.4 KB (~0.3 s). The highlight is then
  drawn by the server: the same WMS layer filtered to that feature (`FEATUREID`) with a black outline-only `SLD_BODY`
  (both GeoServer vendor parameters); point layers get a black ring instead, since a line style draws nothing for points. One click handler in `map.js` picks the
  winner: a point beats a line beats an area. Every `featureInfo` layer of a higher kind than the map-drawn (GeoJSON)
  feature under the click is asked at once (`setClickable` registers each layer's query), and the first hit in rank
  order, then drawing order, wins; at an equal rank the map-drawn feature wins (it's drawn above all rasters). While
  such a layer of areas is on, the cursor is a pointer over the whole map; lines and points alone don't get one.
- Overlays stack by the same kind (`addOverlay`'s `kind`): points over lines over areas and plain rasters, whatever
  order they're turned on in; rasters stay under the basemap labels, map-drawn features above them.

**Services behind a key** (service-level `authKey`: the URL that hands out the key)
- DGU geoportal (`geoportal.dgu.hr/services/auth/…`, "za registrirane korisnike"; the open `services/inspire/…` ones
  carry a watermark): images need `authKey`, GetCapabilities doesn't. `keepKey` (`utils.js`) gets a key from
  `https://geoportal.dgu.hr/api/authkey/userAuthKey` (`{ authKey, expires, overlay }`, ~8 min, renewed `overlay` = 20 s
  early by passing the old key back; CORS allows any origin) and `setSiteParams` (`map.js`) makes MapLibre add it to
  every request to that site (`transformRequest`), since tile URLs are built once. Capabilities are read without a key:
  read with one, they bake it into the GetMap URLs.
- Service-level `format` — WMS tile format instead of PNG: `image/jpeg` for photos covering their whole extent (DGU
  JPEG tiles ~110 KB vs PNG ~700 KB, same speed), never for partial ones (JPEG is white where there's no image).

**WMTS**
- Only layers with an EPSG:3857 tile matrix set starting at zoom 0 can be shown (MapLibre is Web Mercator only).

## Per-layer tweaks (`sources.js` → `layers`)

Keep these to what cannot be inferred automatically. Supported keys:
- `id(feature)` — stable feature key when the server's ids change between requests.
- `paint` — MapLibre paint overrides per kind: `{ fill, line, circle }` (e.g. habitat map coloured by NKS class).
- `group` — sidebar group title when it can't come from the `Group - layer` title prefix.
- `label` — the layer's row text in its group when it can't come from the title (rows are sorted by it).
- `opacity` — WMS: an opacity slider under the row while the layer is on, for rasters covering the whole map
  (the Osjetljivost maps, the habitat polygon layers; service-level for the Digitalni ortofoto surveys, where it also
  moves a `together` service's half).
- `members` — names of hidden layers this row turns on and off with itself, so several layers show as one row (its
  `label`); with each member's `legend` (short text) and `paint.circle['circle-color']`, the row shows a colour legend
  while on, and its count is their total.
- `legend` — a member's text in that legend, also passed to the panel (`layer` prop).
- `ready` — a designed layer: listed on top under its service's `category` (see Ready layers).
- `minZoom` — map zoom below which the layer is neither drawn nor requested.
- `details` — labelled fields shown first in the right-hand details panel: `{ fields: [{ keys, label }] }`; all other
  non-empty properties follow under their keys.
- `wms` — WMS URL; the WFS layer is drawn as that server's rendered image instead of WFS features. For layers far
  too big as vectors (Bioportal sensitivity maps: a few dissolved polygons of several MB each; Karta staništa 2016:
  322,906 polygons).
- `heatmap` — `true`: the sidebar shows the layer with the heatmap icon.
- `featureInfo` — with `wms`: a click on the map asks the WMS for the feature there (see WMS above).
- `hide` — leave the layer out of the sidebar (e.g. its data is shown from another service instead).
- `panel` — Svelte component (`src/lib/panels/`) replacing the properties table in the details panel; it gets the
  feature's `properties` and the layer's tweaks (`layer`).
- `loadAll` — WFS only: download the whole layer once, without the 100 KB cap, and never switch to viewport mode.
  Only after measuring that the full download is acceptable (compressed size, time).
- `merge` — WFS with `loadAll`: names of other layers of the same service loaded whole into this one; a feature in
  several counts once, by the `id` hook, and the layer's own copy wins (hide the merged layers).
- `images` — `{ name: SVG markup }` icons for `symbol`, drawn at half the SVG's pixel size so their edges stay sharp.
- `symbol` — `{ layout, paint }` of one extra MapLibre symbol layer on top of the layer's own: icons (markers circles
  can't draw, e.g. triangles) and labels (`text-font` must be a basemap font: `Noto Sans Regular/Bold/Italic`).
- `snapshot` — WFS only: URL (`import … from './snapshots/<layer>.json?url'`) of a saved GetFeature response, loaded
  whole instead of asking the server. For small layers whose server is very slow. See Snapshots.
- `tileSize` — WMS tile size in px (default 512).
- `exclusive` — key shared by layers of which only one may be on, also across services (a service-level `exclusive`
  applies to all its layers): turning one on turns the others off (the 11 Bioportal sensitivity maps, which cover all
  of Croatia, share `group: 'Osjetljivost'` and `exclusive`; the Digitalni ortofoto surveys share one too). They keep
  checkboxes, so the active one can still be turned off.
- `overview` — WMS: `{ url, bounds: [w, s, e, n], maxZoom }`, a saved image of the whole layer (`./snapshots/*.png?url`)
  shown until map zoom `maxZoom` + 0.5 instead of the server's tiles, for layers the server renders very slowly when
  zoomed out. MapLibre picks raster tiles by the rounded zoom (256 px tiles one zoom deeper), so the tiles' source gets
  the tile minzoom that first appears exactly there (zoom 8 with 256 px tiles → 10). It is set on the source, not its
  layer, so the source stays in use and the provider stays credited. Check by counting `sourcedata` tile events per
  zoom; the network panel doesn't show MapLibre's worker requests. See Snapshots.

Service-level keys besides `title`, `url`, `type` and `layers`: `category` (ready layers' section on top), `section`
(services listed together in one section of the full list, one row each, named by `title`: `flat` in `Source.svelte`),
`authKey`, `format` (see WMS above) and `together` (other WMS services whose first layer is drawn with this one, as one
row: halves of the country from different services).

New tweak types must be generic (applied by `map.js`/`wfs.js`/`Source.svelte`/the page), not special-cased per
source in code.

## Ready layers

Layers the user has designed by hand, one by one: own colours, own details panel, sometimes shown from one service
only. Their config sits in the "Ready layers" block at the top of `sources.js`. **Don't change them** unless the user
asks; every other layer keeps the automatic defaults. Add a layer here when the user says its design is done.

The sidebar lists only these on top, marked `ready`, under three categories named by their service's `category`:
**Otpad** (AZO WFS), **Bioportal** (Karta staništa without "2016 - točke", and the 11 Osjetljivost maps) and
**Hrvatske vode** (all 4 flood maps, the user's choice). Every other layer shows in its service's section only when
"Prikaži sve slojeve" is ticked (a developer option at the bottom, next to "Dodaj ručno slojeve"); a service whose
layers are all on top is left out there. **Digitalni ortofoto (podloga)** (DGU, 10 rows: 2011, 2014–2016, the two-year composites 2017/2018 to 2023/2024,
2022/2023 (the LIDAR survey, named like the rest), 2024 west + 2025/2026 east as one row "2024./2025.", and the 1:1000 Zagreb / 1:500 Sisak
earthquake ones) is a `section` at the very top of the sidebar, always shown, one survey at a time (service-level
`exclusive`); whole-country surveys use JPEG. Single years that a composite holds are
left out (each covers half the country, not cut cleanly). Hiding the list takes its layers off the map (each `Source` removes its
layers when it goes away) but keeps them stored, so they come back with it. A thin grey rule and the user's note "Niže navedeni slojevi prikazivat će se
na karti bez obrade." separate them from the ready layers (the one sentence allowed in the sidebar).

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
- **Karta staništa 2016 - poligoni** (Bioportal `kopnena_stanista_2016`, 322,906 polygons) — drawn by the Bioportal
  WMS (`wms`, its own colours and legend, 512 px tiles, `overview` image until zoom 8.5), clicks via `featureInfo`.
  Each polygon is a complex of up to 3 NKS habitat types, most important first (`nks1` always; `nks2` in ~60%, `nks3`
  in ~20%): code, Croatian name and, in ~40%, the scientific syntaxon (`_znan`, "-" when none). `nks_komb` /
  `nks_stari` repeat the codes, `*_style` are the class letters for map colours, `shape_*` repeat the area.
  Panel `Staniste2016.svelte`: the types, each with a swatch in the WMS style's colour for its class letter, the main
  one large, then the area in ha.
- All habitat maps share one sidebar section, `group: 'Karta staništa'` (rows "2004 - …", "2016 - …", "2023 - more - …"),
  and the 2004 and 2016 land polygon layers share `exclusive`, since they cover the same ground.
- **Karta staništa 2004** (Bioportal, 9 layers) — the 5 big ones are drawn by the WMS with `featureInfo` (land
  polygons `kopnena_stanista` 60,555 ≈ 60 MB, `vodotoci` 22,859 lines, `stijene_tocila` 22,420, `morska_obala` 5,305,
  `morski_bentos` 3,485 polygons; 512 px tiles ≤1.9 s for Croatia, no overview needed); the points, `podzemlje` and
  `kopnene_vode` (≤1,121 features) stay WFS. Fields: `nks_kod` (space-padded) and `nks_ime`, combinations joined
  with "/" (names sometimes " / "; 663 coast lines have no name, 2 inland waters one name for 4 codes); `style`
  repeats them, `tip` names the layer, `id_rel`/`fid` are internal. Panel `Staniste2004.svelte` for all 9: layer,
  then each type (name, code), names and codes paired only when they match up. The WMS style colours 109 codes
  separately, so no class swatches. Clicks on lines hit within a few px (GeoServer's default buffer).
- **Periske** and **Saproksilni kornjaši** (Bioportal) — one row each (`members`), every layer `loadAll` (≤999 points,
  ≤462 KB, ~0.1 s each): Periske 2,446 points in 8 layers (archive 2006–2018, experts, citizen reports 2019–2024),
  kornjaši 2,380 in 5 (citizen reports 2015–2019). Coloured by layer (year): cold greens to blues for Periske, warm
  yellows to reds for kornjaši, so the two never mix; the oldest hosting the row so the newest are drawn on top. Every year names its fields differently, so the panels take the
  first field present and skip placeholders ("Nepoznato", "nije navedeno", "ne"). `nesig*` is the location's
  uncertainty in metres (mostly 25–30 m for kornjaši; shown only from 1 m). Coordinates (`x_*`, `y_*`, stated
  `nav*_k*`) and the report number `br_nal` aren't shown; `foto` is only "da"/"ne" (no photo links are published). Bioportal
  has no kornjaši reports after 2019, although ZZOP still runs the yearly call (its 2024 call names the species
  jelenak, alpinska strizibuba, velika četveropjega strizibuba).
  Both panels have one structure, as plain lines (no label/value tables): a type label ("Periska - dojava građana" /
  "dojava stručnjaka" / "arhivski podatak", "Saproksilni kornjaš - dojava građana"; no year, the date has it), the
  species as the heading, Croatian with the Latin name small and grey beside it ("Plemenita periska *Pinna
  nobilis*"; the beetles' names from ZZOP's call, `NAMES` in the panel), the place (and its description), the
  date and observer in grey, the finding in bold (Periska's state; the beetle's sex, with the count when above one),
  one sentence of details ("1 jedinka na 2 m dubine, od toga…"; "Dojavljeno …, s fotografijom"), and "Točnost
  lokacije ±… m" small at the bottom. Nouns after numbers use `plural` (`utils.js`).
  Dates go through `formatDate` (`utils.js`): "22.7.2019.".
- **Divlji deponiji otpada u speleološkim objektima** (Bioportal) — the register as of 2024 (`depo_speleo_2024`, 825
  caves) with 2021 (`divlji_deponiji_2021`, 763) `merge`d in: 89 KB gzipped together, 861 caves. Each cave has one
  page on cistopodzemlje.info, the `id` (the cadastre number is often "-"): 727 caves are in both (the 2024 record
  wins), 98 only in 2024, 36 only in 2021 (maybe cleaned up since). The AZO otpad WFS has the same register yearly
  (`depo_speleo_2017…2025`, growing to 842), not used. Brown dots; from zoom 12 each cave's name beside it
  (`symbol`, like Odlagališta; a `step` on zoom, without "(sinonimi: …)"; colliding names are dropped). Panel `SpeleoDeponij.svelte`: the cave's name
  ("(sinonimi: …)" moved to "Također: …"), length and depth as "18 m kanala, 14 m u dubinu" (number
  first; "duljina" and "dubina" read alike), cadastre number, the club that reported it, "Samo u popisu
  iz 2021." for a cave missing from 2024 (only 2021 has `povez`), and "Više na cistopodzemlje.info" (https).
- **Karta morskih staništa 2023** (Bioportal `morska_stanista_p_1_1` 31,993 polygons, `_l_1_1` 15,455 lines,
  `_pt_1_1` 62,144 points; 200 polygons ≈ 3 MB as WFS) — all 3 drawn by the WMS with `featureInfo` (~0.05 s), rows
  labelled "2023 - more - poligoni / linije / točke". Polygons and points take ~4 s per 512 px view of Croatia, so
  `overview` images until zoom 8.5; lines ≤0.5 s. Fields: `mnks_1..3` codes with `_naz` names (the complex, most
  important first; `mnks_2` in ~20–50%), `mnks_kod`/`mnks_naziv` repeat them joined, `izvorno_m` source scale
  ("1:10000"), `metoda` (Posredno / Model / Mjesovito / Neposredno), rare `kompleks_s`, `area` in ha (polygons),
  `length` in m (perimeter for polygons). Panel `MorskaStanista2023.svelte`: the types (main one large), area or
  length, complex, method, scale.

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
for l in kopnena_stanista_2016 morska_stanista_p_1_1 morska_stanista_pt_1_1 ocjena_priroda_solar ocjena_priroda_vjetar osjetljivost_stanista ascii_osjetljivost_sismisi_solar_import ascii_osjetljivost_sismisi_vjetar ascii_osjetljivost_vrsta_solar ascii_osjetljivost_vrsta_vjetar; do curl -o src/lib/snapshots/$l.png "https://services.bioportal.hr/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png8&TRANSPARENT=TRUE&CRS=EPSG:3857&STYLES=&LAYERS=$l&BBOX=1491681.18,5206024.46,2176296.05,5877026.55&WIDTH=2239&HEIGHT=2195"; done
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
| `kopnena_stanista_2016.png` | Bioportal Karta staništa 2016 - poligoni (overview) | 2026-11-08 |
| `morska_stanista_p_1_1.png` | Bioportal Karta morskih staništa 2023 - poligoni (overview) | 2026-11-09 |
| `morska_stanista_pt_1_1.png` | Bioportal Karta morskih staništa 2023 - točke (overview) | 2026-11-09 |

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
- Sidebar: `Avantage` title, the layer filter, the Digitalni ortofoto section, the three categories of ready layers, then (with "Prikaži sve
  slojeve") one `<details>` per service and the user's own services; at the bottom the two option checkboxes and the
  URL form. No GetCapabilities ("`<TYPE> endpoint`") links and no service type (WFS/WMS) in the sidebar: they put
  off ordinary users.
- A layer with the `opacity` tweak gets a native range slider under its row while it's on (0–1, default 0.8 like
  every raster), above its legend; it sets the tiles and the `overview` image.
- The data provider (from GetCapabilities) is credited in the MapLibre attribution, not in the sidebar. Credits are
  Croatian: a provider named in English goes through `PROVIDER_NAMES` in `sources.js` (Bioportal's "Croatian Agency
  for the Environment and Nature"), and the basemap's TileJSON credit is replaced by `BASEMAP_CREDIT` in `map.js`.
- A layer row has an (i) after its type icon only when GetCapabilities gives an **official** description (`about` in
  `ogc.js`): an abstract that says more than the title (not the title again, "null", or the service's abstract); a
  metadata link alone isn't enough. It opens a box over the map, beside the sidebar and level with the row (one at a
  time; a click outside or Escape closes it): the layer's title, that text and "Više" with a new-tab icon linking to
  the metadata record (NIPP geoportal page), otherwise a "`<TYPE>` endpoint" link. Never write our own texts there. The NIPP records can't be read from the browser (the
  geoportal sends `Access-Control-Allow-Origin: *, *`, which browsers reject), so they are only linked.
- No middle dot (·) anywhere in the UI; join parts with " - " or a comma.
- Numbers shown to users go through `formatNumber` (`utils.js`): thousands split by a thin space ("9 700 000"),
  **never a dot or comma** (they read as decimals); the decimal mark is a comma ("0,3").
- Details panel (right): a ready layer's own `panel`, otherwise the properties table. A panel starts with a small
  grey type label (`<h5>`, e.g. "Odlagalište otpada") above its heading, so it's clear what was clicked. The "Google Maps" link (points
  only) is centred and stuck to the bottom of the panel, also while its content scrolls.
- Selection highlight: a soft amber glow under a selected point's marker; selected lines and areas always get a black
  outline (it shows on every fill colour; amber or blue didn't).
- Each layer row has a small grey icon after its name showing its map type (markers / lines / areas / heatmap / image), derived from
  the service: one `DescribeFeatureType` per WFS (a sample feature when the schema says only "geometry").
- The map is limited to Croatia (`maxBounds`). `croatiaStyle` in `map.js` rewrites the basemap style before the first
  frame: no tiles beyond `maxBounds`, outside Croatia only grey land and the sea (`src/lib/croatia-mask.json`, from
  the OSM boundary; water is drawn above the mask) and labels only inside Croatia.
- Loading bar: a thin green (`#4caf50`) block sweeping along the top edge of the page while any download runs
  (`track` in `utils.js`: WFS, GetCapabilities, the basemap style) or WMS/WMTS tiles load (`onLoading` from `createMap`).
  Basemap tiles and re-tiling already loaded GeoJSON don't count.
- Debug readout: `lat, lon, z zoom` (two decimals each) in the **top-right** corner of the map. Map controls must
  not cover it.
- Code, identifiers and comments are **English**. Comments explain *why*, briefly.
- `localStorage` is only for per-user conveniences (custom services, enabled layers) and every access is wrapped in
  `try/catch`.

## Known pitfalls

- MapLibre 6 must get its worker via `setWorkerUrl(...?url)` in `map.js`; without it the map is blank after bundling.
- `map.js` holds state tied to the live map (selection callback, clickable layers, shown features). A dev hot swap of
  it left the open page without details panel or pointer, so it accepts its own updates by reloading the page
  (`import.meta.hot.accept(() => location.reload())`; Vite's `decline()` is a no-op). When testing in the browser,
  still reload after edits elsewhere before trusting what you see.
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
