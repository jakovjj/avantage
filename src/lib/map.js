import { MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import maskUrl from './croatia-mask.json?url';
import { simplify, track } from './utils.js';

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
// Rendered features keep only numeric ids and geometry rounded to the clicked zoom's tile grid (metres off at low
// zoom), so each feature gets a numeric id that leads a click back to the feature exactly as it was loaded.
const shownFeatures = new Map(); // GeoJSON overlay id → Map(numeric id → loaded feature) currently on the map
const numericIds = new Map(); // feature id → numeric id
const numericId = (fid) => numericIds.get(fid) ?? numericIds.set(fid, numericIds.size + 1).get(fid);
const nonInteractive = new Set();
const overlayLayers = new Map(); // overlay id → its per-layer tweaks from sources.js, for the details panel
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
	// The label filter tests every label against every border point (13,846), which made drawing tiles ~3× slower;
	// ~500 m accuracy (900 points) costs nothing noticeable. The mask itself keeps the full border.
	const croatia = { type: 'MultiPolygon', coordinates: mask.coordinates.slice(1).map((ring) => [simplify(ring, 0.005)]) };
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
		maxBounds: MAX_BOUNDS // all data is Croatian: keep the view close to it
	});
	map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right'); // top-right holds the debug readout
	map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
	map.on('click', (e) => {
		const rendered = overlayFeature(map, e.point);
		if (!rendered) return;
		const f = shownFeatures.get(rendered.source)?.get(rendered.id) ?? rendered;
		showSelection(map, f, rendered);
		activeSelection = { sourceId: rendered.source, onFeatureSelect };
		onFeatureSelect(f, rendered.source, overlayLayers.get(rendered.source));
	});
	map.on('mousemove', (e) => (map.getCanvas().style.cursor = overlayFeature(map, e.point) ? 'pointer' : ''));
	map.on('dataloading', (e) => e.sourceId && map.getSource(e.sourceId)?.type === 'raster' && onLoading(true));
	map.on('idle', () => onLoading(false));
	return new Promise((resolve) => map.once('load', () => resolve(map)));
}

// The selected feature glows: a soft amber disc under a point's marker, sized to it (circles and icons of any shape
// and size), and an amber outline over lines and areas.
const HIGHLIGHT = '#ffb300';

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
			filter: ['!', isGeom('Point')], paint: { 'line-color': HIGHLIGHT, 'line-width': 4, 'line-opacity': 0.9 }
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
	overlayLayers.set(id, layer);
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
		});
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
	for (const l of map.getStyle().layers) if (l.source === id) map.removeLayer(l.id);
	map.removeSource(id);
	shownFeatures.delete(id);
	nonInteractive.delete(id);
	overlayLayers.delete(id);
}
