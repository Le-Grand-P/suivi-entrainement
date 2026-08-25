// Distance haversine entre deux points GPS (mètres). Utilisé pour la
// reconstruction de distance en l'absence de champ "distance" natif
// (fitParser.js) et pour reconnaître qu'une montée sur une nouvelle sortie
// est géographiquement "la même" qu'une montée déjà vue (climbSegments.js).

const EARTH_RADIUS_M = 6371000.0;

export function haversineDistanceM(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = phi2 - phi1;
  const dlam = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}
