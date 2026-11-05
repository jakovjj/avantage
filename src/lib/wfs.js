// WFS layers on the map: small ones are loaded once and kept in memory,
// big ones are fetched for the current view and updated as the map moves.
import { attribution, getFeatures, MAX_FEATURES } from './ogc.js';
import { addOverlay, removeOverlay, syncFeatures, viewBbox } from './map.js';
import { bboxContains } from './utils.js';

const SMALL_BYTES = 100_000; // a whole layer up to this size is kept in memory
const VIEW_BYTES = 4_000_000; // download budget for one view of a big layer
const VIEW_SCALE = 1.2; // fetch a bit beyond the view so small pans need no request
const wholeLayers = new Map(); // overlay id → all features of a small layer, or null for a big one

/**
 * Shows a WFS layer and returns a function that removes it.
 * `layer` holds optional per-layer tweaks from sources.js; `onNote` receives short status text.
 */
export function showWfs(map, id, service, name, layer = {}, onNote) {
	addOverlay(map, id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: attribution(service) }, layer.paint);
	const show = (features) => syncFeatures(map, id, layer.id ? features.map((f) => ({ ...f, id: layer.id(f) })) : features);
	let request, covered; // covered: area of the last complete response

	const run = async (task) => {
		request?.abort();
		request = new AbortController();
		onNote('…');
		try {
			onNote(await task(request.signal));
		} catch (e) {
			if (e.name !== 'AbortError') onNote(e.message);
		}
	};

	const loadView = async (signal) => {
		const bbox = viewBbox(map, VIEW_SCALE);
		const features = await getFeatures(service, name, { bbox, maxBytes: VIEW_BYTES, signal });
		if (!features) return 'previše podataka, približi kartu';
		show(features);
		covered = features.length < MAX_FEATURES ? bbox : null;
		return covered ? features.length : `${MAX_FEATURES}+, približi kartu`;
	};
	const followView = () => {
		if (!covered || !bboxContains(covered, viewBbox(map))) run(loadView);
	};

	run(async (signal) => {
		if (!wholeLayers.has(id)) wholeLayers.set(id, await getFeatures(service, name, { maxBytes: SMALL_BYTES, signal }));
		const all = wholeLayers.get(id);
		if (!all) {
			map.on('moveend', followView);
			return loadView(signal);
		}
		show(all);
		return all.length;
	});

	return () => {
		request?.abort();
		map.off('moveend', followView);
		removeOverlay(map, id);
	};
}
