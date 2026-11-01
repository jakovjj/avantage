const map = L.map("map").setView([44.5, 16.4], 7);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Popup s svim atributima objekta.
function popupFor(feature) {
  const props = feature.properties || {};
  const rows = Object.entries(props)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join("");
  return rows ? `<table class="props">${rows}</table>` : null;
}

function geojsonLayer(url) {
  const layer = L.geoJSON(null, {
    onEachFeature: (feature, l) => {
      const html = popupFor(feature);
      if (html) l.bindPopup(html, { maxWidth: 350 });
    },
  });
  fetch(url)
    .then((r) => r.json())
    .then((data) => layer.addData(data))
    .catch((err) => console.error(`Sloj ${url} se nije učitao:`, err));
  return layer;
}

// WFS: tražimo GeoJSON u WGS84, pa ga crtamo kao običan GeoJSON sloj.
function wfsUrl(def) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: def.layer,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  return `${def.url}?${params}`;
}

// WMS: server sam crta sliku, mi je samo stavimo preko karte.
function wmsLayer(def) {
  return L.tileLayer.wms(def.url, {
    layers: def.layer,
    format: "image/png",
    transparent: true,
    opacity: def.opacity ?? 0.7,
  });
}

function createLayer(def) {
  switch (def.type) {
    case "wms": return wmsLayer(def);
    case "wfs": return geojsonLayer(wfsUrl(def));
    default: return geojsonLayer(def.url);
  }
}

const list = document.getElementById("layer-list");

for (const def of LAYERS) {
  // Sloj se stvara (i podaci dohvaćaju) tek kad ga prvi put uključiš.
  let layer = null;
  const show = () => (layer ??= createLayer(def)).addTo(map);
  const hide = () => layer && map.removeLayer(layer);

  if (def.visible) show();

  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = !!def.visible;
  box.addEventListener("change", () => (box.checked ? show() : hide()));
  label.append(box, def.name);
  list.append(label);
}
