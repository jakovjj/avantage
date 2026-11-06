import { MapLibreMap, NavigationControl, Popup, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { propsTable } from './utils.js';

// MapLibre resolves its worker next to itself, which breaks once Vite bundles it.
setWorkerUrl(workerUrl);

const COLORS = ['#e6194b', '#4363d8', '#3cb44b', '#f58231', '#911eb4', '#008080', '#f032e6'];
let colorIndex = 0;
const shownIds = new Map(); // GeoJSON overlay id → Set of feature ids currently on the map
let activePopup; // { popup, sourceId }

const isGeom = (t) => ['in', ['geometry-type'], ['literal', [t, `Multi${t}`]]];

// Only our overlays use GeoJSON sources; the basemap is vector tiles.
const overlayFeature = (map, point) =>
	map.queryRenderedFeatures(point).find((f) => map.getSource(f.source)?.type === 'geojson');

/** Resolves with a map of Croatia once its style has loaded. */
export function createMap (container) {
	const map = new MapLibreMap({
		container,
		style: 'https://tiles.openfreemap.org/styles/positron',
		bounds: [[13.2, 42.2], [19.7, 46.7]]
	});
	map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right'); // top-right holds the debug readout
	map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
	map.on('click', (e) => {
		const f = overlayFeature(map, e.point);
		if (!f) return;
		activePopup?.popup.remove();
		const popup = new Popup({ maxWidth: '360px' })
			.setLngLat(e.lngLat)
			.setHTML(propsTable(f.properties))
			.addTo(map);
		activePopup = { popup, sourceId: f.source };
		popup.on('close', () => {
			if (activePopup?.popup === popup) activePopup = null;
		});
	});
	map.on('mousemove', (e) => (map.getCanvas().style.cursor = overlayFeature(map, e.point) ? 'pointer' : ''));
	return new Promise((resolve) => map.once('load', () => resolve(map)));
}

/** Current view as [w, s, e, n], grown by `scale` around its centre. */
export function viewBbox (map, scale = 1) {
	const [[w, s], [e, n]] = map.getBounds().toArray();
	const dx = ((e - w) * (scale - 1)) / 2, dy = ((n - s) * (scale - 1)) / 2;
	return [w - dx, s - dy, e + dx, n + dy];
}

/** Adds a raster or GeoJSON source; `paint` overrides the GeoJSON styles per kind (fill / line / circle). */
export function addOverlay (map, id, source, paint = {}) {
	map.addSource(id, source);
	if (source.type === 'raster') return map.addLayer({ id, type: 'raster', source: id });
	const color = COLORS[colorIndex++ % COLORS.length];
	const kinds = {
		fill: [isGeom('Polygon'), { 'fill-color': color, 'fill-opacity': 0.2 }],
		line: [['!', isGeom('Point')], { 'line-color': color, 'line-width': 1.5 }],
		circle: [isGeom('Point'), { 'circle-color': color, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 }]
	};
	for (const [type, [filter, base]] of Object.entries(kinds))
		map.addLayer({ id: `${id}:${type}`, source: id, type, filter, paint: { ...base, ...paint[type] } });
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
	if (activePopup?.sourceId === id) {
		activePopup.popup.remove();
		activePopup = null;
	}
	for (const l of map.getStyle().layers) if (l.source === id) map.removeLayer(l.id);
	map.removeSource(id);
	shownIds.delete(id);
}
