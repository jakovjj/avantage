// Built-in OGC services. `type` skips auto-detection; layers come from GetCapabilities.
// `layers` holds optional per-layer tweaks, keyed by layer name:
//   id(feature)  stable feature key, for servers whose feature ids change between requests
//   paint        MapLibre paint overrides per kind: { fill, line, circle }
//   group        optional group title to group layers in the sidebar
//   minZoom      minimum map zoom for displaying the layer and requesting its WFS features
//   wms          WFS: WMS URL; draw the layer as that server's rendered image (for layers far too big as vectors)
//   heatmap      true: the sidebar shows such a layer with the heatmap icon
//   featureInfo  with `wms`: a click on the map asks the WMS (GetFeatureInfo) for the feature there//   hide         leave the layer out of the sidebar (e.g. when the same data is shown from another service)
//   panel        Svelte component for the details panel, given the clicked feature's `properties`
//   loadAll      WFS: download the whole layer once whatever its size (measured, e.g. 1.35 MB gzipped), never per view
//   images       { name: SVG markup } icons for `symbol` (drawn at half the SVG's size, for sharp edges)
//   symbol       { layout, paint } of an extra MapLibre symbol layer on top: icons, labels
//   snapshot     WFS: URL of a saved GetFeature response (src/lib/snapshots/) used instead of the server; see AGENTS.md
//   tileSize     WMS tile size in px (default 512)
//   exclusive    key shared by layers of which only one may be on (turning one on turns the others off)
//   overview     WMS: { url, bounds: [w, s, e, n], maxZoom } a saved image of the whole layer shown until maxZoom + 0.5
//                instead of the server's tiles (src/lib/snapshots/); see AGENTS.md
import OdbaceniOtpad, { STATUS_COLORS } from './panels/OdbaceniOtpad.svelte';
import Odlagaliste, { MARKERS as LANDFILL_MARKERS } from './panels/Odlagaliste.svelte';
import Staniste2016 from './panels/Staniste2016.svelte';
import odlagalistaSnapshot from './snapshots/v_odlagalista_geom.json?url';
import natureSolar from './snapshots/ocjena_priroda_solar.png?url';
import natureWind from './snapshots/ocjena_priroda_vjetar.png?url';
import habitats from './snapshots/osjetljivost_stanista.png?url';
import batsSolar from './snapshots/ascii_osjetljivost_sismisi_solar_import.png?url';
import batsWind from './snapshots/ascii_osjetljivost_sismisi_vjetar.png?url';
import groupSolar from './snapshots/ascii_osjetljivost_vrsta_solar.png?url';
import groupWind from './snapshots/ascii_osjetljivost_vrsta_vjetar.png?url';
import habitats2016 from './snapshots/kopnena_stanista_2016.png?url';

// Ready layers: designed by hand, one by one (own colours and details panel), and listed in AGENTS.md.
// Lokacije odbačenog otpada (AZO): WFS only, dots coloured like the AZO WMS style.
// Kilograms from "15000.00 kg, 10.00 m3" (null or zero for ~90% of the records).
const AMOUNT = ['coalesce', ['get', 'ukupna_kolicina_otpada'], ''];
const KG = ['to-number', ['slice', AMOUNT, 0, ['max', 0, ['index-of', ' kg', AMOUNT]]], 0];
const ODBACENI_OTPAD = {
	panel: OdbaceniOtpad,
	loadAll: true, // 14,195 points: 10 MB of JSON, 1.35 MB downloaded (gzip), ~1.5 s; then never refetched
	paint: {
		circle: {
			'circle-color': ['match', ['get', 'status_lokacije_otpada'], ...Object.entries(STATUS_COLORS).flat(), '#999'],
			// Amounts span 0.5 kg … 19,000 t (median 1 t), so size follows the order of magnitude: ≤10 kg, 1 t, ≥100 t.
			// Dots without an amount keep the plain size.
			'circle-radius': ['case', ['>', KG, 0], ['interpolate', ['linear'], ['log10', KG], 1, 3, 3, 6, 5, 11], 5],
			'circle-stroke-color': '#000',
			'circle-stroke-width': 1
		}
	}
};

// Odlagališta otpada (AZO): WFS only, markers and names like the AZO WMS style (a triangle for active landfills,
// so the markers are icons rather than circles), sized by the deposited amount.
// Tonnes span 200 … 9.7 million (median 16,000), so size follows the order of magnitude: ≤100 t, 10,000 t, ≥10 Mt.
// The 16 landfills without an amount keep the WMS size.
const TONNES = ['to-number', ['get', 'kolicina_odlozenog_otpada'], 0];
const LANDFILL_SIZE = ['case', ['>', TONNES, 0], ['interpolate', ['linear'], ['log10', TONNES], 2, 0.7, 4, 1, 7, 2.2], 1];
const ODLAGALISTA = {
	panel: Odlagaliste,
	// 317 points, 292 KB of JSON (28 KB gzipped), but the server takes ~11 s to start answering.
	snapshot: odlagalistaSnapshot,
	images: Object.fromEntries(Object.entries(LANDFILL_MARKERS).map(([status, svg]) => [`odlagaliste-${status}`, svg])),
	paint: { circle: { 'circle-radius': 0, 'circle-stroke-width': 0 } }, // the icons replace the default dots
	symbol: {
		layout: {
			'icon-image': ['concat', 'odlagaliste-', ['get', 'status_operativnosti']],
			'icon-size': LANDFILL_SIZE,
			'icon-allow-overlap': true,
			'symbol-sort-key': ['-', TONNES], // big landfills first: drawn under the small ones, named first
			'text-field': ['get', 'naziv_odlagalista'],
			'text-font': ['Noto Sans Bold'],
			'text-size': 11,
			'text-variable-anchor': ['left'],
			'text-radial-offset': ['+', 0.4, ['*', 0.65, LANDFILL_SIZE]], // clear of the marker at any size (in ems)
			'text-max-width': 10,
			'text-optional': true // a name that collides is dropped, its marker stays
		},
		paint: { 'text-color': 'rgba(0, 0, 0, 0.8)', 'text-halo-color': 'rgba(255, 255, 255, 0.7)', 'text-halo-width': 1.5 }
	}
};

const BIOPORTAL_WMS = 'https://services.bioportal.hr/wms';

// Sensitivity grids come as a few huge dissolved polygons (one is ~6 MB), so WFS can't show them at any zoom.
// Bioportal renders them slowly when zoomed out (a 512 px tile of Croatia takes ~7 s, a 256 px one ~1.2 s;
// all of Croatia 6.8 s vs 4.4 s), so they use 256 px tiles.
// They cover all of Croatia, so they share one sidebar section and only one is shown at a time.
const HEATMAP = { wms: BIOPORTAL_WMS, heatmap: true, tileSize: 256, group: 'Osjetljivost', exclusive: 'osjetljivost' };
// The slow ones (all of Croatia at zoom 7 in 256 px tiles: prirode 4.5 s, staništa 3.6 s, šišmiši 2.5 s, skupno
// 1.9–2.5 s; ptice 1.6 s and velike zvijeri 0.5 s stay live) show a saved image of all of Croatia until zoom 8.5 (zoom 8
// sharpness, 8–25 s for the server to render) instead of the tiles. See Snapshots in AGENTS.md.
const OVERVIEW_BOUNDS = [13.4, 42.3, 19.55, 46.6];
const WITH_OVERVIEW = (url) => ({ ...HEATMAP, overview: { url, bounds: OVERVIEW_BOUNDS, maxZoom: 8 } });

const PERISKE_DETAILS = {
	fields: [
		{ keys: ['dat_opaza', 'dat_op'], label: 'Datum opažanja' },
		{ keys: ['god_op'], label: 'Godina opažanja' },
		{ keys: ['opazac', 'promat', 'prom'], label: 'Opažač' },
		{ keys: ['lokalitet', 'lokal', 'lok', 'naziv_lok'], label: 'Lokalitet' },
		{ keys: ['dubina_m', 'dubina'], label: 'Dubina (m)' },
		{ keys: ['br_jedinki', 'br_jedi', 'br_jed'], label: 'Broj jedinki' },
		{ keys: ['br_uginul', 'br_ugin', 'br_ugi'], label: 'Broj uginulih' },
		{ keys: ['dojav_stan', 'stanje'], label: 'Stanje' },
		{ keys: ['prov_stanj', 'provjera', 'provjer'], label: 'Provjera stanja' },
		{ keys: ['nesig_koor', 'nesigurno', 'nesigu', 'nes'], label: 'Nesigurno' },
		{ keys: ['napomena'], label: 'Napomena' },
		{ keys: ['referenca'], label: 'Izvor' }
	]
};

const BEETLE_DETAILS = {
	fields: [
		{ keys: ['validno_im', 'val_im', 'val_ime'], label: 'Vrsta' },
		{ keys: ['ime_op', 'im_op'], label: 'Ime' },
		{ keys: ['prez_op'], label: 'Prezime' },
		{ keys: ['im_pre_op'], label: 'Ime i prezime' },
		{ keys: ['dat_doj', 'dat_obj'], label: 'Datum dojave' },
		{ keys: ['god_doj'], label: 'Godina dojave' },
		{ keys: ['dat_op'], label: 'Datum opažanja' },
		{ keys: ['dat_nal'], label: 'Datum nalaza' },
		{ keys: ['vrije_pron', 'vrij_pr', 'vri_pro', 'vri_pron'], label: 'Vrijeme nalaza' },
		{ keys: ['lok', 'lokal'], label: 'Lokalitet' },
		{ keys: ['opis_lok'], label: 'Opis lokacije' },
		{ keys: ['spol'], label: 'Spol' },
		{ keys: ['br_jed', 'br_jedi'], label: 'Broj jedinki' },
		{ keys: ['nesig', 'nesigur', 'nesigurnos', 'nesigu'], label: 'Nesigurno' },
		{ keys: ['foto'], label: 'Fotografija' }
	]
};

const PROTECTED_AREA_DETAILS = {
	fields: [
		{ keys: ['naziv_akt', 'naziv'], label: 'Naziv' },
		{ keys: ['kategorija_zastite'], label: 'Kategorija zaštite' },
		{ keys: ['podkategorija_zastite'], label: 'Podkategorija zaštite' },
		{ keys: ['medjunarodni_status'], label: 'Međunarodni status' },
		{ keys: ['datum_proglasenja'], label: 'Datum proglašenja' },
		{ keys: ['povrsina'], label: 'Površina' }
	]
};

const HABITAT_2004_DETAILS = {
	fields: [
		{ keys: ['nks_ime'], label: 'Stanišni tip' },
		{ keys: ['nks_kod'], label: 'NKS šifra' }
	]
};

export default [
	{
		title: 'Otpad (AZO)',
		type: 'WMS',
		url: 'https://servisi.azo.hr/otpad/wms?request=GetCapabilities',
		layers: { odbaceni_otpad: { hide: true }, v_odlagalista_geom: { hide: true } }
	},
	{
		title: 'Otpad – objekti (AZO)',
		type: 'WFS',
		url: 'https://servisi.azo.hr/otpad/wfs',
		layers: { 'otpad:odbaceni_otpad': ODBACENI_OTPAD, 'otpad:v_odlagalista_geom': ODLAGALISTA }
	},
	{
		title: 'Bioportal',
		type: 'WFS',
		url: 'https://services.bioportal.hr/wfs',
		layers: {
			'dzzpnpis:periska_dojave_gradana_2019': { details: PERISKE_DETAILS },
			'dzzpnpis:periska_dojave_gradana_2020': { details: PERISKE_DETAILS },
			'dzzpnpis:periske_dojave_gradana_2021': { details: PERISKE_DETAILS },
			'dzzpnpis:periske_dojave_gradana_2022': { details: PERISKE_DETAILS },
			'dzzpnpis:periske_dojave_gradana_2023': { details: PERISKE_DETAILS },
			'dzzpnpis:periske_dojave_gradana_2024': { details: PERISKE_DETAILS },
			'dzzpnpis:periske_dojave_strucnjaka': { details: PERISKE_DETAILS },
			'dzzpnpis:periska_arhivski_podaci': { details: PERISKE_DETAILS },
			'dzzpnpis:saproksilni_kornjasi_dojave_2015': { details: BEETLE_DETAILS },
			'dzzpnpis:saproksilni_kornjasi_dojave_2016': { details: BEETLE_DETAILS },
			'dzzpnpis:saproksilni_kornjasi_dojave_2017': { details: BEETLE_DETAILS },
			'dzzpnpis:saproksilni_kornjasi_dojave_2018': { details: BEETLE_DETAILS },
			'dzzpnpis:saproksilni_kornjasi_dojave_2019': { details: BEETLE_DETAILS },
			'dzzpnpis:zasticeno_podrucje_poligoni': { details: PROTECTED_AREA_DETAILS },
			'dzzpnpis:zasticeno_podrucje_tocke': { details: PROTECTED_AREA_DETAILS },
			'dzzpnpis:kopnena_stanista': { details: HABITAT_2004_DETAILS },
			// 322,906 polygons (one city view ~8 MB as WFS): drawn by the WMS in its own colours, and a click asks the
			// WMS for the polygon there (~0.3 s). 512 px tiles per view: 4.3 s for Croatia, 2.4 s at zoom 8.5, 1.1 s at 9.5,
			// ~0.6 s from 10 (256 px is slower from zoom 9), so a saved image until zoom 8.5.
			'dzzpnpis:kopnena_stanista_2016': {
				panel: Staniste2016, wms: BIOPORTAL_WMS, featureInfo: true,
				overview: { url: habitats2016, bounds: OVERVIEW_BOUNDS, maxZoom: 8 }
			},
			'dzzpnpis:ascii_osjetljivost_ptice_solar': HEATMAP,
			'dzzpnpis:ascii_osjetljivost_ptice_vjetar': HEATMAP,
			'dzzpnpis:ascii_osjetljivost_vrsta_solar': WITH_OVERVIEW(groupSolar),
			'dzzpnpis:ascii_osjetljivost_vrsta_vjetar': WITH_OVERVIEW(groupWind),
			'dzzpnpis:ascii_osjetljivost_velike_zvijeri_solar': HEATMAP,
			'dzzpnpis:ascii_osjetljivost_velike_zvijeri_vjetar': HEATMAP,
			'dzzpnpis:ascii_osjetljivost_sismisi_solar_import': WITH_OVERVIEW(batsSolar),
			'dzzpnpis:ascii_osjetljivost_sismisi_vjetar': WITH_OVERVIEW(batsWind),
			'dzzpnpis:osjetljivost_stanista': WITH_OVERVIEW(habitats),
			'dzzpnpis:ocjena_priroda_solar': WITH_OVERVIEW(natureSolar),
			'dzzpnpis:ocjena_priroda_vjetar': WITH_OVERVIEW(natureWind),
			'dzzpnpis:poucna_info_ploca': { id: (f) => f.properties.poucna_info_ploca_id },
			'dzzpnpis:poucna_staza': { id: (f) => f.properties.poucna_staza_id },
			'dzzpnpis:prijedlog_podrucja_obnove_grupa_1': { group: 'Loše stanje stanišnih tipova' },
			// These full WFS polygons exceed the view budget at the Croatia-wide extent.
			'dzzpnpis:prijedlog_podrucja_obnove_grupa_2': { group: 'Loše stanje stanišnih tipova', minZoom: 12 },
			'dzzpnpis:prijedlog_podrucja_obnove_grupa_3': { group: 'Loše stanje stanišnih tipova', minZoom: 12 },
			'dzzpnpis:prijedlog_podrucja_obnove_grupa_4': { group: 'Loše stanje stanišnih tipova' },
			'dzzpnpis:prijedlog_podrucja_obnove_grupa_6': { group: 'Loše stanje stanišnih tipova' }
		}
	},
	{ title: 'Opasnost od poplava (Hrvatske vode)', type: 'WMS', url: 'https://servisi.voda.hr/poplave_opasnosti/wms' }
];
