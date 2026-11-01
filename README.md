# Avantage

Interaktivna karta Hrvatske sa slojevima (datathon). Single page app – stranica odmah otvara kartu, nema posebnih URL-ova.

Čisti HTML/CSS/JS + [Leaflet](https://leafletjs.com), bez build koraka.

## Pokretanje lokalno

`fetch` ne radi preko `file://`, pa treba mali server:

```bash
python -m http.server 8000
```

i otvori http://localhost:8000

## Dodavanje sloja

Dodaj unos u `layers.js`. Podržane vrste:

- `geojson` – lokalna datoteka u `data/`
- `wfs` – vektorski podaci s WFS servisa (dohvaća se kao GeoJSON u WGS84)
- `wms` – gotova slika s WMS servisa

Ime sloja nađeš u `GetCapabilities` odgovoru servisa. Novi sloj uvijek isprobaj na karti, jer ne rade sva imena.
