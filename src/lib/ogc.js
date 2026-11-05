// OGC services (WMS / WFS / WMTS): capabilities introspection and MapLibre source specs.
import { WfsEndpoint, WmsEndpoint, WmtsEndpoint } from '@camptocamp/ogc-client';
import { escapeHtml, fetchText } from './utils.js';

const ENDPOINTS = { WMS: WmsEndpoint, WFS: WfsEndpoint, WMTS: WmtsEndpoint };
export const MAX_FEATURES = 5000;

/** Service type from a `service=` param or the URL path, if present. */
function guessType(url) {
	const u = new URL(url);
	const s = [...u.searchParams].find(([k]) => k.toLowerCase() === 'service')?.[1] ??
		u.pathname.match(/wmts|wms|wfs/i)?.[0];
	return s && s.toUpperCase() in ENDPOINTS ? s.toUpperCase() : null;
}

function listLayers(type, endpoint) {
	if (type === 'WFS') return endpoint.getFeatureTypes().map((f) => ({ name: f.name, title: f.title || f.name }));
	if (type === 'WMTS') return endpoint.getLayers().map((l) => ({ name: l.name, title: l.name }));
	return endpoint.getFlattenedLayers().filter((l) => l.name).map((l) => ({ name: l.name, title: l.title || l.name }));
}

/** Reads GetCapabilities; without a known type, tries each service type in turn. */
export async function inspect(url, type = guessType(url)) {
	const errors = [];
	for (const t of type ? [type] : Object.keys(ENDPOINTS)) {
		try {
			const endpoint = await new ENDPOINTS[t](url).isReady();
			const capabilitiesUrl = endpoint.getCapabilitiesUrl?.() ?? url; // WmtsEndpoint lacks it
			return { type: t, endpoint, capabilitiesUrl, info: endpoint.getServiceInfo(), layers: listLayers(t, endpoint) };
		} catch (e) {
			errors.push(`${t}: ${e.message}`);
		}
	}
	throw new Error(errors.join('\n'));
}

function wmsTiles(endpoint, name) {
	const url = endpoint.getMapUrl([name], {
		widthPx: 256, heightPx: 256, crs: 'EPSG:3857', extent: [0, 0, 0, 0], outputFormat: 'image/png'
	});
	return url.replace(/BBOX=[^&]*/i, 'BBOX={bbox-epsg-3857}') + '&TRANSPARENT=TRUE';
}

// OGC scale denominator of a 256 px Web Mercator tile at zoom 0.
const ZOOM0_SCALE = 559082264.0287178;

/** Tile zooms where a WMS layer draws anything, from its declared scale limits. */
function wmsZooms(endpoint, name) {
	const { minScaleDenominator: min, maxScaleDenominator: max } = endpoint.getLayerByName(name) ?? {};
	return {
		...(max && { minzoom: Math.max(0, Math.ceil(Math.log2(ZOOM0_SCALE / max))) }),
		// beyond this the server draws nothing, so MapLibre enlarges these tiles instead
		...(min && { maxzoom: Math.min(22, Math.floor(Math.log2(ZOOM0_SCALE / min))) })
	};
}

// MapLibre only draws Web Mercator tiles, so the layer needs a 3857 matrix set starting at zoom 0.
function wmtsTiles(endpoint, name) {
	const layer = endpoint.getLayerByName(name);
	for (const { identifier } of layer.matrixSets) {
		const set = endpoint.getMatrixSetByIdentifier(identifier);
		const prefix = set.tileMatrices[0]?.identifier.match(/^(.*?)0$/)?.[1];
		if (/(3857|900913)$/.test(set.crs) && prefix != null)
			return endpoint
				.getTileUrl(name, layer.defaultStyle, identifier, `${prefix}{z}`, '{y}', '{x}')
				.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
	}
	throw new Error('Sloj nema EPSG:3857 mrežu pločica');
}

/** WFS layer features (GeoJSON, WGS84), optionally inside bbox [w, s, e, n]; null if over maxBytes. */
export async function getFeatures({ endpoint }, name, { bbox, maxBytes, signal } = {}) {
	const url = endpoint.getFeatureUrl(name, {
		asJson: true, outputCrs: 'EPSG:4326', maxFeatures: MAX_FEATURES, extent: bbox, extentCrs: 'EPSG:4326'
	});
	const text = await fetchText(url, { maxBytes, signal });
	if (text === null) return null;
	try {
		return JSON.parse(text).features;
	} catch {
		throw new Error(text.slice(0, 300));
	}
}

/** Who publishes the data, as stated in GetCapabilities. */
export const providerName = ({ info, capabilitiesUrl }) =>
	info.provider?.name || info.provider?.contact?.organization || new URL(capabilitiesUrl).host;

/** HTML credit for the map's attribution control. */
export const attribution = (service) => escapeHtml(providerName(service));

/** MapLibre tile source for a WMS or WMTS layer. */
export const rasterSource = (service, name) => ({
	type: 'raster',
	tileSize: 256,
	attribution: attribution(service),
	...(service.type === 'WMS'
		? { tiles: [wmsTiles(service.endpoint, name)], ...wmsZooms(service.endpoint, name) }
		: { tiles: [wmtsTiles(service.endpoint, name)] })
});

export const legendUrl = ({ type, endpoint }, name) =>
	type === 'WMS' ? endpoint.getLayerByName(name)?.styles[0]?.legendUrl : undefined;
