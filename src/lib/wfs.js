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
export function showWfs(map, id, service, name, layer = {}, onNote, onLimit) {
	addOverlay(map, id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: attribution(service) }, layer);
	const show = (features) => syncFeatures(map, id, layer.id ? features.map((f) => ({ ...f, id: layer.id(f) })) : features);
	let request, covered, started = false, isBig = false, disposed = false, zooming = false; // covered: area of the last complete response
	const zoomAllowed = () => !Number.isFinite(layer.minZoom) || map.getZoom() >= layer.minZoom;

	const run = async (task) => {
		if (!zoomAllowed()) {
			onNote?.('približi kartu');
			return null;
		}
		request?.abort();
		request = new AbortController();
		onNote?.('…');
		try {
			const result = await task(request.signal);
			onNote?.(typeof result === 'object' ? result.note : result);
			return result;
		} catch (e) {
			if (e.name === 'AbortError') {
				if (!isBig) started = false;
			} else onNote?.(e.message);
			return null;
		}
	};

	const loadView = async (signal) => {
		if (!zoomAllowed()) return { note: 'približi kartu' };
		const bbox = viewBbox(map, VIEW_SCALE);
		const features = await getFeatures(service, name, { bbox, maxBytes: VIEW_BYTES, signal });
		if (!zoomAllowed()) return { note: 'približi kartu' };
		if (!features) {
			onLimit?.(true, zoomToFit);
			return { limited: true, note: '' };
		}
		show(features);
		covered = features.length < MAX_FEATURES ? bbox : null;
		if (covered) onLimit?.(false);
		else onLimit?.(true, zoomToFit);
		return { limited: !covered, note: covered ? features.length : '' };
	};
	const zoomToFit = async () => {
		zooming = true;
		try {
			while (!disposed) {
				const maxZoom = Number.isFinite(layer.minZoom) ? Math.min(map.getMaxZoom() ?? 22, layer.minZoom) : map.getMaxZoom() ?? 22;
				if (map.getZoom() >= maxZoom) {
					onLimit?.(true, zoomToFit, true);
					return;
				}
				await new Promise((resolve) => {
					map.once('moveend', resolve);
					map.zoomTo(Math.min(maxZoom, Math.max(map.getZoom() + 1, layer.minZoom ?? 0)), { duration: 250 });
				});
				if (disposed) return;
				const result = await run(loadView);
				if (!result || !result.limited) return;
			}
		} finally {
			zooming = false;
		}
	};
	const start = () => {
		if (!zoomAllowed()) {
			onNote?.('približi kartu');
			return;
		}
		if (started) return;
		started = true;
		run(async (signal) => {
			if (!wholeLayers.has(id)) wholeLayers.set(id, await getFeatures(service, name, { maxBytes: SMALL_BYTES, signal }));
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
		if (zooming) return;
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
		disposed = true;
		request?.abort();
		map.off('moveend', followView);
		onLimit?.(false);
		removeOverlay(map, id);
	};
}
