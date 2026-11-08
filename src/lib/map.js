import { MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import maskUrl from './croatia-mask.json?url';

// MapLibre resolves its worker next to itself, which breaks once Vite bundles it.
setWorkerUrl(workerUrl);

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
const shownIds = new Map(); // GeoJSON overlay id → Set of feature ids currently on the map
const nonInteractive = new Set();
const overlayDetails = new Map();
let colorIds;
let colorIndexes;
let activeSelection; // { sourceId, onFeatureSelect }

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

/**
 * Basemap focused on Croatia (OSM boundary, the basemap's own source), applied before the first frame: no tiles
 * beyond the view limit, outside Croatia only grey land and the sea (the mask covers everything but the water polygons
 * lifted above it), and labels only inside Croatia.
 */
function croatiaStyle(style, mask) {
	const croatia = { type: 'MultiPolygon', coordinates: mask.coordinates.slice(1).map((ring) => [ring]) };
	for (const source of Object.values(style.sources)) if (source.type === 'vector') source.bounds = MAX_BOUNDS.flat();
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

/** Resolves with a map of Croatia once its style has loaded. */
export async function createMap (container, onFeatureSelect = () => {}) {
	const [style, mask] = await Promise.all(
		['https://tiles.openfreemap.org/styles/positron', maskUrl].map((url) => fetch(url).then((r) => r.json()))
	);
	const map = new MapLibreMap({
		container,
		style: croatiaStyle(style, mask),
		bounds: [[13.2, 42.2], [19.7, 46.7]],
		maxBounds: MAX_BOUNDS // all data is Croatian: keep the view close to it
	});
	map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right'); // top-right holds the debug readout
	map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
	map.on('click', (e) => {
		const f = overlayFeature(map, e.point);
		if (!f) return;
		showSelection(map, f);
		activeSelection = { sourceId: f.source, onFeatureSelect };
		onFeatureSelect(f, f.source, overlayDetails.get(f.source));
	});
	map.on('mousemove', (e) => (map.getCanvas().style.cursor = overlayFeature(map, e.point) ? 'pointer' : ''));
	return new Promise((resolve) => map.once('load', () => resolve(map)));
}

function showSelection(map, feature) {
	const source = map.getSource(SELECTION_SOURCE);
	const data = {
		type: 'FeatureCollection',
		features: [{ type: 'Feature', geometry: feature.geometry, properties: {} }]
	};
	if (source) return source.setData(data);

	nonInteractive.add(SELECTION_SOURCE);
	map.addSource(SELECTION_SOURCE, { type: 'geojson', data });
	map.addLayer({
		id: `${SELECTION_SOURCE}:line`, type: 'line', source: SELECTION_SOURCE,
		filter: ['!', isGeom('Point')], paint: { 'line-color': '#111', 'line-width': 3 }
	});
	map.addLayer({
		id: `${SELECTION_SOURCE}:point`, type: 'circle', source: SELECTION_SOURCE,
		filter: isGeom('Point'),
		paint: { 'circle-radius': 9, 'circle-color': '#fff', 'circle-opacity': 0, 'circle-stroke-color': '#111', 'circle-stroke-width': 2 }
	});
}

/** Clears the selected feature and its map highlight. */
export function clearSelection(map) {
	if (!activeSelection) return;
	const { onFeatureSelect } = activeSelection;
	activeSelection = null;
	for (const id of [`${SELECTION_SOURCE}:line`, `${SELECTION_SOURCE}:point`])
		if (map.getLayer(id)) map.removeLayer(id);
	if (map.getSource(SELECTION_SOURCE)) map.removeSource(SELECTION_SOURCE);
	nonInteractive.delete(SELECTION_SOURCE);
	onFeatureSelect(null, null);
}

/** Current view as [w, s, e, n], grown by `scale` around its centre. */
export function viewBbox (map, scale = 1) {
	const [[w, s], [e, n]] = map.getBounds().toArray();
	const dx = ((e - w) * (scale - 1)) / 2, dy = ((n - s) * (scale - 1)) / 2;
	return [w - dx, s - dy, e + dx, n + dy];
}

/** Adds a raster or GeoJSON source with optional per-layer display tweaks. */
export function addOverlay (map, id, source, layer = {}) {
	map.addSource(id, source);
	// Rasters cover the whole view, so they go under the basemap labels and stay a bit see-through.
	if (source.type === 'raster')
		return map.addLayer(
			{ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.8 } },
			map.getStyle().layers.find((l) => l.type === 'symbol')?.id
		);
	if (layer.details) overlayDetails.set(id, layer.details);
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
		});
}

/** Makes a GeoJSON overlay show exactly `features`, removing and adding only what changed (by feature id). */
export function syncFeatures (map, id, features) {
	const shown = shownIds.get(id) ?? new Set();
	const next = new Set(features.map((f) => f.id));
	map.getSource(id).updateData({
		remove: [...shown].filter((fid) => !next.has(fid)),
		add: features.filter((f) => !shown.has(f.id))
	});
	shownIds.set(id, next);
}

export function removeOverlay (map, id) {
	if (activeSelection?.sourceId === id) clearSelection(map);
	for (const l of map.getStyle().layers) if (l.source === id) map.removeLayer(l.id);
	map.removeSource(id);
	shownIds.delete(id);
	nonInteractive.delete(id);
	overlayDetails.delete(id);
}
