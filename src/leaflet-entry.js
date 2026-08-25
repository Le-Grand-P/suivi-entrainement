// Point d'entrée pour bundler Leaflet en un seul fichier autonome
// (js/leaflet.bundle.js), sans dépendance à un CDN.
// Rebuild : npx esbuild src/leaflet-entry.js --bundle --format=iife
//           --platform=browser --outfile=js/leaflet.bundle.js --minify
import * as L from "leaflet";
window.L = L;
