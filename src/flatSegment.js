// Segment plat de référence : repère automatiquement une portion plate
// d'environ 5 minutes par sortie, pour comparer vitesse/FC à effort comparable
// dans le temps — un indicateur de forme complémentaire à la charge
// d'entraînement et au suivi des montées.
//
// Règles de sélection (décidées avec l'utilisateur) :
//  - candidat = tronçon plat continu d'au moins FLAT_MIN_DURATION_S (5 min)
//  - on écarte les candidats à vitesse trop irrégulière (coefficient de
//    variation > FLAT_MAX_SPEED_CV) : une portion "plate" en ville, hachée
//    par des feux rouges, a une pente nulle mais une vitesse moyenne
//    artificiellement basse et non représentative d'un effort régulier —
//    ce filtre s'applique AVANT la comparaison de durée, pas après, pour
//    qu'un tronçon urbain long et haché ne batte jamais un vrai plat plus
//    court mais régulier.
//  - parmi les candidats restants, on garde le plus long en durée RÉELLE
//  - égalité -> le premier rencontré dans la sortie
//  - le segment retenu est ensuite tronqué à FLAT_MAX_DURATION_S (20 min) pour
//    le calcul des métriques, afin de rester comparable d'une sortie à l'autre
//    (un plat de 45 min mesurerait autre chose qu'un "test" de 5-20 min). La
//    régularité de vitesse est jugée sur cette même fenêtre tronquée : c'est
//    elle qui sera effectivement rapportée, pas les minutes au-delà.

import { cumulativeElevationGainSeries } from "./analysis.js";

export function detectFlatSegment(df, cfg) {
  const n = df.n;
  const isFlat = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = df.grade_pct[i];
    isFlat[i] = df.is_moving[i] && Number.isFinite(g) && Math.abs(g) <= cfg.FLAT_MAX_GRADE_PCT ? 1 : 0;
  }

  const segments = contiguousSegments(isFlat);

  const candidates = segments
    .map(([s, e]) => {
      let durS = 0;
      for (let i = s; i <= e; i++) durS += df.moving_dt_s[i];
      return { start: s, end: e, durationS: durS };
    })
    .filter((c) => c.durationS >= cfg.FLAT_MIN_DURATION_S)
    .map((c) => {
      // Régularité jugée sur la fenêtre qui sera effectivement rapportée
      // (tronquée à 20 min), pas sur un éventuel très long tronçon au-delà.
      const capped = truncatedWindow(df, c.start, c.end, cfg.FLAT_MAX_DURATION_S);
      return { ...c, cappedEnd: capped.end, speedCv: speedCoefficientOfVariation(df, c.start, capped.end) };
    });

  const regular = candidates.filter((c) => c.speedCv !== null && c.speedCv <= cfg.FLAT_MAX_SPEED_CV);
  if (!regular.length) return null;

  let best = regular[0];
  for (const c of regular) {
    if (c.durationS > best.durationS) best = c;
  }

  return computeFlatSegmentMetrics(df, best.start, best.end, cfg);
}

/** Coefficient de variation (écart-type / moyenne) de la vitesse sur [start, end]. */
function speedCoefficientOfVariation(df, start, end) {
  const speeds = [];
  for (let i = start; i <= end; i++) {
    if (Number.isFinite(df.speed_kmh[i])) speeds.push(df.speed_kmh[i]);
  }
  if (speeds.length < 10) return null;
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  if (mean <= 0) return null;
  const variance = speeds.reduce((a, v) => a + (v - mean) ** 2, 0) / speeds.length;
  return Math.sqrt(variance) / mean;
}

/** Indice de fin après troncature à maxDurationS de temps mobile depuis start. */
function truncatedWindow(df, start, end, maxDurationS) {
  let cappedEnd = start;
  let durS = 0;
  for (let i = start; i <= end; i++) {
    durS += df.moving_dt_s[i];
    cappedEnd = i;
    if (durS >= maxDurationS) break;
  }
  return { end: cappedEnd, durationS: durS };
}

function computeFlatSegmentMetrics(df, start, end, cfg) {
  const { end: cappedEnd, durationS: durS } = truncatedWindow(df, start, end, cfg.FLAT_MAX_DURATION_S);

  const distanceM = df.distance[cappedEnd] - df.distance[start];
  const startKm = (df.distance[start] - df.distance[0]) / 1000;

  let hrSum = 0, hrCount = 0;
  for (let i = start; i <= cappedEnd; i++) {
    if (Number.isFinite(df.heart_rate[i])) { hrSum += df.heart_rate[i]; hrCount++; }
  }
  const avgHr = hrCount > 0 ? hrSum / hrCount : NaN;
  const avgSpeedKmh = durS > 0 ? (distanceM / 1000) / (durS / 3600) : NaN;
  // FC par km/h : plus bas = plus efficace (moins de battements de cœur
  // nécessaires pour une vitesse donnée). Moins sensible que la vitesse
  // brute à qui pousse le rythme dans un groupe — si tu roules derrière
  // quelqu'un de plus fort, ta vitesse peut monter à FC comparable
  // (aspiration), ce que la vitesse seule ne distingue pas d'un vrai gain
  // de forme, alors que ce ratio reste au moins partiellement révélateur.
  const hrPerKmh = (Number.isFinite(avgHr) && Number.isFinite(avgSpeedKmh) && avgSpeedKmh > 0)
    ? avgHr / avgSpeedKmh : NaN;

  const cumulGain = cumulativeElevationGainSeries(df.alt_smooth, cfg.ELEVATION_THRESHOLD_M);
  const elevationGainBeforeM = cumulGain[start];

  const truncated = cappedEnd < end;

  return {
    start_idx: start,
    end_idx: cappedEnd,
    start_time: new Date(df.timestamp[start]).toISOString(),
    end_time: new Date(df.timestamp[cappedEnd]).toISOString(),
    duration_s: round(durS),
    distance_m: round(distanceM),
    avg_speed_kmh: round(avgSpeedKmh, 1),
    avg_hr: round(avgHr),
    hr_per_kmh: round(hrPerKmh, 2),
    start_km: round(startKm, 1),
    elevation_gain_before_m: round(elevationGainBeforeM),
    truncated,
  };
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

function round(v, digits = 0) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
