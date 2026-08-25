// Point d'entrée pour bundler fit-file-parser en un fichier autonome
// (js/fit-file-parser.bundle.js), utilisable offline sans CDN.
// Rebuild : npx esbuild src/fit-entry.js --bundle --format=iife
//           --platform=browser --outfile=js/fit-file-parser.bundle.js --minify
import FitParser from "fit-file-parser";
window.FitParser = FitParser;
