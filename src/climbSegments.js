// Reconnaissance des montées répétées : regroupe les montées de sorties
// différentes qui correspondent géographiquement à "la même" ascension, pour
// en suivre la progression (VAM, dérive cardiaque, puissance) dans le temps.
//
// Algorithme glouton, volontairement simple : chaque montée est comparée aux
// segments déjà formés (point de départ proche + profil distance/dénivelé
// similaire) ; si aucun ne correspond, elle fonde un nouveau segment. Pas de
// dépendance à un service de cartographie — tout se fait localement à partir
// des coordonnées déjà extraites du .fit.
//
// IMPORTANT : la comparaison se fait contre le CENTROÏDE du segment (moyenne
// glissante de toutes les occurrences déjà regroupées), pas contre sa
// première occurrence figée. Avec une ancre figée, un léger écart GPS/mesure
// qui s'accumule sortie après sortie peut rester sous le seuil de tolérance
// entre deux occurrences consécutives, mais dépasser ce même seuil comparé à
// la toute première — la 3e occurrence (et suivantes) échouait alors à
// rejoindre le segment silencieusement (bug réel constaté et corrigé). Le
// centroïde, recalculé à chaque ajout, absorbe cette dérive au lieu de s'y
// figer, tout en restant borné (contrairement à une comparaison uniquement
// contre la dernière occurrence, qui laisserait le segment dériver sans
// limite d'une occurrence à l'autre).
//
// Les segments sont recalculés à CHAQUE appel (rien n'est persisté) : ajouter
// une sortie peut réordonner ou faire apparaître des segments. Le nom
// personnalisé d'une montée (voir applyStoredNames) est donc rattaché à un
// point géographique de référence, jamais à un "id" de segment — cet id
// n'est qu'un index de tableau, instable d'un appel à l'autre.

import { haversineDistanceM } from "./geo.js";

const START_MATCH_RADIUS_M = 300;      // deux montées "démarrent au même endroit" si <300m d'écart
const DISTANCE_TOLERANCE = 0.30;       // ±30% de longueur tolérée
const ELEVATION_TOLERANCE = 0.35;      // ±35% de dénivelé toléré (plus permissif : le bruit
                                        // d'hystérésis pèse proportionnellement plus sur les
                                        // montées courtes)

/**
 * @param {Array} climbs - résultat de db.allClimbsWithRideDate() (climbs
 *   enrichis de ride_date/ride_id/ride_filename), doivent contenir
 *   start_lat/start_lon (absent sur les montées détectées avant l'ajout de
 *   ce champ — celles-ci sont exclues du regroupement, comptées à part).
 * @returns {{segments: Array, skippedNoGps: number}}
 */
export function buildClimbSegments(climbs) {
  const withGps = climbs.filter((c) => Number.isFinite(c.start_lat) && Number.isFinite(c.start_lon));
  const skippedNoGps = climbs.length - withGps.length;

  const sorted = [...withGps].sort((a, b) => (a.ride_date || "").localeCompare(b.ride_date || ""));
  const segments = [];

  for (const climb of sorted) {
    const match = segments.find((seg) => isSameClimb(seg.centroid, climb));
    if (match) {
      match.occurrences.push(climb);
      match.centroid = computeCentroidPoint(match.occurrences);
    } else {
      const point = climbToPoint(climb);
      segments.push({ centroid: point, occurrences: [climb] });
    }
  }

  const out = segments
    .filter((seg) => seg.occurrences.length >= 2)  // une montée vue une seule fois n'est pas un "suivi"
    .map((seg, i) => summarizeSegment(seg, i));

  return { segments: out, skippedNoGps };
}

function climbToPoint(c) {
  return { start_lat: c.start_lat, start_lon: c.start_lon, distance_m: c.distance_m, elevation_gain_m: c.elevation_gain_m };
}

/** Moyenne des points de toutes les occurrences déjà regroupées dans le segment. */
function computeCentroidPoint(occurrences) {
  return {
    start_lat: mean(occurrences.map((c) => c.start_lat)),
    start_lon: mean(occurrences.map((c) => c.start_lon)),
    distance_m: mean(occurrences.map((c) => c.distance_m)),
    elevation_gain_m: mean(occurrences.map((c) => c.elevation_gain_m)),
  };
}

/**
 * Point de comparaison générique : {start_lat, start_lon, distance_m,
 * elevation_gain_m}. Utilisée à la fois pour regrouper les montées entre
 * elles ET pour retrouver un nom personnalisé sauvegardé (db.js -> climb_names).
 */
export function isSameClimb(a, b) {
  const startDist = haversineDistanceM(a.start_lat, a.start_lon, b.start_lat, b.start_lon);
  if (startDist > START_MATCH_RADIUS_M) return false;

  const distRatio = ratio(a.distance_m, b.distance_m);
  if (distRatio === null || Math.abs(distRatio - 1) > DISTANCE_TOLERANCE) return false;

  const elevRatio = ratio(a.elevation_gain_m, b.elevation_gain_m);
  if (elevRatio === null || Math.abs(elevRatio - 1) > ELEVATION_TOLERANCE) return false;

  return true;
}

function ratio(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  return b / a;
}

/**
 * Associe à chaque segment un nom personnalisé déjà enregistré, en comparant
 * le point de référence du segment (son centroïde) aux entrées stockées avec
 * la MÊME logique de correspondance que le regroupement des montées. Ajoute
 * `name` (string ou null) et `name_id` (id de l'entrée stockée, pour permettre
 * un renommage ultérieur) à chaque segment.
 */
export function applyStoredNames(segments, storedNames) {
  return segments.map((seg) => {
    const segAnchor = {
      start_lat: seg.anchor_lat, start_lon: seg.anchor_lon,
      distance_m: seg.avg_distance_m, elevation_gain_m: seg.avg_elevation_m,
    };
    const match = storedNames.find((n) => isSameClimb(
      { start_lat: n.anchor_lat, start_lon: n.anchor_lon, distance_m: n.anchor_distance_m, elevation_gain_m: n.anchor_elevation_m },
      segAnchor
    ));
    return { ...seg, name: match ? match.name : null, name_id: match ? match.id : null };
  });
}

function summarizeSegment(seg, index) {
  const occ = [...seg.occurrences].sort((a, b) => (a.ride_date || "").localeCompare(b.ride_date || ""));
  const avgDistanceM = mean(occ.map((c) => c.distance_m));
  const avgGradePct = mean(occ.map((c) => c.avg_grade_pct));
  const avgElevationM = mean(occ.map((c) => c.elevation_gain_m));

  const vams = occ.map((c) => c.vam_mh).filter(Number.isFinite);
  const first = occ[0], last = occ[occ.length - 1];
  const vamTrend = (Number.isFinite(first.vam_mh) && Number.isFinite(last.vam_mh) && occ.length >= 2)
    ? round1(((last.vam_mh - first.vam_mh) / first.vam_mh) * 100)
    : null;

  return {
    id: index,
    label: `${round1(avgDistanceM / 1000)} km à ${round1(avgGradePct)} %`,
    n_occurrences: occ.length,
    avg_distance_m: Math.round(avgDistanceM),
    avg_elevation_m: Math.round(avgElevationM),
    avg_grade_pct: round1(avgGradePct),
    best_vam_mh: vams.length ? Math.round(Math.max(...vams)) : null,
    vam_trend_pct: vamTrend,
    first_date: first.ride_date,
    last_date: last.ride_date,
    // Point de référence du segment (centroïde de toutes les occurrences,
    // pas seulement la première) : sert à retrouver/enregistrer un nom
    // personnalisé, et reste stable même si de nouvelles occurrences
    // s'ajoutent plus tard.
    anchor_lat: seg.centroid.start_lat,
    anchor_lon: seg.centroid.start_lon,
    occurrences: occ.map((c) => ({
      ride_id: c.ride_id,
      ride_date: c.ride_date,
      ride_filename: c.ride_filename,
      distance_m: c.distance_m,
      elevation_gain_m: c.elevation_gain_m,
      avg_grade_pct: c.avg_grade_pct,
      vam_mh: c.vam_mh,
      avg_hr: c.avg_hr,
      hr_drift_bpm: c.hr_drift_bpm,
      est_power_w: c.est_power_w,
      duration_s: c.duration_s,
      // Indices bruts dans le parse de LEUR sortie respective (pas
      // comparables entre occurrences) : utilisés uniquement pour retrouver
      // le tracé GPS précis de cette occurrence via get_climb_path().
      start_idx: c.start_idx,
      end_idx: c.end_idx,
    })),
  };
}

function mean(arr) {
  const valid = arr.filter(Number.isFinite);
  if (!valid.length) return NaN;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function round1(v) {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}
