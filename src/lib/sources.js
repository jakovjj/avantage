// Built-in OGC services. `type` skips auto-detection; layers come from GetCapabilities.
// `layers` holds optional per-layer tweaks, keyed by layer name:
//   id(feature)  stable feature key, for servers whose feature ids change between requests
//   paint        MapLibre paint overrides per kind: { fill, line, circle }

// Habitat class colours by NKS top level (A–K), from the `nks1_style` property.
const NKS_COLOR = ['match', ['get', 'nks1_style'],
	'A', '#4a90d9', // površinske kopnene vode i močvarna staništa
	'B', '#bdb39a', // neobrasle i slabo obrasle kopnene površine
	'C', '#a6d96a', // travnjaci, cretovi i visoke zeleni
	'D', '#7a9a3a', // šikare
	'E', '#2e7d32', // šume
	'F', '#e8cf7a', // morska obala
	'G', '#1f4e8c', // more
	'H', '#7b5a3c', // podzemlje
	'I', '#f2d43d', // kultivirane nešumske površine
	'J', '#d9534f', // izgrađena i industrijska staništa
	'K', '#9c6ade', // kompleksi staništa
	'#999'
];

export default [
	{ title: 'Otpad (AZO)', type: 'WMS', url: 'https://servisi.azo.hr/otpad/wms?request=GetCapabilities' },
	{ title: 'Otpad – objekti (AZO)', type: 'WFS', url: 'https://servisi.azo.hr/otpad/wfs' },
	{
		title: 'Bioportal',
		type: 'WFS',
		url: 'https://services.bioportal.hr/wfs',
		layers: {
			'dzzpnpis:kopnena_stanista_2016': {
				paint: { fill: { 'fill-color': NKS_COLOR, 'fill-opacity': 0.5 }, line: { 'line-color': NKS_COLOR, 'line-width': 0.5 } }
			},
			'dzzpnpis:poucna_info_ploca': { id: (f) => f.properties.poucna_info_ploca_id },
			'dzzpnpis:poucna_staza': { id: (f) => f.properties.poucna_staza_id }
		}
	},
	{ title: 'Opasnost od poplava (Hrvatske vode)', type: 'WMS', url: 'https://servisi.voda.hr/poplave_opasnosti/wms' }
];
