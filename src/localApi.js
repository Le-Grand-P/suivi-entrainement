// API locale : reproduit les mêmes signatures que le pont pywebview de
// l'appli desktop (backend/api.py), mais tout s'exécute dans le navigateur —
// pas de serveur, pas de backend Python. C'est ce qui permet de réutiliser
// la logique d'interface (app.js) avec un minimum de changements.

import * as db from "./db.js";
import { parseFitFile, ParseError } from "./fitParser.js";
import { analyzeRide, computeClimbMetrics } from "./analysis.js";
import { DEFAULT_CONFIG } from "./config.js";
import { computeRideTSS, computePMC } from "./trainingLoad.js";
import { aggregateByPeriod } from "./aggregate.js";
import { buildClimbSegments, applyStoredNames } from "./climbSegments.js";

const PROGRESSION_METRICS = {
  avg_power_est_w: "Puissance estimée moyenne (W)",
  norm_power_est_w: "Puissance normalisée estimée (W)",
  avg_hr: "FC moyenne (bpm)",
  avg_speed_kmh: "Vitesse moyenne (km/h)",
  distance_km: "Distance (km)",
  elevation_gain_m: "Dénivelé positif (m)",
  aerobic_decoupling_pct: "Découplage aérobie (%)",
};

const COMPARE_METRICS = {
  heart_rate: "FC (bpm)",
  speed_kmh: "Vitesse (km/h)",
  alt_smooth: "Altitude (m)",
  grade_pct: "Pente (%)",
};

// Cache mémoire des sorties analysées : sans lui, chaque clic sur une montée
// re-parserait le .fit complet depuis le Blob stocké (coûteux sur mobile).
// Même principe que backend/cache.py côté desktop.
const _analysisCache = new Map();
const MAX_CACHE_ENTRIES = 3;

async function getAnalysis(rideId) {
  if (_analysisCache.has(rideId)) return _analysisCache.get(rideId);

  const blob = await db.getRideFitBlob(rideId);
  if (!blob) throw new Error("Fichier .fit introuvable pour cette sortie.");
  const cfg = await getCfg();
  const dfRaw = await parseFitFile(blob, "sortie.fit");
  const result = analyzeRide(dfRaw, cfg);

  _analysisCache.set(rideId, result);
  if (_analysisCache.size > MAX_CACHE_ENTRIES) {
    const oldest = _analysisCache.keys().next().value;
    _analysisCache.delete(oldest);
  }
  return result;
}

function invalidateCache(rideId) {
  _analysisCache.delete(rideId);
}

let _cfgCache = null;
async function getCfg() {
  if (!_cfgCache) _cfgCache = await db.getConfig(DEFAULT_CONFIG);
  return _cfgCache;
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export async function import_files(fileList) {
  const cfg = await getCfg();
  const results = [];

  for (const file of fileList) {
    const filename = file.name;
    try {
      const dfRaw = await parseFitFile(file, filename);
      const { globalStats, climbs } = analyzeRide(dfRaw, cfg);

      const rideDate = new Date(dfRaw.timestamp[0]).toISOString().slice(0, 10);

      const dup = await db.rideExists(filename, rideDate, globalStats.distance_km);
      if (dup) {
        results.push({ filename, status: "skipped", reason: "déjà importé" });
        continue;
      }

      const id = await db.insertRide({
        filename, rideDate, importedAt: new Date().toISOString(),
        stats: globalStats, climbs, fitBlob: file,
      });
      results.push({ filename, status: "ok", ride_id: id, ride_date: rideDate, n_climbs: climbs.length });
    } catch (e) {
      console.error(e);
      const reason = e instanceof ParseError ? e.message : (e.message || String(e));
      results.push({ filename, status: "error", reason });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Listing / détail                                                    */
/* ------------------------------------------------------------------ */

export async function list_rides() {
  return db.listRides();
}

export async function delete_ride(id) {
  invalidateCache(id);
  await db.deleteRide(id);
  return { status: "ok" };
}

export async function get_ride_detail(id) {
  const ride = await db.getRide(id);
  if (!ride) return null;
  return { ...ride, charts: {} };
}

/* ------------------------------------------------------------------ */
/* Série + éditeur de bornes de montée                                 */
/* ------------------------------------------------------------------ */

export async function get_ride_series(id, maxPoints = 1600) {
  const ride = await db.getRide(id);
  if (!ride) return { error: "Sortie introuvable." };
  if (!ride.hasFitBlob) return { error: "Fichier .fit introuvable pour cette sortie." };

  let analysis;
  try {
    analysis = await getAnalysis(id);
  } catch (e) {
    return { error: e.message };
  }
  const df = analysis.df;
  const n = df.n;
  const step = Math.max(1, Math.ceil(n / Math.max(200, maxPoints)));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);

  const baseDist = df.distance[0];
  const baseT = df.timestamp[0];

  const series = (arr, digits) => idx.map((i) => {
    const v = arr[i];
    return Number.isFinite(v) ? round(v, digits) : null;
  });

  // Repère les montées par horodatage (jamais par index brut stocké) : même
  // garde-fou que côté desktop, indispensable si le moteur d'analyse évolue
  // entre deux sessions.
  const climbsOut = (ride.climbs || []).map((c, i) => {
    let s = indexForTime(df, c.start_time);
    let e = indexForTime(df, c.end_time);
    if (s === null || e === null || e <= s) {
      s = Math.min(Math.max(c.start_idx ?? 0, 0), n - 1);
      e = Math.min(Math.max(c.end_idx ?? s + 1, 0), n - 1);
    }
    return { index: i, start_idx: s, end_idx: e, user_adjusted: !!c.user_adjusted };
  });

  return {
    n_points: n,
    idx,
    dist_km: idx.map((i) => round((df.distance[i] - baseDist) / 1000, 4)),
    alt: series(df.alt_smooth, 1),
    hr: series(df.heart_rate, 0),
    speed: series(df.speed_kmh, 1),
    grade: series(df.grade_pct, 1),
    elapsed_s: idx.map((i) => Math.round((df.timestamp[i] - baseT) / 1000)),
    climbs: climbsOut,
  };
}

function indexForTime(df, isoTime) {
  if (!isoTime) return null;
  const target = new Date(isoTime).getTime();
  if (!Number.isFinite(target)) return null;
  const ts = df.timestamp;
  let lo = 0, hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < target) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(ts[lo - 1] - target) < Math.abs(ts[lo] - target)) lo -= 1;
  return lo;
}

export async function preview_climb(rideId, startIdx, endIdx) {
  const cfg = await getCfg();
  let analysis;
  try {
    analysis = await getAnalysis(rideId);
  } catch (e) {
    return { error: e.message };
  }
  const metrics = computeClimbMetrics(analysis.df, startIdx, endIdx, cfg, false);
  if (!metrics) return { error: "Segment trop court pour être analysé." };
  return { metrics };
}

export async function save_climb_bounds(rideId, climbIndex, startIdx, endIdx) {
  const ride = await db.getRide(rideId);
  if (!ride) return { error: "Sortie introuvable." };
  if (climbIndex < 0 || climbIndex >= (ride.climbs || []).length) {
    return { error: "Montée introuvable." };
  }
  const cfg = await getCfg();
  let analysis;
  try {
    analysis = await getAnalysis(rideId);
  } catch (e) {
    return { error: e.message };
  }
  const metrics = computeClimbMetrics(analysis.df, startIdx, endIdx, cfg, false);
  if (!metrics) return { error: "Segment trop court pour être analysé." };

  metrics.user_adjusted = true;
  const climbs = [...ride.climbs];
  climbs[climbIndex] = metrics;
  await db.updateRideClimbs(rideId, climbs);
  return { metrics };
}

export async function reset_climbs(rideId) {
  const ride = await db.getRide(rideId);
  if (!ride) return { error: "Sortie introuvable." };
  let analysis;
  try {
    analysis = await getAnalysis(rideId);
  } catch (e) {
    return { error: e.message };
  }
  await db.updateRideClimbs(rideId, analysis.climbs);
  return { n_climbs: analysis.climbs.length };
}

/* ------------------------------------------------------------------ */
/* Progression                                                         */
/* ------------------------------------------------------------------ */

export async function get_progression_metrics() {
  return PROGRESSION_METRICS;
}

export async function get_compare_metrics() {
  return COMPARE_METRICS;
}

export async function get_progression(metric) {
  if (!(metric in PROGRESSION_METRICS)) return { error: "Métrique inconnue." };
  const rides = (await db.listRides())
    .filter((r) => r[metric] !== null && r[metric] !== undefined && r.ride_date);
  rides.sort((a, b) => a.ride_date.localeCompare(b.ride_date));
  const table = rides.map((r) => ({ date: r.ride_date, filename: r.filename, value: r[metric] }));
  return { table };
}

export async function get_climb_progression() {
  const climbs = await db.allClimbsWithRideDate();
  return { climbs };
}

/* ------------------------------------------------------------------ */
/* Comparaison de sorties                                              */
/* ------------------------------------------------------------------ */

export async function compare_rides(rideIds, metric = "heart_rate") {
  if (!(metric in COMPARE_METRICS)) return { error: "Métrique inconnue." };
  if (!rideIds || rideIds.length < 2) return { error: "Sélectionne au moins 2 sorties." };

  const seriesList = [];
  const missing = [];
  for (const rid of rideIds.slice(0, 5)) {
    const ride = await db.getRide(rid);
    if (!ride) continue;
    if (!ride.hasFitBlob) { missing.push(ride.filename); continue; }
    let analysis;
    try {
      analysis = await getAnalysis(rid);
    } catch (e) {
      missing.push(ride.filename);
      continue;
    }
    const df = analysis.df;
    const col = metric === "heart_rate" ? df.heart_rate
      : metric === "speed_kmh" ? df.speed_kmh
      : metric === "alt_smooth" ? df.alt_smooth
      : df.grade_pct;
    const x = new Array(df.n), y = new Array(df.n);
    let lastY = NaN;
    for (let i = 0; i < df.n; i++) {
      x[i] = (df.distance[i] - df.distance[0]) / 1000;
      const v = col[i];
      if (Number.isFinite(v)) lastY = v;
      y[i] = lastY;
    }
    seriesList.push({ label: `${ride.ride_date} — ${ride.filename}`, x, y });
  }

  if (seriesList.length < 2) {
    const detail = missing.length ? ` Fichiers manquants : ${missing.join(", ")}.` : "";
    return { error: "Pas assez de sorties exploitables pour comparer." + detail };
  }
  return { seriesList, metricLabel: COMPARE_METRICS[metric], warning: missing.length ? `Fichiers introuvables : ${missing.join(", ")}` : null };
}

/* ------------------------------------------------------------------ */

export async function get_profile() {
  const cfg = await getCfg();
  return {
    weight_kg: cfg.RIDER_WEIGHT_KG,
    system_weight_kg: cfg.SYSTEM_WEIGHT_KG,
    fc_max: cfg.FC_MAX,
    fc_repos: cfg.FC_REPOS,
    lthr: cfg.LTHR_CYCLING,
    current_ftp_w: cfg.CURRENT_FTP_W,
    target_ftp_w: cfg.TARGET_FTP_W,
  };
}

export async function save_profile(partialCfg) {
  const cfg = await getCfg();
  const merged = { ...cfg, ...partialCfg };
  await db.saveConfig(merged);
  _cfgCache = merged;
  _analysisCache.clear(); // les métriques dépendent du profil (poids, FTP...)
  return { status: "ok" };
}

/* ------------------------------------------------------------------ */
/* Charge d'entraînement (CTL/ATL/TSB)                                 */
/* ------------------------------------------------------------------ */

export async function get_training_load() {
  const cfg = await getCfg();
  const rides = await db.listRides();

  const byDate = new Map();
  let nUnreliable = 0;
  for (const ride of rides) {
    if (!ride.ride_date) continue;
    const result = computeRideTSS(ride, cfg);
    if (!result) continue;
    if (!result.reliable) nUnreliable++;
    byDate.set(ride.ride_date, (byDate.get(ride.ride_date) || 0) + result.tss);
  }

  if (!byDate.size) {
    return { pmc: [], nRidesWithTss: 0, nUnreliable: 0 };
  }

  const dailyTss = [...byDate.entries()].map(([date, tss]) => ({ date, tss }));
  const pmc = computePMC(dailyTss, cfg);
  const latest = pmc[pmc.length - 1] || null;

  return { pmc, latest, nRidesWithTss: byDate.size, nUnreliable };
}

/* ------------------------------------------------------------------ */
/* Tableau de bord hebdo/mensuel                                       */
/* ------------------------------------------------------------------ */

export async function get_dashboard(period = "week") {
  if (period !== "week" && period !== "month") return { error: "Période inconnue." };
  const cfg = await getCfg();
  const rides = await db.listRides();
  if (!rides.length) return { buckets: [] };
  const buckets = aggregateByPeriod(rides, period, cfg);
  // Les 12 dernières périodes suffisent pour un tableau de bord lisible ;
  // au-delà l'utilisateur ira voir l'onglet Progression pour l'historique complet.
  return { buckets: buckets.slice(-12) };
}

/* ------------------------------------------------------------------ */
/* Montées répétées suivies dans le temps                              */
/* ------------------------------------------------------------------ */

export async function get_climb_segments() {
  const climbs = await db.allClimbsWithRideDate();
  if (!climbs.length) return { segments: [], skippedNoGps: 0 };
  const result = buildClimbSegments(climbs);

  const storedNames = await db.listClimbNames();
  result.segments = applyStoredNames(result.segments, storedNames);

  // Les segments les plus fréquemment gravis en premier — ce sont ceux qui
  // ont le plus de valeur pour suivre une progression.
  result.segments.sort((a, b) => b.n_occurrences - a.n_occurrences);
  return result;
}

/**
 * Renomme (ou efface le nom de) une montée répétée. `anchor` doit contenir
 * les champs anchor_lat/anchor_lon/avg_distance_m/avg_elevation_m du segment
 * tel que renvoyé par get_climb_segments — c'est ce point géographique, pas
 * un id de segment (instable), qui identifie la montée d'un appel à l'autre.
 */
export async function rename_climb_segment(anchor, name, existingNameId) {
  if (!anchor || !Number.isFinite(anchor.anchor_lat) || !Number.isFinite(anchor.anchor_lon)) {
    return { error: "Point de référence de la montée manquant." };
  }
  const trimmed = (name || "").trim();
  if (!trimmed) {
    if (existingNameId) await db.deleteClimbName(existingNameId);
    return { status: "ok", cleared: true };
  }
  const id = await db.upsertClimbName(existingNameId || null, {
    anchor_lat: anchor.anchor_lat,
    anchor_lon: anchor.anchor_lon,
    anchor_distance_m: anchor.avg_distance_m,
    anchor_elevation_m: anchor.avg_elevation_m,
    name: trimmed,
  });
  return { status: "ok", name_id: id };
}

/* ------------------------------------------------------------------ */
/* Objectifs (compte à rebours)                                        */
/* ------------------------------------------------------------------ */

export async function list_goals() {
  const goals = await db.listGoals();
  const rides = await db.listRides();

  const longestRideKm = rides.length ? Math.max(...rides.map((r) => r.distance_km || 0)) : 0;
  const biggestElevationM = rides.length ? Math.max(...rides.map((r) => r.elevation_gain_m || 0)) : 0;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  return goals.map((g) => {
    const eventDate = new Date(g.event_date + "T00:00:00");
    const daysRemaining = Math.round((eventDate - today) / 86400000);
    return {
      id: g.id,
      name: g.name,
      event_date: g.event_date,
      target_distance_km: g.target_distance_km ?? null,
      target_elevation_m: g.target_elevation_m ?? null,
      days_remaining: daysRemaining,
      longest_ride_km: round(longestRideKm, 1),
      biggest_elevation_m: Math.round(biggestElevationM),
    };
  });
}

export async function add_goal(goal) {
  if (!goal.name || !goal.event_date) return { error: "Nom et date de l'événement requis." };
  const id = await db.addGoal({
    name: goal.name,
    event_date: goal.event_date,
    target_distance_km: goal.target_distance_km ?? null,
    target_elevation_m: goal.target_elevation_m ?? null,
  });
  return { id };
}

export async function delete_goal(id) {
  await db.deleteGoal(id);
  return { status: "ok" };
}

function round(v, digits = 0) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
