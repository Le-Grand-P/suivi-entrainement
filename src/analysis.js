// Analyse d'une sortie : stats globales + détection/analyse des montées.
// Port fidèle de backend/analysis.py (application desktop) — mêmes formules,
// mêmes seuils, mêmes garde-fous (dérive cardiaque sur temps mobile, VAM
// insensible aux pauses, hystérésis du D+, etc.). Toute divergence de
// comportement avec la version desktop serait un bug de ce fichier.

import { applyMovingFilter } from "./fitParser.js";

/* ---------------------------------------------------------------------- */
/* Puissance estimée (modèle physique + facteur de correction empirique)  */
/* ---------------------------------------------------------------------- */

export function estimatePowerArray(speedKmh, gradePct, cfg, massKg) {
  const mass = massKg ?? cfg.SYSTEM_WEIGHT_KG;
  const n = speedKmh.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = speedKmh[i];
    const g = Number.isFinite(gradePct[i]) ? gradePct[i] : 0;
    if (!Number.isFinite(v) || v <= 0) { out[i] = NaN; continue; }
    const vActual = v / 3.6;
    const theta = Math.atan(g / 100);
    const fGravity = mass * cfg.G * Math.sin(theta);
    const fRoll = mass * cfg.G * cfg.CRR * Math.cos(theta);
    // La traînée aéro dépend du CUBE de la vitesse (force * vitesse) : gonfler
    // la vitesse AVANT ce calcul (comme le faisait l'ancienne version) amplifie
    // le facteur de correction en cube au lieu de le laisser linéaire — un
    // correctif de ~19% calibré en montée lente (aéro négligeable) se
    // retrouvait à ~88% d'inflation sur le terme aéro, pire à haute vitesse
    // (jusqu'à +205% en descente rapide, cas concret constaté et corrigé).
    // Le facteur de correction est donc appliqué ici à la PUISSANCE finale,
    // uniformément quelle que soit la vitesse — cohérent avec l'idée d'un
    // ~19% de pertes réelles non modélisées (drivetrain, pacing, mesure),
    // pas spécifiquement aérodynamiques.
    const fAero = 0.5 * cfg.AIR_DENSITY * cfg.CDA * vActual ** 2;
    let power = ((fGravity + fRoll + fAero) * vActual) / cfg.DRIVETRAIN_EFFICIENCY;
    power = power / cfg.SPEED_CORRECTION_FACTOR;
    if (!Number.isFinite(power) || power < 0) power = Number.isFinite(power) ? 0 : NaN;
    out[i] = power;
  }
  return out;
}

export function estimatePower(speedKmh, gradePct, cfg, massKg) {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) return NaN;
  return estimatePowerArray(
    Float64Array.of(speedKmh), Float64Array.of(gradePct || 0), cfg, massKg
  )[0];
}

/* ---------------------------------------------------------------------- */
/* Préparation : lissage altitude + pente                                  */
/* ---------------------------------------------------------------------- */

/** Moyenne glissante centrée, min_periods=1 (bords tronqués, pas de NaN). */
function rollingMeanCentered(arr, window) {
  const n = arr.length;
  const out = new Float64Array(n);
  const half = Math.floor(window / 2);
  // Somme glissante via fenêtre prefix-sum pour rester O(n).
  const prefix = new Float64Array(n + 1);
  const validPrefix = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(arr[i]) ? arr[i] : 0;
    prefix[i + 1] = prefix[i] + v;
    validPrefix[i + 1] = validPrefix[i] + (Number.isFinite(arr[i]) ? 1 : 0);
  }
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half + (window % 2 === 0 ? -1 : 0));
    const sum = prefix[hi + 1] - prefix[lo];
    const cnt = validPrefix[hi + 1] - validPrefix[lo];
    out[i] = cnt > 0 ? sum / cnt : NaN;
  }
  return out;
}

/**
 * Ajoute alt_smooth et grade_pct. La pente est calculée sur une FENÊTRE DE
 * DISTANCE (pas point à point) : à 1 Hz, deux points consécutifs sont
 * séparés de quelques mètres en montée, et le bruit de l'altimètre
 * barométrique y produirait des pentes aberrantes.
 */
export function addSmoothedAltitudeAndGrade(df, cfg) {
  const n = df.n;
  const altSmooth = rollingMeanCentered(df.altitude, cfg.ALTITUDE_SMOOTHING_WINDOW);

  const dist = df.distance;
  const gradeRaw = new Float64Array(n).fill(NaN);
  const windowM = cfg.GRADE_WINDOW_M;

  if (countFinite(dist) >= 2) {
    for (let i = 0; i < n; i++) {
      const target = dist[i] - windowM;
      const j = searchSortedLeft(dist, target);
      const jj = Math.min(Math.max(j, 0), n - 1);
      const dDist = dist[i] - dist[jj];
      const dAlt = altSmooth[i] - altSmooth[jj];
      if (dDist >= 1.0) gradeRaw[i] = (dAlt / dDist) * 100;
    }
  }
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(gradeRaw[i])) gradeRaw[i] = Math.max(-35, Math.min(35, gradeRaw[i]));
  }
  const grade = rollingMeanCentered(gradeRaw, 5);

  return { ...df, alt_smooth: altSmooth, grade_pct: grade };
}

/** Indice j le plus petit tel que dist[j] >= target (dist supposé croissant). */
function searchSortedLeft(dist, target) {
  let lo = 0, hi = dist.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function countFinite(arr) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) c++;
  return c;
}

/**
 * Dénivelé positif/négatif avec hystérésis : une variation ne compte que
 * lorsqu'elle dépasse threshold_m depuis le dernier extremum retenu. Sans ça,
 * le bruit barométrique résiduel gonfle le D+ de plusieurs pourcents.
 * Accepte soit un Float64Array déjà "propre", soit un tableau avec NaN.
 */
export function accumulateElevation(altArr, thresholdM) {
  const values = [];
  for (let i = 0; i < altArr.length; i++) if (Number.isFinite(altArr[i])) values.push(altArr[i]);
  if (values.length < 2) return [0, 0];

  let gain = 0, loss = 0;
  let anchor = values[0];
  let direction = 0;

  for (const v of values) {
    const delta = v - anchor;
    if (direction >= 0 && delta >= thresholdM) {
      gain += delta; anchor = v; direction = 1;
    } else if (direction <= 0 && delta <= -thresholdM) {
      loss += -delta; anchor = v; direction = -1;
    } else if (direction === 1 && delta < -thresholdM) {
      anchor = v; direction = -1;
    } else if (direction === -1 && delta > thresholdM) {
      anchor = v; direction = 1;
    } else if ((direction === 1 && v > anchor) || (direction === -1 && v < anchor)) {
      if (direction === 1) gain += v - anchor; else loss += anchor - v;
      anchor = v;
    }
  }
  return [gain, loss];
}

/**
 * Version "série" de accumulateElevation : renvoie le D+ CUMULÉ à chaque
 * indice (même longueur que altArr, indices alignés — contrairement à
 * accumulateElevation qui travaille sur les seules valeurs finies). Sert à
 * savoir "combien de D+ déjà grimpé à ce point de la sortie" (voir
 * flatSegment.js). Même state-machine à hystérésis, donc mêmes garanties de
 * robustesse au bruit barométrique — la valeur au DERNIER indice doit
 * toujours correspondre exactement au gain total renvoyé par
 * accumulateElevation sur le même tableau (vérifié par test).
 */
export function cumulativeElevationGainSeries(altArr, thresholdM) {
  const n = altArr.length;
  const out = new Float64Array(n);
  let gain = 0;
  let anchor = null;
  let direction = 0;
  let lastFinite = 0;

  for (let i = 0; i < n; i++) {
    const v = altArr[i];
    if (!Number.isFinite(v)) { out[i] = lastFinite; continue; }
    if (anchor === null) { anchor = v; out[i] = 0; lastFinite = 0; continue; }

    const delta = v - anchor;
    if (direction >= 0 && delta >= thresholdM) {
      gain += delta; anchor = v; direction = 1;
    } else if (direction <= 0 && delta <= -thresholdM) {
      anchor = v; direction = -1;
    } else if (direction === 1 && delta < -thresholdM) {
      anchor = v; direction = -1;
    } else if (direction === -1 && delta > thresholdM) {
      anchor = v; direction = 1;
    } else if ((direction === 1 && v > anchor) || (direction === -1 && v < anchor)) {
      if (direction === 1) gain += v - anchor;
      anchor = v;
    }
    out[i] = gain;
    lastFinite = gain;
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Stats globales                                                          */
/* ---------------------------------------------------------------------- */

function round(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

export function computeGlobalStats(df, cfg) {
  const n = df.n;
  const totalTimeS = (df.timestamp[n - 1] - df.timestamp[0]) / 1000;
  let movingTimeS = 0;
  for (let i = 0; i < n; i++) movingTimeS += df.moving_dt_s[i];

  let distanceKm = NaN;
  if (countFinite(df.distance) > 0) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(df.distance[i])) continue;
      if (df.distance[i] < mn) mn = df.distance[i];
      if (df.distance[i] > mx) mx = df.distance[i];
    }
    distanceKm = (mx - mn) / 1000;
  }

  const [elevGain, elevLoss] = accumulateElevation(df.alt_smooth, cfg.ELEVATION_THRESHOLD_M);

  const avgSpeedKmh = movingTimeS > 0 ? distanceKm / (movingTimeS / 3600) : NaN;
  let maxSpeedKmh = NaN;
  for (let i = 0; i < n; i++) {
    if (df.is_moving[i] && Number.isFinite(df.speed_kmh[i])) {
      maxSpeedKmh = Number.isFinite(maxSpeedKmh) ? Math.max(maxSpeedKmh, df.speed_kmh[i]) : df.speed_kmh[i];
    }
  }

  let hrSum = 0, hrCount = 0, maxHr = NaN;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(df.heart_rate[i])) {
      maxHr = Number.isFinite(maxHr) ? Math.max(maxHr, df.heart_rate[i]) : df.heart_rate[i];
      if (df.is_moving[i]) { hrSum += df.heart_rate[i]; hrCount++; }
    }
  }
  const avgHr = hrCount > 0 ? hrSum / hrCount : NaN;

  let cadSum = 0, cadCount = 0;
  for (let i = 0; i < n; i++) {
    if (df.is_moving[i] && Number.isFinite(df.cadence[i]) && df.cadence[i] > 0) {
      cadSum += df.cadence[i]; cadCount++;
    }
  }
  const avgCadence = cadCount > 0 ? cadSum / cadCount : NaN;

  const power = estimatePowerArray(df.speed_kmh, df.grade_pct, cfg);
  let powW = 0, wSum = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(power[i]) && df.moving_dt_s[i] > 0) {
      powW += power[i] * df.moving_dt_s[i];
      wSum += df.moving_dt_s[i];
    }
  }
  const avgPowerEst = wSum > 0 ? powW / wSum : NaN;
  const normPower = normalizedPower(df, power);
  const decoupling = computeAerobicDecoupling(df);

  return {
    duration_s: round(totalTimeS),
    moving_time_s: round(movingTimeS),
    distance_km: round(distanceKm, 2),
    elevation_gain_m: round(elevGain),
    elevation_loss_m: round(elevLoss),
    avg_speed_kmh: round(avgSpeedKmh, 1),
    max_speed_kmh: round(maxSpeedKmh, 1),
    avg_hr: round(avgHr),
    max_hr: round(maxHr),
    avg_cadence: round(avgCadence),
    avg_power_est_w: round(avgPowerEst),
    norm_power_est_w: round(normPower),
    avg_power_est_pct_ftp: Number.isFinite(avgPowerEst) ? round((avgPowerEst / cfg.CURRENT_FTP_W) * 100) : null,
    aerobic_decoupling_pct: round(decoupling, 1),
    hr_zones_pct: computeHrZoneDistribution(df, cfg),
  };
}

function normalizedPower(df, power) {
  const n = df.n;
  const masked = new Float64Array(n).fill(NaN);
  let validCount = 0;
  for (let i = 0; i < n; i++) {
    if (df.is_moving[i] && Number.isFinite(power[i])) { masked[i] = power[i]; validCount++; }
  }
  if (validCount < 30) return NaN;

  // Moyenne glissante 30 points, min_periods=20, NON centrée (trailing,
  // comme pandas.rolling par défaut).
  const rolled = [];
  let sum = 0, cnt = 0;
  const buf = [];
  for (let i = 0; i < n; i++) {
    const v = masked[i];
    buf.push(v);
    if (Number.isFinite(v)) { sum += v; cnt++; }
    if (buf.length > 30) {
      const old = buf.shift();
      if (Number.isFinite(old)) { sum -= old; cnt--; }
    }
    if (buf.length >= 20 && cnt > 0) rolled.push(sum / cnt);
  }
  if (!rolled.length) return NaN;
  let quarticSum = 0;
  for (const r of rolled) quarticSum += r ** 4;
  return (quarticSum / rolled.length) ** 0.25;
}

function computeHrZoneDistribution(df, cfg) {
  const n = df.n;
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(df.heart_rate[i]) && df.moving_dt_s[i] > 0) total += df.moving_dt_s[i];
  }
  if (total <= 0) return null;

  const reserve = cfg.FC_MAX - cfg.FC_REPOS;
  const bounds = [0.6, 0.7, 0.8, 0.9].map((p) => cfg.FC_REPOS + reserve * p);
  const labels = ["Z1 récup", "Z2 endurance", "Z3 tempo", "Z4 seuil", "Z5 VO2max"];
  const edges = [-Infinity, ...bounds, Infinity];

  const out = {};
  for (let z = 0; z < labels.length; z++) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(df.heart_rate[i]) || df.moving_dt_s[i] <= 0) continue;
      const hr = df.heart_rate[i];
      if (hr > edges[z] && hr <= edges[z + 1]) w += df.moving_dt_s[i];
    }
    out[labels[z]] = round((w / total) * 100, 1);
  }
  return out;
}

export function computeAerobicDecoupling(df) {
  const n = df.n;
  const idx = [];
  for (let i = 0; i < n; i++) {
    if (df.is_moving[i] && Number.isFinite(df.heart_rate[i]) && df.heart_rate[i] > 0 &&
        Number.isFinite(df.speed_kmh[i]) && df.speed_kmh[i] > 0) {
      idx.push(i);
    }
  }
  if (idx.length < 60) return null;

  const mtMin = df.moving_time_s[idx[0]];
  const mtMax = df.moving_time_s[idx[idx.length - 1]];
  const totalMoving = mtMax - mtMin;
  if (totalMoving < 1800) return null;

  const mid = mtMin + totalMoving / 2;
  const first = idx.filter((i) => df.moving_time_s[i] <= mid);
  const second = idx.filter((i) => df.moving_time_s[i] > mid);
  if (first.length < 30 || second.length < 30) return null;

  const ratio1 = mean(first.map((i) => df.speed_kmh[i] / df.heart_rate[i]));
  const ratio2 = mean(second.map((i) => df.speed_kmh[i] / df.heart_rate[i]));
  if (!Number.isFinite(ratio1) || ratio1 === 0) return null;
  return ((ratio1 - ratio2) / ratio1) * 100;
}

function mean(arr) {
  if (!arr.length) return NaN;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

/* ---------------------------------------------------------------------- */
/* Détection et analyse des montées                                        */
/* ---------------------------------------------------------------------- */

export function detectClimbs(df, cfg) {
  const n = df.n;
  const steep = new Uint8Array(n);
  let lastGrade = 0;
  for (let i = 0; i < n; i++) {
    // ffill du trou ponctuel de pente (comme grade.ffill().fillna(0) en Python)
    if (Number.isFinite(df.grade_pct[i])) lastGrade = df.grade_pct[i];
    steep[i] = lastGrade >= cfg.CLIMB_MIN_GRADE_PCT ? 1 : 0;
  }
  const isClimbing = new Uint8Array(n);
  for (let i = 0; i < n; i++) isClimbing[i] = steep[i] && df.is_moving[i] ? 1 : 0;

  let segments = contiguousSegments(isClimbing);
  segments = mergeCloseSegments(segments, df, cfg);
  segments = segments.map(([s, e]) => trimStationary(df, s, e)).filter((s) => s !== null);

  const climbs = [];
  for (const [s, e] of segments) {
    const metrics = computeClimbMetrics(df, s, e, cfg, true);
    if (metrics) climbs.push(metrics);
  }
  return climbs;
}

/**
 * Métriques d'une montée délimitée par [start, end]. Utilisée à la fois par
 * la détection auto et par l'ajustement manuel des bornes (enforceThresholds
 * = false : si l'utilisateur a délimité un segment lui-même, son choix prime).
 */
export function computeClimbMetrics(df, start, end, cfg, enforceThresholds = true) {
  const n = df.n;
  if (n === 0) return null;
  start = Math.max(0, Math.min(start, n - 1));
  end = Math.max(0, Math.min(end, n - 1));
  if (end <= start) return null;
  if (end - start < 2) return null;

  const dist = df.distance;
  const distanceM = dist[end] - dist[start];
  const netGainM = df.alt_smooth[end] - df.alt_smooth[start];
  const altSlice = df.alt_smooth.slice(start, end + 1);
  const [gainM] = accumulateElevation(altSlice, cfg.ELEVATION_THRESHOLD_M);

  let durationS = 0;
  for (let i = start; i <= end; i++) durationS += df.moving_dt_s[i];
  if (durationS <= 0) durationS = (df.timestamp[end] - df.timestamp[start]) / 1000;
  if (durationS <= 0 || distanceM <= 0) return null;

  if (enforceThresholds && (distanceM < cfg.CLIMB_MIN_DISTANCE_M || netGainM < cfg.CLIMB_MIN_ELEVATION_M)) {
    return null;
  }

  const avgGradePct = (netGainM / distanceM) * 100;
  const vamMh = netGainM / (durationS / 3600);
  const avgSpeedKmh = (distanceM / 1000) / (durationS / 3600);

  let hrSum = 0, hrCount = 0, maxHr = NaN;
  for (let i = start; i <= end; i++) {
    if (df.is_moving[i] && Number.isFinite(df.heart_rate[i])) {
      hrSum += df.heart_rate[i]; hrCount++;
      maxHr = Number.isFinite(maxHr) ? Math.max(maxHr, df.heart_rate[i]) : df.heart_rate[i];
    }
  }
  const avgHr = hrCount > 0 ? hrSum / hrCount : NaN;
  const hrDrift = hrDriftMoving(df, start, end);

  const estPowerW = estimatePower(avgSpeedKmh, avgGradePct, cfg);
  const wPerKg = Number.isFinite(estPowerW) ? estPowerW / cfg.RIDER_WEIGHT_KG : NaN;
  let maxGrade = NaN;
  for (let i = start; i <= end; i++) {
    if (Number.isFinite(df.grade_pct[i])) maxGrade = Number.isFinite(maxGrade) ? Math.max(maxGrade, df.grade_pct[i]) : df.grade_pct[i];
  }

  return {
    start_idx: start,
    end_idx: end,
    start_time: new Date(df.timestamp[start]).toISOString(),
    end_time: new Date(df.timestamp[end]).toISOString(),
    // Coordonnées de départ/arrivée : permettent de reconnaître qu'une montée
    // sur une NOUVELLE sortie est "la même" qu'une montée déjà vue sur une
    // sortie précédente (voir climbSegments.js). Les montées détectées AVANT
    // l'ajout de ce champ n'en disposent pas — elles restent analysées
    // individuellement mais n'entrent pas dans le suivi inter-sorties tant
    // que la sortie qui les contient n'est pas réimportée.
    start_lat: Number.isFinite(df.lat?.[start]) ? round(df.lat[start], 5) : null,
    start_lon: Number.isFinite(df.lon?.[start]) ? round(df.lon[start], 5) : null,
    end_lat: Number.isFinite(df.lat?.[end]) ? round(df.lat[end], 5) : null,
    end_lon: Number.isFinite(df.lon?.[end]) ? round(df.lon[end], 5) : null,
    distance_m: round(distanceM),
    elevation_gain_m: round(netGainM),
    elevation_gain_cumul_m: round(gainM),
    duration_s: round(durationS),
    avg_grade_pct: round(avgGradePct, 1),
    max_grade_pct: round(maxGrade, 1),
    vam_mh: round(vamMh),
    avg_speed_kmh: round(avgSpeedKmh, 1),
    avg_hr: round(avgHr),
    max_hr: round(maxHr),
    hr_drift_bpm: round(hrDrift, 1),
    est_power_w: round(estPowerW),
    est_w_per_kg: round(wPerKg, 2),
    est_power_pct_ftp: Number.isFinite(estPowerW) ? round((estPowerW / cfg.CURRENT_FTP_W) * 100) : null,
  };
}

/** FC moyenne 2e moitié - 1re moitié, en ne considérant QUE les points en
 * mouvement du segment (une pause tombant dedans ne doit pas polluer). */
function hrDriftMoving(df, start, end) {
  const idx = [];
  for (let i = start; i <= end; i++) {
    if (df.is_moving[i] && Number.isFinite(df.heart_rate[i])) idx.push(i);
  }
  if (idx.length < 10) return null;

  const t0 = df.timestamp[idx[0]];
  const t1 = df.timestamp[idx[idx.length - 1]];
  const totalS = (t1 - t0) / 1000;
  if (totalS < 120) return null;

  const midT = t0 + (totalS * 1000) / 2;
  const first = idx.filter((i) => df.timestamp[i] <= midT);
  const second = idx.filter((i) => df.timestamp[i] > midT);
  if (first.length < 5 || second.length < 5) return null;

  const m1 = mean(first.map((i) => df.heart_rate[i]));
  const m2 = mean(second.map((i) => df.heart_rate[i]));
  return m2 - m1;
}

function contiguousSegments(mask) {
  const segments = [];
  let start = null;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && start === null) start = i;
    else if (!mask[i] && start !== null) { segments.push([start, i - 1]); start = null; }
  }
  if (start !== null) segments.push([start, mask.length - 1]);
  return segments;
}

function trimStationary(df, start, end) {
  let s = start, e = end;
  while (s < e && !df.is_moving[s]) s++;
  while (e > s && !df.is_moving[e]) e--;
  return e > s ? [s, e] : null;
}

function mergeCloseSegments(segments, df, cfg) {
  if (!segments.length) return segments;
  const dist = df.distance;
  const merged = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const [start, end] = segments[i];
    const [, prevEnd] = merged[merged.length - 1];
    const gapM = dist[start] - dist[prevEnd];
    if (gapM <= cfg.CLIMB_MERGE_GAP_M) {
      merged[merged.length - 1] = [merged[merged.length - 1][0], end];
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/* ---------------------------------------------------------------------- */

/** Pipeline complet : temps mobile -> lissage/pente -> stats -> montées.
 * Symétrique à analyze_ride(df_raw) côté desktop : accepte le df BRUT tel
 * que renvoyé par parseFitFile (sans filtre de mouvement appliqué). */
export function analyzeRide(dfRaw, cfg) {
  const df = applyMovingFilter(dfRaw, cfg);
  const withGrade = addSmoothedAltitudeAndGrade(df, cfg);
  return {
    globalStats: computeGlobalStats(withGrade, cfg),
    climbs: detectClimbs(withGrade, cfg),
    df: withGrade,
  };
}
