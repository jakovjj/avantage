// Clicking a layer the WMS draws (`featureInfo` tweak): glues ogc.js (GetFeatureInfo, outline tiles) and map.js
// (click box, selection), like wfs.js does for WFS layers.
import { attributeNames, featureInfo, outlineSource } from './ogc.js';
import { OUTLINE_COLOR, clickBox, setClickable } from './map.js';

/**
 * Answers map clicks on WMS layer `name` of `service`, shown as overlay `id`: the feature there opens in the details
 * panel, outlined by the server. Its attributes come from the same layer in `wfs` (`wfsName`), so the geometry is left
 * out. `point`: the layer has points, outlined by a ring. Returns a function that stops it.
 */
export function queryOnClick(map, id, service, name, wfs, wfsName, point) {
	const properties = attributeNames(wfs, wfsName).catch(() => null);
	// map.js asks this on a click, alongside the other layers, and picks the winner.
	setClickable(id, async (at) => {
		const feature = await featureInfo(service, name, { ...clickBox(map, at), properties: await properties });
		return feature && { feature, outline: outlineSource(service, name, feature.id, OUTLINE_COLOR, point) };
	});
	return () => setClickable(id, null);
}
