// OGC services (WMS / WFS / WMTS): capabilities introspection and MapLibre source specs.
import { WfsEndpoint, WmsEndpoint, WmtsEndpoint } from '@camptocamp/ogc-client';
import { escapeHtml, fetchText, track } from './utils.js';
import { PROVIDER_NAMES } from './sources.js';

const ENDPOINTS = { WMS: WmsEndpoint, WFS: WfsEndpoint, WMTS: WmtsEndpoint };
// WMS servers render each tile on request (~0.3-1 s), so bigger tiles mean 4x fewer requests and a less patchy map.
// Not for every server: where rendering grows faster than the area, a layer's `tileSize` tweak asks for 256.
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

const words = (s) => new Set(s?.toLowerCase().match(/[\p{L}\d]+/gu) ?? []);

/**
 * Public page of a metadata record. Layers link to GeoNetwork catalogues (the national NIPP geoportal) by URLs that
 * need a login or are plain http, while the catalogue's own record page works. The records themselves can't be read
 * from a browser: NIPP sends its CORS header twice ("*, *"), which browsers reject.
 */
function recordPage(url) {
	const u = new URL(url);
	const id = u.searchParams.get('uuid') ?? u.searchParams.get('id');
	const catalogue = u.pathname.match(/^\/[^/]+\/srv\//)?.[0];
	return id && catalogue ? `https://${u.host}${catalogue}hrv/catalog.search#/metadata/${id}` : url;
}

/**
 * Official description of a layer, or null: its own abstract when that says something (most servers repeat the
 * title, "null", or the service's abstract), with the page of a metadata record it links to, if any.
 */
function about({ title, abstract, metadata }, serviceAbstract) {
	const known = words(title);
	if (!abstract || abstract === serviceAbstract || [...words(abstract)].filter((w) => !known.has(w)).length < 3) return null;
	const record = metadata?.[0]?.url;
	return { text: abstract.trim(), record: record && recordPage(record) };
}

function listLayers(type, endpoint, kinds) {
	const serviceAbstract = endpoint.getServiceInfo().abstract;
	if (type === 'WFS')
		return endpoint.getFeatureTypes().map((f) => ({
			name: f.name, title: f.title || f.name, kind: kinds[f.name.split(':').pop()],
			about: about(endpoint.getFeatureTypeSummary(f.name) ?? f, serviceAbstract)
		}));
	if (type === 'WMTS') return endpoint.getLayers().map((l) => ({ name: l.name, title: l.name, kind: 'raster' }));
	return endpoint.getFlattenedLayers().filter((l) => l.name).map((l) => ({
		name: l.name, title: l.title || l.name, kind: 'raster', about: about(endpoint.getLayerByName(l.name) ?? l, serviceAbstract)
	}));
}

// One read per service: it's listed in two parts of the sidebar, and WMS-drawn WFS layers ask its WMS on every toggle.
const inspected = new Map();

/** Reads GetCapabilities (once, unless it failed); without a known type, tries each service type in turn. */
export function inspect(url, type = guessType(url)) {
	const key = `${type} ${url}`;
	if (!inspected.has(key)) inspected.set(key, readCapabilities(url, type).catch((e) => (inspected.delete(key), Promise.reject(e))));
	return inspected.get(key);
}

async function readCapabilities(url, type) {
	const errors = [];
	for (const t of type ? [type] : Object.keys(ENDPOINTS)) {
		try {
			let [endpoint, kinds] = await Promise.all([track(new ENDPOINTS[t](url).isReady()), t === 'WFS' ? wfsKinds(url) : {}]);
			if (t === 'WFS') kinds = await sampleKinds(endpoint, kinds);
			const capabilitiesUrl = endpoint.getCapabilitiesUrl?.() ?? url; // WmtsEndpoint lacks it
			return { type: t, endpoint, capabilitiesUrl, info: endpoint.getServiceInfo(), layers: listLayers(t, endpoint, kinds) };
		} catch (e) {
			errors.push(`${t}: ${e.message}`);
		}
	}
	throw new Error(errors.join('\n'));
}

function wmsTiles(endpoint, name, size, format = 'image/png') {
	const url = endpoint.getMapUrl([name], {
		widthPx: size, heightPx: size, crs: 'EPSG:3857', extent: [0, 0, 0, 0], outputFormat: format
	});
	return url.replace(/BBOX=[^&]*/i, 'BBOX={bbox-epsg-3857}') + '&TRANSPARENT=TRUE';
}

/** A WMS layer's extent in lon/lat, so MapLibre asks for no tiles beyond it (some servers draw those black or white). */
function wmsBounds(endpoint, name) {
	const boxes = endpoint.getLayerByName(name)?.boundingBoxes ?? {};
	const bounds = boxes['CRS:84'] ?? boxes['EPSG:4326'];
	return bounds?.every(Number.isFinite) ? { bounds } : {};
}

/** Tile zooms where a WMS layer draws anything, from its declared scale limits. */
function wmsZooms(endpoint, name, size) {
	const zoom0Scale = 559082264.0287178 * 256 / size; // OGC scale denominator of a Web Mercator tile at zoom 0
	const { minScaleDenominator: min, maxScaleDenominator: max } = endpoint.getLayerByName(name) ?? {};
	return {
		...(max && { minzoom: Math.max(0, Math.ceil(Math.log2(zoom0Scale / max))) }),
		// beyond this the server draws nothing, so MapLibre enlarges these tiles instead
		...(min && { maxzoom: Math.min(22, Math.floor(Math.log2(zoom0Scale / min))) })
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
export function providerName({ info, capabilitiesUrl }) {
	const name = info.provider?.name || info.provider?.contact?.organization || new URL(capabilitiesUrl).host;
	return PROVIDER_NAMES[name] ?? name;
}

/** HTML credit for the map's attribution control. */
export const attribution = (service) => escapeHtml(providerName(service));

/** Attribute names of a WFS layer, without its geometry (DescribeFeatureType). */
export const attributeNames = async ({ endpoint }, name) => Object.keys((await track(endpoint.getFeatureTypeFull(name))).properties);

/**
 * The feature of a WMS layer at pixel (i, j) of a `size` px GetMap of `bbox` (EPSG:3857), or null. Only `properties`
 * are asked for (GeoServer's PROPERTYNAME): with its geometry, one big polygon can be 20+ MB.
 */
export async function featureInfo({ endpoint }, name, { bbox, size, i, j, properties }) {
	const url = new URL(endpoint.getMapUrl([name], { widthPx: size, heightPx: size, crs: 'EPSG:3857', extent: bbox, outputFormat: 'image/png' }));
	const query = { REQUEST: 'GetFeatureInfo', QUERY_LAYERS: name, INFO_FORMAT: 'application/json', FEATURE_COUNT: 1, I: i, J: j };
	for (const [key, value] of Object.entries({ ...query, ...(properties && { PROPERTYNAME: properties.join(',') }) }))
		url.searchParams.set(key, value);
	return JSON.parse(await fetchText(url.href)).features?.[0] ?? null;
}

/** MapLibre tiles of one feature of a WMS layer drawn as a `color` outline (GeoServer's FEATUREID and SLD_BODY). */
export function outlineSource({ endpoint }, name, featureId, color, point) {
	const stroke = `<Stroke><CssParameter name="stroke">${color}</CssParameter><CssParameter name="stroke-width">${point ? 3 : 4}</CssParameter></Stroke>`;
	// A line style draws nothing for points, so they get a ring (a point style would mark the middle of lines and areas).
	const symbolizer = point
		? `<PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName><Fill><CssParameter name="fill-opacity">0</CssParameter></Fill>${stroke}</Mark><Size>18</Size></Graphic></PointSymbolizer>`
		: `<LineSymbolizer>${stroke}</LineSymbolizer>`;
	const sld = `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld"><NamedLayer><Name>${escapeHtml(name)}</Name>` +
		`<UserStyle><FeatureTypeStyle><Rule>${symbolizer}</Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
	const filter = `&FEATUREID=${encodeURIComponent(featureId)}&SLD_BODY=${encodeURIComponent(sld)}`;
	return { type: 'raster', tileSize: WMS_TILE, tiles: [wmsTiles(endpoint, name, WMS_TILE) + filter] };
}

/** MapLibre tile source of a WMS or WMTS layer: WMS tiles of `tileSize` px, PNG unless `format` says otherwise. */
export const rasterSource = (service, name, tileSize = WMS_TILE, format) => ({
	type: 'raster',
	attribution: attribution(service),
	...(service.type === 'WMS'
		? { tileSize, tiles: [wmsTiles(service.endpoint, name, tileSize, format)], ...wmsZooms(service.endpoint, name, tileSize), ...wmsBounds(service.endpoint, name) }
		: { tileSize: 256, tiles: [wmtsTiles(service.endpoint, name)] })
});

export const legendUrl = ({ type, endpoint }, name) =>
	type === 'WMS' ? endpoint.getLayerByName(name)?.styles[0]?.legendUrl : undefined;
