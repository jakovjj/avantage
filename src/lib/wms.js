// Clicking a layer the WMS draws (`featureInfo` tweak): glues ogc.js (GetFeatureInfo, outline tiles) and map.js
// (click box, selection), like wfs.js does for WFS layers.
import { attributeNames, featureInfo, outlineSource } from './ogc.js';
import { OUTLINE_COLOR, clickBox, selectRemote, setClickable } from './map.js';

/**
 * Answers map clicks on WMS layer `name` of `service`, shown as overlay `id`: the feature there opens in the details
 * panel, outlined by the server. Its attributes come from the same layer in `wfs` (`wfsName`), so the geometry is left
 * out. Returns a function that stops it.
 */
export function queryOnClick(map, id, service, name, wfs, wfsName) {
	const properties = attributeNames(wfs, wfsName).catch(() => null);
	let latest = 0;
	const onClick = async (e) => {
		if (e.defaultPrevented) return; // a feature the map draws itself was clicked
		const click = ++latest;
		try {
			const feature = await featureInfo(service, name, { ...clickBox(map, e.point), properties: await properties });
			if (feature && click === latest) selectRemote(map, id, feature, outlineSource(service, name, feature.id, OUTLINE_COLOR));
		} catch {
			// no answer: the click just selects nothing
		}
	};
	map.on('click', onClick);
	setClickable(id, true);
	return () => (map.off('click', onClick), setClickable(id, false));
}
