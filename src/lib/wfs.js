// WFS layers on the map: small ones are loaded once and kept in memory,
// big ones are fetched for the current view and updated as the map moves.
import { attribution, getFeatures, MAX_FEATURES } from './ogc.js';
import { addOverlay, removeOverlay, syncFeatures, viewBbox } from './map.js';
import { bboxContains, fetchText } from './utils.js';

const SMALL_BYTES = 100_000; // a whole layer up to this size is kept in memory
const VIEW_BYTES = 4_000_000; // download budget for one view of a big layer
const VIEW_SCALE = 1.2; // fetch a bit beyond the view so small pans need no request
const wholeLayers = new Map(); // overlay id → all features of a small layer, or null for a big one

/**
 * Shows a WFS layer and returns a function that removes it.
 * `layer` holds optional per-layer tweaks from sources.js; `onNote` receives short status text.
 */
export function showWfs(map, id, service, name, layer = {}, onNote) {
	const kind = service.layers.find((l) => l.name === name)?.kind;
	addOverlay(map, id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: attribution(service) }, layer, kind);
	const show = (features) => syncFeatures(map, id, layer.id ? features.map((f) => ({ ...f, id: layer.id(f) })) : features);
	let request, covered, started = false, isBig = false; // covered: area of the last complete response
	const zoomAllowed = () => !Number.isFinite(layer.minZoom) || map.getZoom() >= layer.minZoom;

	const run = async (task) => {
		if (!zoomAllowed()) return onNote?.('približi kartu');
		request?.abort();
		request = new AbortController();
		onNote?.('…');
		try {
			onNote?.(await task(request.signal));
		} catch (e) {
			if (e.name === 'AbortError') {
				if (!isBig) started = false;
			} else onNote?.(e.message);
		}
	};

	// Over the per-view limits, show what fits (or keep the last view) and ask to zoom in.
	const loadView = async (signal) => {
		if (!zoomAllowed()) return 'približi kartu';
		const bbox = viewBbox(map, VIEW_SCALE);
		const features = await getFeatures(service, name, { bbox, maxBytes: VIEW_BYTES, signal });
		if (!zoomAllowed() || !features) return 'približi kartu';
		show(features);
		covered = features.length < MAX_FEATURES ? bbox : null;
		return covered ? features.length : 'približi kartu';
	};
	const start = () => {
		if (!zoomAllowed()) {
			onNote?.('približi kartu');
			return;
		}
		if (started) return;
		started = true;
		run(async (signal) => {
			if (!wholeLayers.has(id))
				wholeLayers.set(id, layer.snapshot
					? JSON.parse(await fetchText(layer.snapshot, { signal })).features
					: await getFeatures(service, name, { maxBytes: layer.loadAll ? Infinity : SMALL_BYTES, signal }));
			if (!zoomAllowed()) {
				started = false;
				return 'približi kartu';
			}
			const all = wholeLayers.get(id);
			if (!all) {
				isBig = true;
				return loadView(signal);
			}
			show(all);
			return all.length;
		});
	};
	const followView = () => {
		if (!zoomAllowed()) {
			request?.abort();
			onNote?.('približi kartu');
			return;
		}
		if (!started) return start();
		if (isBig && (!covered || !bboxContains(covered, viewBbox(map)))) run(loadView);
	};
	map.on('moveend', followView);
	start();

	return () => {
		request?.abort();
		map.off('moveend', followView);
		removeOverlay(map, id);
	};
}
