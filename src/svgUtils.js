// Utilitaires SVG partagés entre profile.js (profil altimétrique interactif)
// et charts.js (mini-graphiques de progression). Remplace matplotlib côté
// desktop : rendu vectoriel natif du navigateur, net sur tout écran (y
// compris les écrans haute densité des téléphones), aucune image à générer.

export const NS = "http://www.w3.org/2000/svg";

export function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

/** Pas "rond" (1/2/5 × 10^n) pour des graduations lisibles. */
export function niceStep(span, targetTicks) {
  const raw = span / Math.max(1, targetTicks);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return mult * mag;
}

let _uidCounter = 0;
export function nextUid(prefix = "u") {
  return `${prefix}${++_uidCounter}`;
}
