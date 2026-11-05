# Avantage

Karta Hrvatske za istraživanje otvorenih prostornih podataka (WMS / WFS / WMTS). SvelteKit SPA, sve radi u pregledniku.

```bash
npm i
npm run dev     # http://localhost:5173
npm run build   # statična stranica u build/
```

Potreban je Node 22.17+.

## Struktura

- `src/lib/sources.js` – ugrađeni servisi (dodaj novi unos s `url`, `title` i po želji `type`) i prilagodbe pojedinih slojeva (`id`, `paint`)
- `src/lib/ogc.js` – GetCapabilities i izvori za kartu ([ogc-client](https://github.com/camptocamp/ogc-client))
- `src/lib/wfs.js` – WFS slojevi: mali (do 100 KB) se učitaju cijeli, veliki se dohvaćaju za vidljivo područje
- `src/lib/map.js` – MapLibre karta (podloga [OpenFreeMap](https://openfreemap.org)), slojevi i popupi
- `src/lib/Source.svelte` – jedan servis u bočnoj traci s popisom slojeva

Servis mora slati CORS zaglavlja (`Access-Control-Allow-Origin`), a WMS/WMTS mora podržavati EPSG:3857.
