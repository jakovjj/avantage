import { MapLibreMap, MercatorCoordinate, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import maskUrl from './croatia-mask.json?url';
import { simplify, track } from './utils.js';

// MapLibre resolves its worker next to itself, which breaks once Vite bundles it.
setWorkerUrl(workerUrl);

// Dev only: this module's state (selection callback, clickable layers, shown features) belongs to the live map, so a
// hot swap would leave the open page half-connected (no details panel, no pointer). Reload the page instead
// (Vite's decline() is a no-op).
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

const COLORS = [
	'#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7',
	'#9c755f', '#bab0ab', '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
	'#800000', '#a50026', '#b2182b', '#d73027', '#e31a1c', '#c51b7d', '#9e0142', '#7f0000',
	'#f46d43', '#ef6548', '#fc8d59', '#d6604d', '#b35806', '#e08214', '#fdb863', '#fee08b',
	'#3288bd', '#5e4fa2', '#8073ac', '#542788', '#006d2c', '#238b45', '#41ab5d', '#008080',
	'#66bd63', '#a6d96a', '#d9ef8b', '#abdda4', '#f1b6da', '#de77ae', '#b2abd2', '#67a9cf'
];
const SELECTION_SOURCE = 'avantage-selection';
const MASK_SOURCE = 'avantage-mask';
// Rendered features keep only numeric ids and geometry rounded to the clicked zoom's tile grid (metres off at low
// zoom), so each feature gets a numeric id that leads a click back to the feature exactly as it was loaded.
const shownFeatures = new Map(); // GeoJSON overlay id → Map(numeric id → loaded feature) currently on the map
const numericIds = new Map(); // feature id → numeric id
const numericId = (fid) => numericIds.get(fid) ?? numericIds.set(fid, numericIds.size + 1).get(fid);
const nonInteractive = new Set();
const overlayLayers = new Map(); // overlay id → its per-layer tweaks from sources.js, for the details panel
let colorIds;
let colorIndexes;
let activeSelection; // { sourceId }
let onSelect = () => {}; // createMap's onFeatureSelect
// Raster overlays that answer clicks anywhere (WMS GetFeatureInfo): overlay id → query(point) resolving to
// { feature, outline } or nothing. While an area layer among them is on, the whole map shows a pointer (thin lines
// and points cover too little of it to deserve one everywhere).
const clickableRasters = new Map();
export const setClickable = (id, query) => (query ? clickableRasters.set(id, query) : clickableRasters.delete(id));
// Geometry determines initial insertion while the logical stack is being assembled.
const KIND_RANKS = { lines: 1, points: 2 };
const overlayRanks = new Map(); // overlay id → rank of its kind
const overlayOrders = new WeakMap(); // map → logical layer groups, highest priority first
const rankOf = (source) => overlayRanks.get(source?.replace(/:overview$/, ''));
const clickableAreas = () => [...clickableRasters.keys()].some((id) => !rankOf(id));
let latestClick = 0;

// Query parameters MapLibre adds to every request to a site (origin → { name: value }), e.g. a short-lived access key
// that tile URLs, built once, can't carry.
const siteParams = new Map();
export const setSiteParams = (origin, params) => siteParams.set(origin, params);
function withSiteParams(url) {
	const u = new URL(url, location.href), params = siteParams.get(u.origin);
	if (!params) return undefined;
	for (const [name, value] of Object.entries(params)) u.searchParams.set(name, value);
	return { url: u.href };
}

const isGeom = (t) => ['in', ['geometry-type'], ['literal', [t, `Multi${t}`]]];

function overlayStyle(id) {
	if (!colorIds) {
		colorIds = [];
		colorIndexes = new Map();
	}
	let index = colorIndexes.get(id);
	if (index === undefined) {
		index = colorIds.length;
		colorIds.push(id);
		colorIndexes.set(id, index);
	}
	const overflow = Math.floor(index / COLORS.length);
	const dashes = [undefined, [2, 1], [1, 1], [4, 2], [1, 2, 4, 1]];
	const markerSizes = [5, 7, 6, 8, 5];
	return { color: COLORS[index % COLORS.length], dash: dashes[overflow % dashes.length], markerSize: markerSizes[overflow % markerSizes.length] };
}

// Only our overlays use GeoJSON sources; the basemap is vector tiles.
const overlayFeature = (map, point) =>
	map.queryRenderedFeatures(point).find((f) =>
		map.getSource(f.source)?.type === 'geojson' && !nonInteractive.has(f.source)
	);

const MAX_BOUNDS = [[11.5, 41.2], [21.4, 47.7]];
// The basemap's credit (its TileJSON's) in Croatian; a style source's own attribution overrides the TileJSON one.
const BASEMAP_CREDIT = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
	'<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
	'Podaci iz <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMapa</a>';

/**
 * Basemap focused on Croatia (OSM boundary, the basemap's own source), applied before the first frame: no tiles
 * beyond the view limit, outside Croatia only grey land and the sea (the mask covers everything but the water polygons
 * lifted above it), and labels only inside Croatia.
 */
function croatiaStyle(style, mask) {
	// The label filter tests every label against every border point (13,846), which made drawing tiles ~3× slower;
	// ~500 m accuracy (900 points) costs nothing noticeable. The mask itself keeps the full border.
	const croatia = { type: 'MultiPolygon', coordinates: mask.coordinates.slice(1).map((ring) => [simplify(ring, 0.005)]) };
	for (const source of Object.values(style.sources)) if (source.type === 'vector') Object.assign(source, { bounds: MAX_BOUNDS.flat(), attribution: BASEMAP_CREDIT });
	style.sources[MASK_SOURCE] = { type: 'geojson', data: mask };
	nonInteractive.add(MASK_SOURCE);
	const labels = style.layers.filter((l) => l.type === 'symbol');
	for (const l of labels) l.filter = l.filter ? ['all', l.filter, ['within', croatia]] : ['within', croatia];
	style.layers = [
		...style.layers.filter((l) => l.type !== 'symbol' && l.id !== 'water'),
		{ id: `${MASK_SOURCE}:fill`, type: 'fill', source: MASK_SOURCE, paint: { 'fill-color': '#e4e4e4' } },
		...style.layers.filter((l) => l.id === 'water'),
		{ id: `${MASK_SOURCE}:line`, type: 'line', source: MASK_SOURCE, paint: { 'line-color': '#999', 'line-width': 1 } },
		...labels
	];
	return style;
}

/**
 * Resolves with a map of Croatia once its style has loaded. `onLoading(busy)` hears when image tiles of an overlay
 * (WMS/WMTS) start loading and when the map has finished. Basemap tiles are quick and GeoJSON is already downloaded
 * (re-tiling it on every pan is local), so neither counts.
 */
export async function createMap (container, onFeatureSelect = () => {}, onLoading = () => {}) {
	const [style, mask] = await Promise.all(
		['https://tiles.openfreemap.org/styles/positron', maskUrl].map((url) => track(fetch(url).then((r) => r.json())))
	);
	const map = new MapLibreMap({
		container,
		style: croatiaStyle(style, mask),
		bounds: [[13.2, 42.2], [19.7, 46.7]],
		maxBounds: MAX_BOUNDS, // all data is Croatian: keep the view close to it
		// Each layer keeps tiles of this many zooms' worth of screens (default 5: ~30 tiles), so zooming in from Croatia to a
		// street and back out still has the zoomed-out tiles; DGU tiles can't be cached by the browser and take ~1 s each.
		maxTileCacheZoomLevels: 12,
		transformRequest: withSiteParams
	});
	map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right'); // top-right holds the debug readout
	map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
	onSelect = onFeatureSelect;
	map.on('click', async (e) => {
		const click = ++latestClick;
		const rendered = overlayFeature(map, e.point);
		// Ask eligible WMS layers in parallel and use the first hit from the top of the current stack.
		const positions = new Map(map.getStyle().layers.map((layer, index) => [layer.source, index]));
		const renderedPosition = positions.get(rendered?.source) ?? -1;
		const queries = [...clickableRasters]
			.filter(([id]) => positions.get(id) > renderedPosition && map.getPaintProperty(id, 'raster-opacity') !== 0)
			.sort(([a], [b]) => positions.get(b) - positions.get(a))
			.map(([id, query]) => [id, query(e.point).catch(() => null)]);
		for (const [id, answer] of queries) {
			const hit = await answer;
			if (click !== latestClick) return; // a newer click took over
			if (hit && map.getLayer(id) && map.getPaintProperty(id, 'raster-opacity') !== 0) return selectRemote(map, id, hit);
		}
		if (!rendered || !map.getSource(rendered.source)) return;
		const f = shownFeatures.get(rendered.source)?.get(rendered.id) ?? rendered;
		removeHighlights(map);
		showSelection(map, f, rendered);
		activeSelection = { sourceId: rendered.source };
		onSelect(f, rendered.source, overlayLayers.get(rendered.source));
	});
	map.on('mousemove', (e) => (map.getCanvas().style.cursor = clickableAreas() || overlayFeature(map, e.point) ? 'pointer' : ''));
	map.on('dataloading', (e) => e.sourceId && map.getSource(e.sourceId)?.type === 'raster' && onLoading(true));
	map.on('idle', () => onLoading(false));
	return new Promise((resolve) => map.once('load', () => resolve(map)));
}

/** Moves the map to a selected place, fitting its bounds when available. */
export function flyToCoordinates (map, coordinates, extent) {
	if (extent?.length === 4 && extent.every(Number.isFinite)) {
		map.fitBounds(
			[[Math.min(extent[0], extent[2]), Math.min(extent[1], extent[3])], [Math.max(extent[0], extent[2]), Math.max(extent[1], extent[3])]],
			{ padding: 60, maxZoom: 15 }
		);
		return;
	}
	map.flyTo({ center: coordinates, zoom: 15 });
}

// The selected feature glows: a soft amber disc under a point's marker, sized to it (circles and icons of any shape
// and size). Lines and areas get a black outline, which shows on any fill colour (drawn by the server for features of
// WMS layers).
const HIGHLIGHT = '#ffb300';
export const OUTLINE_COLOR = '#000';
const OUTLINE = `${SELECTION_SOURCE}:outline`;

/** Radius in px of a rendered point's marker, from its evaluated circle or icon size. */
function markerRadius(map, { layer: { type, paint, layout } }) {
	if (type === 'circle') return paint['circle-radius'] + paint['circle-stroke-width'];
	const image = type === 'symbol' && layout['icon-image'] && map.getImage(layout['icon-image'].name);
	return image ? (Math.max(image.data.width, image.data.height) / image.pixelRatio / 2) * layout['icon-size'] : 6;
}

function showSelection(map, feature, rendered) {
	const data = {
		type: 'FeatureCollection',
		features: [{ type: 'Feature', geometry: feature.geometry, properties: { radius: markerRadius(map, rendered) + 9 } }]
	};
	if (map.getSource(SELECTION_SOURCE)) map.getSource(SELECTION_SOURCE).setData(data);
	else {
		nonInteractive.add(SELECTION_SOURCE);
		map.addSource(SELECTION_SOURCE, { type: 'geojson', data });
		map.addLayer({
			id: `${SELECTION_SOURCE}:line`, type: 'line', source: SELECTION_SOURCE,
			filter: ['!', isGeom('Point')], paint: { 'line-color': OUTLINE_COLOR, 'line-width': 3 }
		});
		map.addLayer({
			id: `${SELECTION_SOURCE}:point`, type: 'circle', source: SELECTION_SOURCE,
			filter: isGeom('Point'),
			paint: { 'circle-radius': ['get', 'radius'], 'circle-color': HIGHLIGHT, 'circle-opacity': 0.7, 'circle-blur': 0.5 }
		});
	}
	// Right under the selected layer's own drawing, so the marker stays on top of its glow.
	map.moveLayer(`${SELECTION_SOURCE}:point`, map.getStyle().layers.find((l) => l.source === rendered.source)?.id);
}

function removeHighlights(map) {
	for (const id of [`${SELECTION_SOURCE}:line`, `${SELECTION_SOURCE}:point`, OUTLINE]) if (map.getLayer(id)) map.removeLayer(id);
	for (const id of [SELECTION_SOURCE, OUTLINE]) if (map.getSource(id)) map.removeSource(id);
	nonInteractive.delete(SELECTION_SOURCE);
}

/** Selects a feature a WMS layer (overlay `sourceId`) returned: details panel, and `outline` tiles that draw it. */
function selectRemote(map, sourceId, { feature, outline }) {
	removeHighlights(map);
	map.addSource(OUTLINE, outline);
	map.addLayer({ id: OUTLINE, type: 'raster', source: OUTLINE });
	activeSelection = { sourceId };
	onSelect(feature, sourceId, overlayLayers.get(sourceId));
}

/** Clears the selected feature and its map highlight. */
export function clearSelection(map) {
	if (!activeSelection) return;
	activeSelection = null;
	removeHighlights(map);
	onSelect(null, null);
}

/** Web Mercator box (metres) of `size` px centred on a clicked point, as a WMS GetFeatureInfo needs it. */
export function clickBox(map, point, size = 9) {
	const half = (size - 1) / 2, world = 2 * Math.PI * 6378137;
	const metres = (x, y) => {
		const c = MercatorCoordinate.fromLngLat(map.unproject([x, y]));
		return [(c.x - 0.5) * world, (0.5 - c.y) * world];
	};
	const [w, n] = metres(point.x - half, point.y - half), [e, s] = metres(point.x + half + 1, point.y + half + 1);
	return { bbox: [w, s, e, n], size, i: half, j: half };
}

/** Current view as [w, s, e, n], grown by `scale` around its centre. */
export function viewBbox (map, scale = 1) {
	const [[w, s], [e, n]] = map.getBounds().toArray();
	const dx = ((e - w) * (scale - 1)) / 2, dy = ((n - s) * (scale - 1)) / 2;
	return [w - dx, s - dy, e + dx, n + dy];
}

// Rasters cover the whole view, so they stay a bit see-through (the sidebar can change it per layer).
export const RASTER_OPACITY = 0.8;

/** Adds a raster or GeoJSON source of geometry `kind` with optional per-layer display tweaks. */
export function addOverlay (map, id, source, layer = {}, kind) {
	// A saved image of the whole layer stands in for the server's tiles while zoomed out, where they are slow. The
	// tiles' source then starts later rather than their layer, so it stays in use and keeps crediting the data
	// provider (image sources can't carry an attribution). MapLibre picks raster tiles by the rounded map zoom, and
	// 256 px tiles one zoom deeper (512 px tiles match it), so tiles of zoom maxZoom + 1 (+ 1 for 256 px) first appear at
	// map zoom maxZoom + 0.5: the image is shown until exactly then, so the two never overlap and never leave a gap.
	const { overview } = layer;
	const tilesFrom = overview && overview.maxZoom + 1 + Math.log2(512 / (source.tileSize ?? 512));
	map.addSource(id, overview ? { ...source, minzoom: Math.max(source.minzoom ?? 0, tilesFrom) } : source);
	overlayLayers.set(id, layer);
	const rank = KIND_RANKS[kind] ?? 0;
	overlayRanks.set(id, rank);
	// Rasters cover the whole view, so they go under the basemap labels and stay a bit see-through; map-drawn features
	// go above the labels. Either way, under the first overlay of a higher kind.
	const raster = source.type === 'raster';
	const below = map.getStyle().layers.find((l) => (raster && l.type === 'symbol') || ((l.type === 'raster') === raster && rankOf(l.source) > rank))?.id;
	if (raster) {
		const paint = { 'raster-opacity': RASTER_OPACITY };
		if (overview) {
			const [w, s, e, n] = overview.bounds;
			map.addSource(`${id}:overview`, { type: 'image', url: overview.url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
			map.addLayer({ id: `${id}:overview`, type: 'raster', source: `${id}:overview`, maxzoom: overview.maxZoom + 0.5, paint }, below);
		}
		map.addLayer({ id, type: 'raster', source: id, paint }, below);
		applyOverlayOrder(map);
		return;
	}
	const { color, dash, markerSize } = overlayStyle(id);
	const kinds = {
		fill: [isGeom('Polygon'), { 'fill-color': color, 'fill-opacity': 0.2 }],
		line: [['!', isGeom('Point')], { 'line-color': color, 'line-width': 1.5, ...(dash && { 'line-dasharray': dash }) }],
		circle: [isGeom('Point'), { 'circle-color': color, 'circle-radius': markerSize, 'circle-stroke-color': '#fff', 'circle-stroke-width': markerSize === 5 ? 1 : 2 }]
	};
	for (const [type, [filter, base]] of Object.entries(kinds))
		map.addLayer({
			id: `${id}:${type}`, source: id, type, filter,
			...(Number.isFinite(layer.minZoom) && { minzoom: layer.minZoom }),
			paint: { ...base, ...layer.paint?.[type] }
		}, below);
	// Icons and labels on top, for markers circles can't draw. SVGs are drawn at 2× so their edges stay sharp.
	for (const [name, svg] of Object.entries(layer.images ?? {})) {
		if (map.hasImage(name)) continue;
		const image = new Image();
		image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
		image.decode().then(() => map.hasImage(name) || map.addImage(name, image, { pixelRatio: 2 }));
	}
	if (layer.symbol)
		map.addLayer({
			id: `${id}:symbol`, source: id, type: 'symbol',
			...(Number.isFinite(layer.minZoom) && { minzoom: layer.minZoom }),
			layout: layer.symbol.layout, paint: layer.symbol.paint ?? {}
		}, below);
	applyOverlayOrder(map);
}

/** Sets the logical stack without reloading data; members, overview images and survey halves move together. */
export function setOverlayOrder(map, groups) {
	overlayOrders.set(map, groups);
	applyOverlayOrder(map);
}

function applyOverlayOrder(map) {
	const groups = overlayOrders.get(map);
	if (!groups?.length) return;
	const layers = map.getStyle().layers;
	const stacks = groups.map(() => []);
	const sourceStacks = new Map();
	for (const [index, sources] of groups.toReversed().entries()) {
		for (const id of sources) {
			sourceStacks.set(id, stacks[index]);
			sourceStacks.set(`${id}:overview`, stacks[index]);
		}
	}
	for (const layer of layers) sourceStacks.get(layer.source)?.push(layer);
	const lastRaster = stacks.findLastIndex((stack) => stack.some((l) => l.type === 'raster'));
	const labels = layers.find((l) => l.type === 'symbol' && !overlayLayers.has(l.source))?.id;
	const outline = layers.find((l) => l.id === OUTLINE || l.id === `${SELECTION_SOURCE}:line`)?.id;
	// Basemap labels sit above the highest raster. Vectors above that raster keep their labels and markers on top.
	for (const [index, stack] of stacks.entries()) {
		const before = index <= lastRaster ? labels : outline;
		for (const layer of stack) map.moveLayer(layer.id, before);
	}
	const glow = `${SELECTION_SOURCE}:point`;
	if (activeSelection && map.getLayer(glow)) {
		map.moveLayer(glow, map.getStyle().layers.find((l) => l.source === activeSelection.sourceId)?.id);
	}
}

/** Sets a raster overlay's opacity (0–1), its overview image's too. */
export function setOpacity(map, id, opacity) {
	for (const l of [id, `${id}:overview`]) if (map.getLayer(l)) map.setPaintProperty(l, 'raster-opacity', opacity);
}

/** Makes a GeoJSON overlay show exactly `features`, removing and adding only what changed (by feature id). */
export function syncFeatures (map, id, features) {
	const shown = shownFeatures.get(id) ?? new Map();
	const next = new Map(features.map((f) => [numericId(f.id), f]));
	map.getSource(id).updateData({
		remove: [...shown.keys()].filter((n) => !next.has(n)),
		add: [...next].filter(([n]) => !shown.has(n)).map(([n, f]) => ({ ...f, id: n }))
	});
	shownFeatures.set(id, next);
}

export function removeOverlay (map, id) {
	if (activeSelection?.sourceId === id) clearSelection(map);
	const sources = [id, `${id}:overview`];
	for (const l of map.getStyle().layers) if (sources.includes(l.source)) map.removeLayer(l.id);
	for (const s of sources) if (map.getSource(s)) map.removeSource(s);
	shownFeatures.delete(id);
	nonInteractive.delete(id);
	overlayLayers.delete(id);
	overlayRanks.delete(id);
}
