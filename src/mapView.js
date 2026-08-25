// Carte du tracé GPS. Contrairement au reste de l'appli, cette fonctionnalité
// a besoin d'une connexion Internet : les tuiles cartographiques (fond de
// carte OpenStreetMap) sont chargées à la demande, pas mises en cache pour un
// usage hors ligne. Le code de la carte lui-même (bibliothèque Leaflet) est
// bundlé localement — seules les images de tuiles nécessitent le réseau.

let _leafletCssInjected = false;

function ensureLeafletCss() {
  if (_leafletCssInjected) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/leaflet.css";
  document.head.appendChild(link);
  _leafletCssInjected = true;
}

/**
 * @param {HTMLElement} container
 * @param {{lat: number[], lon: number[]}} series - coordonnées le long du
 *   tracé, dans l'ordre (mêmes indices que les autres séries de
 *   get_ride_series : dist_km, alt, hr...).
 * @param {Array<{start_idx:number, end_idx:number}>} climbs - segments à
 *   surligner en rouge (bornes en indices d'AFFICHAGE, alignées sur `series`).
 * @returns {L.Map|null} l'instance Leaflet (à détruire via .remove() quand la
 *   carte n'est plus affichée), ou null si aucune coordonnée exploitable.
 */
export function renderRouteMap(container, series, climbs = []) {
  ensureLeafletCss();

  const pts = [];
  for (let i = 0; i < series.lat.length; i++) {
    if (Number.isFinite(series.lat[i]) && Number.isFinite(series.lon[i])) {
      pts.push([series.lat[i], series.lon[i], i]);
    }
  }
  if (pts.length < 2) {
    container.innerHTML = `<p class="muted">Pas de coordonnées GPS exploitables pour cette sortie.</p>`;
    return null;
  }

  container.innerHTML = "";
  const mapDiv = document.createElement("div");
  mapDiv.className = "route-map";
  container.appendChild(mapDiv);

  const map = window.L.map(mapDiv, { scrollWheelZoom: false });

  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);

  const latLngs = pts.map(([lat, lon]) => [lat, lon]);
  const route = window.L.polyline(latLngs, {
    color: "#3a5a46", weight: 3.5, opacity: 0.9, lineJoin: "round",
  }).addTo(map);

  // Segments de montée surlignés en rouge, par-dessus le tracé de base.
  for (const c of climbs) {
    const segPts = pts.filter(([, , i]) => i >= c.start_idx && i <= c.end_idx)
      .map(([lat, lon]) => [lat, lon]);
    if (segPts.length >= 2) {
      window.L.polyline(segPts, { color: "#c2452d", weight: 4.5, opacity: 0.85 }).addTo(map);
    }
  }

  addMarker(map, latLngs[0], "A", "#3a5a46");
  addMarker(map, latLngs[latLngs.length - 1], "B", "#24231f");

  map.fitBounds(route.getBounds(), { padding: [24, 24] });

  // Le conteneur peut être caché (onglet non actif) au moment du premier
  // rendu : Leaflet calcule alors une taille nulle. On recalcule une fois
  // visible, et aussi au redimensionnement (rotation d'écran).
  const resize = () => map.invalidateSize();
  window.addEventListener("resize", resize);
  map._faResizeHandler = resize; // permet de le retirer proprement dans destroyRouteMap

  return map;
}

export function destroyRouteMap(map) {
  if (!map) return;
  if (map._faResizeHandler) window.removeEventListener("resize", map._faResizeHandler);
  map.remove();
}

function addMarker(map, latLng, label, color) {
  const icon = window.L.divIcon({
    className: "route-marker",
    html: `<span style="background:${color}">${label}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  window.L.marker(latLng, { icon }).addTo(map);
}
