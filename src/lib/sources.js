// Built-in OGC services. `type` skips auto-detection; layers come from GetCapabilities.
export default [
	{ title: 'Otpad (AZO)', type: 'WMS', url: 'https://servisi.azo.hr/otpad/wms?request=GetCapabilities' },
	{ title: 'Otpad – objekti (AZO)', type: 'WFS', url: 'https://servisi.azo.hr/otpad/wfs' },
	{ title: 'Bioportal', type: 'WFS', url: 'https://services.bioportal.hr/wfs' },
	{ title: 'Opasnost od poplava (Hrvatske vode)', type: 'WMS', url: 'https://servisi.voda.hr/poplave_opasnosti/wms' }
];
