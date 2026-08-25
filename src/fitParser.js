// Extraction des données brutes d'un .fit vers une structure colonnaire
// ("df" = objet de tableaux typés, un indice = un point). Port fidèle de
// backend/fit_parser.py (application desktop) : mêmes règles, mêmes seuils.
//
// Note sur les champs "enhanced_*" : les Garmin récents enregistrent souvent
// enhanced_altitude / enhanced_speed (plus grande plage/précision) au lieu,
// ou en plus, de altitude / speed. Les ignorer revient à ne rien lire du
// tout sur ces fichiers (bug réel rencontré et corrigé côté desktop).

const EARTH_RADIUS_M = 6371000.0;

export class ParseError extends Error {}

/**
 * Parse un fichier .fit (File ou ArrayBuffer) et retourne un "df" colonnaire.
 * Lève ParseError si le fichier est illisible ou vide.
 */
export async function parseFitFile(fileOrBuffer, filename = "fichier.fit") {
  const buffer = fileOrBuffer instanceof ArrayBuffer
    ? fileOrBuffer
    : await fileOrBuffer.arrayBuffer();

  const raw = await new Promise((resolve, reject) => {
    let fp;
    try {
      fp = new window.FitParser({
        force: true,
        mode: "list",
        elapsedRecordField: false,
        speedUnit: "m/s",         // cohérent avec le *3.6 appliqué plus bas
        lengthUnit: "m",
        temperatureUnit: "celsius",
      });
    } catch (e) {
      reject(new ParseError(`Impossible d'initialiser le lecteur .fit : ${e.message}`));
      return;
    }
    fp.parse(buffer, (err, data) => {
      if (err) {
        reject(new ParseError(`Fichier .fit illisible (${filename}) : ${err}`));
        return;
      }
      resolve(data);
    });
  });

  const records = raw && raw.records ? raw.records : [];
  if (!records.length) {
    throw new ParseError(
      `Aucune donnée d'activité trouvée dans ${filename}. ` +
      `S'agit-il bien d'un fichier d'activité (et non d'un parcours ou de réglages) ?`
    );
  }

  // --- Extraction brute + horodatage ---
  const rows = [];
  for (const r of records) {
    if (r.timestamp === undefined || r.timestamp === null) continue;
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    rows.push({
      t,
      lat: numOrNaN(r.position_lat),
      lon: numOrNaN(r.position_long),
      altitude: firstFinite(r.enhanced_altitude, r.altitude),
      speed_ms: firstFinite(r.enhanced_speed, r.speed),
      distance: numOrNaN(r.distance),
      heart_rate: numOrNaN(r.heart_rate),
      cadence: numOrNaN(r.cadence),
      power: numOrNaN(r.power),
      temperature: numOrNaN(r.temperature),
    });
  }
  if (!rows.length) {
    throw new ParseError(`Aucun horodatage valide dans ${filename}`);
  }

  rows.sort((a, b) => a.t - b.t);
  const dedup = [];
  let lastT = null;
  for (const row of rows) {
    if (row.t !== lastT) { dedup.push(row); lastT = row.t; }
  }

  const n = dedup.length;
  const df = {
    n,
    timestamp: new Float64Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    altitude: new Float64Array(n),
    distance: new Float64Array(n),
    speed_kmh: new Float64Array(n),
    heart_rate: new Float64Array(n),
    cadence: new Float64Array(n),
    power: new Float64Array(n),
    temperature: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const row = dedup[i];
    df.timestamp[i] = row.t;
    df.lat[i] = row.lat;
    df.lon[i] = row.lon;
    df.altitude[i] = row.altitude;
    df.distance[i] = row.distance;
    df.heart_rate[i] = row.heart_rate;
    df.cadence[i] = row.cadence;
    df.power[i] = row.power;
    df.temperature[i] = row.temperature;
  }

  if (countFinite(df.distance) < 2) {
    df.distance = cumulativeHaversine(df.lat, df.lon);
    df.distanceSource = "gps";
  } else {
    ffillBfillInPlace(df.distance);
    df.distanceSource = "device";
  }

  const speedRaw = new Float64Array(n);
  for (let i = 0; i < n; i++) speedRaw[i] = dedup[i].speed_ms;
  if (countFinite(speedRaw) < 2) {
    for (let i = 0; i < n; i++) {
      if (i === 0) { df.speed_kmh[i] = NaN; continue; }
      const dtS = (df.timestamp[i] - df.timestamp[i - 1]) / 1000;
      const dd = df.distance[i] - df.distance[i - 1];
      const v = dtS > 0 ? (dd / dtS) * 3.6 : NaN;
      df.speed_kmh[i] = clamp(v, 0, 150);
    }
    bfillInPlace(df.speed_kmh);
    df.speedSource = "derived";
  } else {
    for (let i = 0; i < n; i++) {
      df.speed_kmh[i] = clamp(speedRaw[i] * 3.6, 0, 150);
    }
    ffillBfillInPlace(df.speed_kmh);
    df.speedSource = "device";
  }

  if (countFinite(df.altitude) > 0) {
    interpolateInPlace(df.altitude);
    ffillBfillInPlace(df.altitude);
  }

  return df;
}

/* ------------------------------------------------------------------ */

function numOrNaN(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

function firstFinite(...vals) {
  for (const v of vals) {
    const n = numOrNaN(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function countFinite(arr) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) c++;
  return c;
}

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return v;
  return Math.min(hi, Math.max(lo, v));
}

function ffillBfillInPlace(arr) {
  let last = NaN;
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) last = arr[i];
    else if (Number.isFinite(last)) arr[i] = last;
  }
  let next = NaN;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (Number.isFinite(arr[i])) next = arr[i];
    else if (Number.isFinite(next)) arr[i] = next;
  }
}

function bfillInPlace(arr) {
  let next = NaN;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (Number.isFinite(arr[i])) next = arr[i];
    else if (Number.isFinite(next)) arr[i] = next;
  }
}

function interpolateInPlace(arr) {
  const n = arr.length;
  let i = 0;
  while (i < n) {
    if (Number.isFinite(arr[i])) { i++; continue; }
    let j = i;
    while (j < n && !Number.isFinite(arr[j])) j++;
    const leftVal = i > 0 ? arr[i - 1] : NaN;
    const rightVal = j < n ? arr[j] : NaN;
    if (Number.isFinite(leftVal) && Number.isFinite(rightVal)) {
      const span = j - (i - 1);
      for (let k = i; k < j; k++) {
        const frac = (k - (i - 1)) / span;
        arr[k] = leftVal + (rightVal - leftVal) * frac;
      }
    }
    i = j;
  }
}

function cumulativeHaversine(lat, lon) {
  const n = lat.length;
  const out = new Float64Array(n);
  if (countFinite(lat) === 0 || countFinite(lon) === 0) {
    out.fill(NaN);
    return out;
  }
  const latF = Float64Array.from(lat);
  const lonF = Float64Array.from(lon);
  ffillBfillInPlace(latF);
  ffillBfillInPlace(lonF);

  let cum = 0;
  out[0] = 0;
  for (let i = 1; i < n; i++) {
    const phi1 = (latF[i - 1] * Math.PI) / 180;
    const phi2 = (latF[i] * Math.PI) / 180;
    const dphi = phi2 - phi1;
    const dlam = ((lonF[i] - lonF[i - 1]) * Math.PI) / 180;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
    let step = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
    if (step > 200) step = 0;
    cum += step;
    out[i] = cum;
  }
  return out;
}

/**
 * Marque les points "en mouvement". Ajoute dt_s, is_moving, moving_dt_s,
 * moving_time_s (cumulé).
 */
export function applyMovingFilter(df, cfg) {
  const n = df.n;
  const dtS = new Float64Array(n);
  const isMoving = new Uint8Array(n);
  const movingDtS = new Float64Array(n);
  const movingTimeS = new Float64Array(n);

  let cum = 0;
  for (let i = 0; i < n; i++) {
    const dt = i === 0 ? 0 : (df.timestamp[i] - df.timestamp[i - 1]) / 1000;
    dtS[i] = dt;
    const spd = Number.isFinite(df.speed_kmh[i]) ? df.speed_kmh[i] : 0;
    const moving = dt <= cfg.MOVING_MAX_GAP_S && spd > cfg.MOVING_MIN_SPEED_KMH;
    isMoving[i] = moving ? 1 : 0;
    const mdt = moving ? Math.min(dt, cfg.MOVING_MAX_GAP_S) : 0;
    movingDtS[i] = mdt;
    cum += mdt;
    movingTimeS[i] = cum;
  }
  return { ...df, dt_s: dtS, is_moving: isMoving, moving_dt_s: movingDtS, moving_time_s: movingTimeS };
}
