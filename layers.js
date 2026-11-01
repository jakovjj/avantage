// Popis slojeva na karti. Tri vrste:
//   geojson – lokalna datoteka iz data/   { url }
//   wfs     – vektorski podaci s WFS servisa   { url, layer }
//   wms     – gotova slika s WMS servisa   { url, layer, opacity? }
// Imena slojeva (layer) piše u GetCapabilities odgovoru servisa.
// Pazi: ne rade sva imena iz GetCapabilitiesa, pa novi sloj uvijek isprobaj na karti.
const LAYERS = [
  {
    id: "gradovi",
    name: "Veći gradovi (primjer)",
    type: "geojson",
    url: "data/gradovi.geojson",
    visible: true,
  },
  {
    id: "reciklazna-dvorista",
    name: "Reciklažna dvorišta 2015 (AZO)",
    type: "wfs",
    url: "https://servisi.azo.hr/otpad/wfs",
    layer: "otpad:reciklazna_dvorista_2015",
  },
  {
    id: "divlji-deponiji",
    name: "Divlji deponiji u podzemlju 2021 (Bioportal)",
    type: "wfs",
    url: "https://services.bioportal.hr/wfs",
    layer: "dzzpnpis:divlji_deponiji_2021",
  },
  {
    id: "poplave",
    name: "Opasnost od poplava, srednja vjerojatnost (Hrvatske vode)",
    type: "wms",
    url: "https://servisi.voda.hr/poplave_opasnosti/wms",
    layer: "hr.fd.opasnost-od-poplave-srednja-vjerojatnost",
  },
];
