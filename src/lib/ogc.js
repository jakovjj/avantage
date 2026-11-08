// OGC services (WMS / WFS / WMTS): capabilities introspection and MapLibre source specs.
import { WfsEndpoint, WmsEndpoint, WmtsEndpoint } from '@camptocamp/ogc-client';
import { escapeHtml, fetchText } from './utils.js';

const ENDPOINTS = { WMS: WmsEndpoint, WFS: WfsEndpoint, WMTS: WmtsEndpoint };
// WMS servers render each tile on request (~0.3-1 s), so bigger tiles mean 4x fewer requests and a less patchy map.
const WMS_TILE = 512;
export const MAX_FEATURES = 5000;

/** Service type from a `service=` param or the URL path, if present. */
function guessType(url) {
	const u = new URL(url);
	const s = [...u.searchParams].find(([k]) => k.toLowerCase() === 'service')?.[1] ??
		u.pathname.match(/wmts|wms|wfs/i)?.[0];
	return s && s.toUpperCase() in ENDPOINTS ? s.toUpperCase() : null;
}

const GEOMETRY_KINDS = [[/Point/, 'points'], [/Curve|LineString/, 'lines'], [/Surface|Polygon/, 'areas']];

/** Geometry kind per WFS feature type name (without namespace), from one DescribeFeatureType for the whole service. */
async function wfsKinds(url) {
	try {
		const u = new URL(url);
		for (const k of [...u.searchParams.keys()]) if (/^(service|request|version)$/i.test(k)) u.searchParams.delete(k);
		for (const [k, v] of Object.entries({ service: 'WFS', version: '2.0.0', request: 'DescribeFeatureType' })) u.searchParams.set(k, v);
		const xsd = await fetchText(u.href);
		const typeKinds = {};
		for (const [, type, body] of xsd.matchAll(/<(?:\w+:)?complexType name="([^"]+)"([\s\S]*?)<\/(?:\w+:)?complexType>/g)) {
			const geom = body.match(/gml:(\w+)PropertyType/)?.[1] ?? '';
			typeKinds[type] = kindOfGeometry(geom);
		}
		const kinds = {};
		for (const [tag] of xsd.matchAll(/<(?:\w+:)?element [^>]*substitutionGroup[^>]*>/g)) {
			const name = tag.match(/ name="([^"]+)"/)?.[1], type = tag.match(/ type="(?:[^":]+:)?([^"]+)"/)?.[1];
			if (name) kinds[name] = typeKinds[type];
		}
		return kinds;
	} catch {
		return {}; // the symbol is only a hint, so a failed lookup must not break the service
	}
}

const kindOfGeometry = (type) => GEOMETRY_KINDS.find(([re]) => re.test(type))?.[1];

/** Fills in kinds the schema leaves generic (gml:GeometryPropertyType) from one sample feature of each such layer. */
async function sampleKinds(endpoint, kinds) {
	await Promise.all(endpoint.getFeatureTypes().map(async ({ name }) => {
		const key = name.split(':').pop();
		if (kinds[key]) return;
		try {
			const text = await fetchText(endpoint.getFeatureUrl(name, { asJson: true, maxFeatures: 1 }), { maxBytes: 500_000 });
			kinds[key] = text && kindOfGeometry(JSON.parse(text).features?.[0]?.geometry?.type ?? '');
		} catch {
			// no symbol for this layer
		}
	}));
	return kinds;
}

function listLayers(type, endpoint, kinds) {
	if (type === 'WFS')
		return endpoint.getFeatureTypes().map((f) => ({ name: f.name, title: f.title || f.name, kind: kinds[f.name.split(':').pop()] }));
	if (type === 'WMTS') return endpoint.getLayers().map((l) => ({ name: l.name, title: l.name, kind: 'raster' }));
	return endpoint.getFlattenedLayers().filter((l) => l.name).map((l) => ({ name: l.name, title: l.title || l.name, kind: 'raster' }));
}

/** Reads GetCapabilities; without a known type, tries each service type in turn. */
export async function inspect(url, type = guessType(url)) {
	const errors = [];
	for (const t of type ? [type] : Object.keys(ENDPOINTS)) {
		try {
			let [endpoint, kinds] = await Promise.all([new ENDPOINTS[t](url).isReady(), t === 'WFS' ? wfsKinds(url) : {}]);
			if (t === 'WFS') kinds = await sampleKinds(endpoint, kinds);
			const capabilitiesUrl = endpoint.getCapabilitiesUrl?.() ?? url; // WmtsEndpoint lacks it
			return { type: t, endpoint, capabilitiesUrl, info: endpoint.getServiceInfo(), layers: listLayers(t, endpoint, kinds) };
		} catch (e) {
			errors.push(`${t}: ${e.message}`);
		}
	}
	throw new Error(errors.join('\n'));
}

function wmsTiles(endpoint, name) {
	const url = endpoint.getMapUrl([name], {
		widthPx: WMS_TILE, heightPx: WMS_TILE, crs: 'EPSG:3857', extent: [0, 0, 0, 0], outputFormat: 'image/png'
	});
	return url.replace(/BBOX=[^&]*/i, 'BBOX={bbox-epsg-3857}') + '&TRANSPARENT=TRUE';
}

// OGC scale denominator of a Web Mercator WMS tile at zoom 0.
const ZOOM0_SCALE = 559082264.0287178 * 256 / WMS_TILE;

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

/**
 * WFS layer features (GeoJSON, WGS84), optionally inside bbox [w, s, e, n]; null if over maxBytes.
 * Only a view (bbox) is capped at MAX_FEATURES; a whole layer is all or nothing, limited by maxBytes.
 */
export async function getFeatures({ endpoint }, name, { bbox, maxBytes, signal } = {}) {
	const url = endpoint.getFeatureUrl(name, {
		asJson: true, outputCrs: 'EPSG:4326', maxFeatures: bbox ? MAX_FEATURES : undefined, extent: bbox, extentCrs: 'EPSG:4326'
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
	attribution: attribution(service),
	...(service.type === 'WMS'
		? { tileSize: WMS_TILE, tiles: [wmsTiles(service.endpoint, name)], ...wmsZooms(service.endpoint, name) }
		: { tileSize: 256, tiles: [wmtsTiles(service.endpoint, name)] })
});

export const legendUrl = ({ type, endpoint }, name) =>
	type === 'WMS' ? endpoint.getLayerByName(name)?.styles[0]?.legendUrl : undefined;
