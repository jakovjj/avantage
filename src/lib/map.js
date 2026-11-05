import { MapLibreMap, Popup, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { propsTable } from './utils.js';

// MapLibre resolves its worker next to itself, which breaks once Vite bundles it.
setWorkerUrl(workerUrl);

const COLORS = ['#e6194b', '#4363d8', '#3cb44b', '#f58231', '#911eb4', '#008080', '#f032e6'];
let colorIndex = 0;

const isGeom = (t) => ['in', ['geometry-type'], ['literal', [t, `Multi${t}`]]];

// Only our overlays use GeoJSON sources; the basemap is vector tiles.
const overlayFeature = (map, point) =>
	map.queryRenderedFeatures(point).find((f) => map.getSource(f.source)?.type === 'geojson');

/** Resolves with a map of Croatia once its style has loaded. */
export function createMap(container) {
	const map = new MapLibreMap({
		container,
		style: 'https://tiles.openfreemap.org/styles/positron',
		bounds: [[13.2, 42.2], [19.7, 46.7]]
	});
	map.on('click', (e) => {
		const f = overlayFeature(map, e.point);
		if (f) new Popup({ maxWidth: '360px' }).setLngLat(e.lngLat).setHTML(propsTable(f.properties)).addTo(map);
	});
	map.on('mousemove', (e) => (map.getCanvas().style.cursor = overlayFeature(map, e.point) ? 'pointer' : ''));
	return new Promise((resolve) => map.once('load', () => resolve(map)));
}

export function addOverlay(map, id, source) {
	map.addSource(id, source);
	if (source.type === 'raster') return map.addLayer({ id, type: 'raster', source: id });
	const color = COLORS[colorIndex++ % COLORS.length];
	map.addLayer({ id: `${id}:fill`, source: id, type: 'fill', filter: isGeom('Polygon'), paint: { 'fill-color': color, 'fill-opacity': 0.2 } });
	map.addLayer({ id: `${id}:line`, source: id, type: 'line', filter: ['!', isGeom('Point')], paint: { 'line-color': color, 'line-width': 1.5 } });
	map.addLayer({
		id: `${id}:circle`, source: id, type: 'circle', filter: isGeom('Point'),
		paint: { 'circle-color': color, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 }
	});
}

export function removeOverlay(map, id) {
	for (const l of map.getStyle().layers) if (l.source === id) map.removeLayer(l.id);
	map.removeSource(id);
}
