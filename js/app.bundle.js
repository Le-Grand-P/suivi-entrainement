"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/localApi.js
  var localApi_exports = {};
  __export(localApi_exports, {
    add_goal: () => add_goal,
    compare_rides: () => compare_rides,
    delete_goal: () => delete_goal,
    delete_ride: () => delete_ride,
    get_climb_progression: () => get_climb_progression,
    get_climb_segments: () => get_climb_segments,
    get_compare_metrics: () => get_compare_metrics,
    get_dashboard: () => get_dashboard,
    get_flat_segments: () => get_flat_segments,
    get_profile: () => get_profile,
    get_progression: () => get_progression,
    get_progression_metrics: () => get_progression_metrics,
    get_ride_detail: () => get_ride_detail,
    get_ride_series: () => get_ride_series,
    get_training_load: () => get_training_load,
    import_files: () => import_files,
    list_goals: () => list_goals,
    list_rides: () => list_rides,
    preview_climb: () => preview_climb,
    rename_climb_segment: () => rename_climb_segment,
    reset_climbs: () => reset_climbs,
    save_climb_bounds: () => save_climb_bounds,
    save_profile: () => save_profile
  });

  // src/db.js
  var DB_NAME = "fit_analyzer";
  var DB_VERSION = 3;
  var STORE_RIDES = "rides";
  var STORE_PROFILE = "profile";
  var STORE_GOALS = "goals";
  var STORE_CLIMB_NAMES = "climb_names";
  var _dbPromise = null;
  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_RIDES)) {
          const store = db.createObjectStore(STORE_RIDES, { keyPath: "id", autoIncrement: true });
          store.createIndex("ride_date", "ride_date", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PROFILE)) {
          db.createObjectStore(STORE_PROFILE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_GOALS)) {
          const store = db.createObjectStore(STORE_GOALS, { keyPath: "id", autoIncrement: true });
          store.createIndex("event_date", "event_date", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CLIMB_NAMES)) {
          db.createObjectStore(STORE_CLIMB_NAMES, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }
  function tx(storeName, mode) {
    return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }
  function wrapRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function insertRide({ filename, rideDate, importedAt, stats, climbs, flatSegment, fitBlob }) {
    const store = await tx(STORE_RIDES, "readwrite");
    const record = {
      filename,
      ride_date: rideDate,
      imported_at: importedAt,
      stats,
      climbs,
      flat_segment: flatSegment ?? null,
      fit_blob: fitBlob
    };
    const id = await wrapRequest(store.add(record));
    return id;
  }
  async function listRides() {
    const store = await tx(STORE_RIDES, "readonly");
    const all = await wrapRequest(store.getAll());
    all.sort((a, b) => (b.ride_date || "").localeCompare(a.ride_date || "") || b.id - a.id);
    return all.map((r) => ({
      id: r.id,
      filename: r.filename,
      ride_date: r.ride_date,
      imported_at: r.imported_at,
      ...r.stats
    }));
  }
  async function getRide(id) {
    const store = await tx(STORE_RIDES, "readonly");
    const r = await wrapRequest(store.get(id));
    if (!r) return null;
    return {
      id: r.id,
      filename: r.filename,
      ride_date: r.ride_date,
      imported_at: r.imported_at,
      stats: r.stats,
      climbs: r.climbs,
      flatSegment: r.flat_segment ?? null,
      // Distingue "analysé, aucun plat assez long trouvé" (flat_segment absent
      // MAIS la clé existe, valant null) de "jamais analysé pour cette
      // fonction" (sortie importée avant son ajout, clé absente) — sans ça
      // l'interface afficherait à tort "pas de plat" sur une sortie qui n'a
      // simplement jamais été vérifiée.
      flatSegmentComputed: "flat_segment" in r,
      hasFitBlob: !!r.fit_blob
    };
  }
  async function allFlatSegmentsWithRideDate() {
    const store = await tx(STORE_RIDES, "readonly");
    const all = await wrapRequest(store.getAll());
    return all.filter((r) => r.flat_segment).map((r) => ({ ...r.flat_segment, ride_id: r.id, ride_date: r.ride_date, ride_filename: r.filename })).sort((a, b) => (a.ride_date || "").localeCompare(b.ride_date || ""));
  }
  async function getRideFitBlob(id) {
    const store = await tx(STORE_RIDES, "readonly");
    const r = await wrapRequest(store.get(id));
    return r ? r.fit_blob : null;
  }
  async function updateRideClimbs(id, climbs) {
    const store = await tx(STORE_RIDES, "readwrite");
    const r = await wrapRequest(store.get(id));
    if (!r) throw new Error("Sortie introuvable.");
    r.climbs = climbs;
    await wrapRequest(store.put(r));
  }
  async function deleteRide(id) {
    const store = await tx(STORE_RIDES, "readwrite");
    await wrapRequest(store.delete(id));
  }
  async function rideExists(filename, rideDate, distanceKm) {
    const store = await tx(STORE_RIDES, "readonly");
    const all = await wrapRequest(store.getAll());
    for (const r of all) {
      if (r.filename === filename) return true;
      if (rideDate && distanceKm !== void 0 && r.ride_date === rideDate) {
        const existing = r.stats ? r.stats.distance_km : null;
        if (existing !== null && existing !== void 0 && Math.abs(existing - distanceKm) < 0.05) {
          return true;
        }
      }
    }
    return false;
  }
  async function allClimbsWithRideDate() {
    const store = await tx(STORE_RIDES, "readonly");
    const all = await wrapRequest(store.getAll());
    const out = [];
    for (const r of all) {
      for (const c of r.climbs || []) {
        out.push({ ...c, ride_date: r.ride_date, ride_id: r.id, ride_filename: r.filename });
      }
    }
    out.sort((a, b) => (a.ride_date || "").localeCompare(b.ride_date || "") || a.ride_id - b.ride_id);
    return out;
  }
  async function getConfig(defaults) {
    const store = await tx(STORE_PROFILE, "readonly");
    const row = await wrapRequest(store.get("config"));
    return row ? { ...defaults, ...row.value } : { ...defaults };
  }
  async function saveConfig(cfg) {
    const store = await tx(STORE_PROFILE, "readwrite");
    await wrapRequest(store.put({ key: "config", value: cfg }));
  }
  async function addGoal(goal) {
    const store = await tx(STORE_GOALS, "readwrite");
    return wrapRequest(store.add(goal));
  }
  async function listGoals() {
    const store = await tx(STORE_GOALS, "readonly");
    const all = await wrapRequest(store.getAll());
    return all.sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
  }
  async function deleteGoal(id) {
    const store = await tx(STORE_GOALS, "readwrite");
    await wrapRequest(store.delete(id));
  }
  async function listClimbNames() {
    const store = await tx(STORE_CLIMB_NAMES, "readonly");
    return wrapRequest(store.getAll());
  }
  async function upsertClimbName(existingId, entry) {
    const store = await tx(STORE_CLIMB_NAMES, "readwrite");
    if (existingId) {
      const current = await wrapRequest(store.get(existingId));
      await wrapRequest(store.put({ ...current, ...entry, id: existingId }));
      return existingId;
    }
    return wrapRequest(store.add(entry));
  }
  async function deleteClimbName(id) {
    const store = await tx(STORE_CLIMB_NAMES, "readwrite");
    await wrapRequest(store.delete(id));
  }

  // src/fitParser.js
  var EARTH_RADIUS_M = 6371e3;
  var ParseError = class extends Error {
  };
  async function parseFitFile(fileOrBuffer, filename = "fichier.fit") {
    const buffer = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
    const raw = await new Promise((resolve, reject) => {
      let fp;
      try {
        fp = new window.FitParser({
          force: true,
          mode: "list",
          elapsedRecordField: false,
          speedUnit: "m/s",
          // cohérent avec le *3.6 appliqué plus bas
          lengthUnit: "m",
          temperatureUnit: "celsius"
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
        `Aucune donn\xE9e d'activit\xE9 trouv\xE9e dans ${filename}. S'agit-il bien d'un fichier d'activit\xE9 (et non d'un parcours ou de r\xE9glages) ?`
      );
    }
    const rows = [];
    for (const r of records) {
      if (r.timestamp === void 0 || r.timestamp === null) continue;
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
        temperature: numOrNaN(r.temperature)
      });
    }
    if (!rows.length) {
      throw new ParseError(`Aucun horodatage valide dans ${filename}`);
    }
    rows.sort((a, b) => a.t - b.t);
    const dedup = [];
    let lastT = null;
    for (const row of rows) {
      if (row.t !== lastT) {
        dedup.push(row);
        lastT = row.t;
      }
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
      temperature: new Float64Array(n)
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
        if (i === 0) {
          df.speed_kmh[i] = NaN;
          continue;
        }
        const dtS = (df.timestamp[i] - df.timestamp[i - 1]) / 1e3;
        const dd = df.distance[i] - df.distance[i - 1];
        const v = dtS > 0 ? dd / dtS * 3.6 : NaN;
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
      if (Number.isFinite(arr[i])) {
        i++;
        continue;
      }
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
      const phi1 = latF[i - 1] * Math.PI / 180;
      const phi2 = latF[i] * Math.PI / 180;
      const dphi = phi2 - phi1;
      const dlam = (lonF[i] - lonF[i - 1]) * Math.PI / 180;
      const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
      let step = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
      if (step > 200) step = 0;
      cum += step;
      out[i] = cum;
    }
    return out;
  }
  function applyMovingFilter(df, cfg) {
    const n = df.n;
    const dtS = new Float64Array(n);
    const isMoving = new Uint8Array(n);
    const movingDtS = new Float64Array(n);
    const movingTimeS = new Float64Array(n);
    let cum = 0;
    for (let i = 0; i < n; i++) {
      const dt = i === 0 ? 0 : (df.timestamp[i] - df.timestamp[i - 1]) / 1e3;
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

  // src/analysis.js
  function estimatePowerArray(speedKmh, gradePct, cfg, massKg) {
    const mass = massKg ?? cfg.SYSTEM_WEIGHT_KG;
    const n = speedKmh.length;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = speedKmh[i];
      const g = Number.isFinite(gradePct[i]) ? gradePct[i] : 0;
      if (!Number.isFinite(v) || v <= 0) {
        out[i] = NaN;
        continue;
      }
      const vActual = v / 3.6;
      const vTheo = vActual / cfg.SPEED_CORRECTION_FACTOR;
      const theta = Math.atan(g / 100);
      const fGravity = mass * cfg.G * Math.sin(theta);
      const fRoll = mass * cfg.G * cfg.CRR * Math.cos(theta);
      const fAero = 0.5 * cfg.AIR_DENSITY * cfg.CDA * vTheo ** 2;
      let power = (fGravity + fRoll + fAero) * vTheo / cfg.DRIVETRAIN_EFFICIENCY;
      if (!Number.isFinite(power) || power < 0) power = Number.isFinite(power) ? 0 : NaN;
      out[i] = power;
    }
    return out;
  }
  function estimatePower(speedKmh, gradePct, cfg, massKg) {
    if (!Number.isFinite(speedKmh) || speedKmh <= 0) return NaN;
    return estimatePowerArray(
      Float64Array.of(speedKmh),
      Float64Array.of(gradePct || 0),
      cfg,
      massKg
    )[0];
  }
  function rollingMeanCentered(arr, window2) {
    const n = arr.length;
    const out = new Float64Array(n);
    const half = Math.floor(window2 / 2);
    const prefix = new Float64Array(n + 1);
    const validPrefix = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const v = Number.isFinite(arr[i]) ? arr[i] : 0;
      prefix[i + 1] = prefix[i] + v;
      validPrefix[i + 1] = validPrefix[i] + (Number.isFinite(arr[i]) ? 1 : 0);
    }
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half);
      const hi = Math.min(n - 1, i + half + (window2 % 2 === 0 ? -1 : 0));
      const sum = prefix[hi + 1] - prefix[lo];
      const cnt = validPrefix[hi + 1] - validPrefix[lo];
      out[i] = cnt > 0 ? sum / cnt : NaN;
    }
    return out;
  }
  function addSmoothedAltitudeAndGrade(df, cfg) {
    const n = df.n;
    const altSmooth = rollingMeanCentered(df.altitude, cfg.ALTITUDE_SMOOTHING_WINDOW);
    const dist = df.distance;
    const gradeRaw = new Float64Array(n).fill(NaN);
    const windowM = cfg.GRADE_WINDOW_M;
    if (countFinite2(dist) >= 2) {
      for (let i = 0; i < n; i++) {
        const target = dist[i] - windowM;
        const j = searchSortedLeft(dist, target);
        const jj = Math.min(Math.max(j, 0), n - 1);
        const dDist = dist[i] - dist[jj];
        const dAlt = altSmooth[i] - altSmooth[jj];
        if (dDist >= 1) gradeRaw[i] = dAlt / dDist * 100;
      }
    }
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(gradeRaw[i])) gradeRaw[i] = Math.max(-35, Math.min(35, gradeRaw[i]));
    }
    const grade = rollingMeanCentered(gradeRaw, 5);
    return { ...df, alt_smooth: altSmooth, grade_pct: grade };
  }
  function searchSortedLeft(dist, target) {
    let lo = 0, hi = dist.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (dist[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function countFinite2(arr) {
    let c = 0;
    for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) c++;
    return c;
  }
  function accumulateElevation(altArr, thresholdM) {
    const values = [];
    for (let i = 0; i < altArr.length; i++) if (Number.isFinite(altArr[i])) values.push(altArr[i]);
    if (values.length < 2) return [0, 0];
    let gain = 0, loss = 0;
    let anchor = values[0];
    let direction = 0;
    for (const v of values) {
      const delta = v - anchor;
      if (direction >= 0 && delta >= thresholdM) {
        gain += delta;
        anchor = v;
        direction = 1;
      } else if (direction <= 0 && delta <= -thresholdM) {
        loss += -delta;
        anchor = v;
        direction = -1;
      } else if (direction === 1 && delta < -thresholdM) {
        anchor = v;
        direction = -1;
      } else if (direction === -1 && delta > thresholdM) {
        anchor = v;
        direction = 1;
      } else if (direction === 1 && v > anchor || direction === -1 && v < anchor) {
        if (direction === 1) gain += v - anchor;
        else loss += anchor - v;
        anchor = v;
      }
    }
    return [gain, loss];
  }
  function cumulativeElevationGainSeries(altArr, thresholdM) {
    const n = altArr.length;
    const out = new Float64Array(n);
    let gain = 0;
    let anchor = null;
    let direction = 0;
    let lastFinite = 0;
    for (let i = 0; i < n; i++) {
      const v = altArr[i];
      if (!Number.isFinite(v)) {
        out[i] = lastFinite;
        continue;
      }
      if (anchor === null) {
        anchor = v;
        out[i] = 0;
        lastFinite = 0;
        continue;
      }
      const delta = v - anchor;
      if (direction >= 0 && delta >= thresholdM) {
        gain += delta;
        anchor = v;
        direction = 1;
      } else if (direction <= 0 && delta <= -thresholdM) {
        anchor = v;
        direction = -1;
      } else if (direction === 1 && delta < -thresholdM) {
        anchor = v;
        direction = -1;
      } else if (direction === -1 && delta > thresholdM) {
        anchor = v;
        direction = 1;
      } else if (direction === 1 && v > anchor || direction === -1 && v < anchor) {
        if (direction === 1) gain += v - anchor;
        anchor = v;
      }
      out[i] = gain;
      lastFinite = gain;
    }
    return out;
  }
  function round(value, digits = 0) {
    if (value === null || value === void 0 || !Number.isFinite(value)) return null;
    const f = Math.pow(10, digits);
    return Math.round(value * f) / f;
  }
  function computeGlobalStats(df, cfg) {
    const n = df.n;
    const totalTimeS = (df.timestamp[n - 1] - df.timestamp[0]) / 1e3;
    let movingTimeS = 0;
    for (let i = 0; i < n; i++) movingTimeS += df.moving_dt_s[i];
    let distanceKm = NaN;
    if (countFinite2(df.distance) > 0) {
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(df.distance[i])) continue;
        if (df.distance[i] < mn) mn = df.distance[i];
        if (df.distance[i] > mx) mx = df.distance[i];
      }
      distanceKm = (mx - mn) / 1e3;
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
        if (df.is_moving[i]) {
          hrSum += df.heart_rate[i];
          hrCount++;
        }
      }
    }
    const avgHr = hrCount > 0 ? hrSum / hrCount : NaN;
    let cadSum = 0, cadCount = 0;
    for (let i = 0; i < n; i++) {
      if (df.is_moving[i] && Number.isFinite(df.cadence[i]) && df.cadence[i] > 0) {
        cadSum += df.cadence[i];
        cadCount++;
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
      avg_power_est_pct_ftp: Number.isFinite(avgPowerEst) ? round(avgPowerEst / cfg.CURRENT_FTP_W * 100) : null,
      aerobic_decoupling_pct: round(decoupling, 1),
      hr_zones_pct: computeHrZoneDistribution(df, cfg)
    };
  }
  function normalizedPower(df, power) {
    const n = df.n;
    const masked = new Float64Array(n).fill(NaN);
    let validCount = 0;
    for (let i = 0; i < n; i++) {
      if (df.is_moving[i] && Number.isFinite(power[i])) {
        masked[i] = power[i];
        validCount++;
      }
    }
    if (validCount < 30) return NaN;
    const rolled = [];
    let sum = 0, cnt = 0;
    const buf = [];
    for (let i = 0; i < n; i++) {
      const v = masked[i];
      buf.push(v);
      if (Number.isFinite(v)) {
        sum += v;
        cnt++;
      }
      if (buf.length > 30) {
        const old = buf.shift();
        if (Number.isFinite(old)) {
          sum -= old;
          cnt--;
        }
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
    const labels = ["Z1 r\xE9cup", "Z2 endurance", "Z3 tempo", "Z4 seuil", "Z5 VO2max"];
    const edges = [-Infinity, ...bounds, Infinity];
    const out = {};
    for (let z = 0; z < labels.length; z++) {
      let w = 0;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(df.heart_rate[i]) || df.moving_dt_s[i] <= 0) continue;
        const hr = df.heart_rate[i];
        if (hr > edges[z] && hr <= edges[z + 1]) w += df.moving_dt_s[i];
      }
      out[labels[z]] = round(w / total * 100, 1);
    }
    return out;
  }
  function computeAerobicDecoupling(df) {
    const n = df.n;
    const idx = [];
    for (let i = 0; i < n; i++) {
      if (df.is_moving[i] && Number.isFinite(df.heart_rate[i]) && df.heart_rate[i] > 0 && Number.isFinite(df.speed_kmh[i]) && df.speed_kmh[i] > 0) {
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
    return (ratio1 - ratio2) / ratio1 * 100;
  }
  function mean(arr) {
    if (!arr.length) return NaN;
    let s = 0;
    for (const v of arr) s += v;
    return s / arr.length;
  }
  function detectClimbs(df, cfg) {
    const n = df.n;
    const steep = new Uint8Array(n);
    let lastGrade = 0;
    for (let i = 0; i < n; i++) {
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
  function computeClimbMetrics(df, start, end, cfg, enforceThresholds = true) {
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
    if (durationS <= 0) durationS = (df.timestamp[end] - df.timestamp[start]) / 1e3;
    if (durationS <= 0 || distanceM <= 0) return null;
    if (enforceThresholds && (distanceM < cfg.CLIMB_MIN_DISTANCE_M || netGainM < cfg.CLIMB_MIN_ELEVATION_M)) {
      return null;
    }
    const avgGradePct = netGainM / distanceM * 100;
    const vamMh = netGainM / (durationS / 3600);
    const avgSpeedKmh = distanceM / 1e3 / (durationS / 3600);
    let hrSum = 0, hrCount = 0, maxHr = NaN;
    for (let i = start; i <= end; i++) {
      if (df.is_moving[i] && Number.isFinite(df.heart_rate[i])) {
        hrSum += df.heart_rate[i];
        hrCount++;
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
      est_power_pct_ftp: Number.isFinite(estPowerW) ? round(estPowerW / cfg.CURRENT_FTP_W * 100) : null
    };
  }
  function hrDriftMoving(df, start, end) {
    const idx = [];
    for (let i = start; i <= end; i++) {
      if (df.is_moving[i] && Number.isFinite(df.heart_rate[i])) idx.push(i);
    }
    if (idx.length < 10) return null;
    const t0 = df.timestamp[idx[0]];
    const t1 = df.timestamp[idx[idx.length - 1]];
    const totalS = (t1 - t0) / 1e3;
    if (totalS < 120) return null;
    const midT = t0 + totalS * 1e3 / 2;
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
      else if (!mask[i] && start !== null) {
        segments.push([start, i - 1]);
        start = null;
      }
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
  function analyzeRide(dfRaw, cfg) {
    const df = applyMovingFilter(dfRaw, cfg);
    const withGrade = addSmoothedAltitudeAndGrade(df, cfg);
    return {
      globalStats: computeGlobalStats(withGrade, cfg),
      climbs: detectClimbs(withGrade, cfg),
      df: withGrade
    };
  }

  // src/config.js
  var FALLBACK_DEFAULTS = {
    // --- Profil physiologique ---
    RIDER_WEIGHT_KG: 87,
    SYSTEM_WEIGHT_KG: 98.5,
    FC_MAX: 187,
    FC_REPOS: 41,
    LTHR_CYCLING: 165,
    CURRENT_FTP_W: 240,
    TARGET_FTP_W: 290,
    // --- Zones HR (Karvonen) ---
    SWEET_SPOT_HR_MIN: 152,
    SWEET_SPOT_HR_MAX: 163,
    // --- Détection des montées (hypothèses, ajustables) ---
    CLIMB_MIN_GRADE_PCT: 3,
    CLIMB_MIN_DISTANCE_M: 400,
    CLIMB_MIN_ELEVATION_M: 25,
    CLIMB_MERGE_GAP_M: 150,
    ALTITUDE_SMOOTHING_WINDOW: 13,
    GRADE_WINDOW_M: 50,
    ELEVATION_THRESHOLD_M: 1.5,
    // --- Filtrage temps mobile ---
    MOVING_MAX_GAP_S: 30,
    MOVING_MIN_SPEED_KMH: 3,
    // --- Détection du segment plat de référence (indicateur de forme) ---
    FLAT_MAX_GRADE_PCT: 1.5,
    // pente lissée tolérée, en valeur absolue (±)
    FLAT_MIN_DURATION_S: 300,
    // 5 min minimum pour qualifier
    FLAT_MAX_DURATION_S: 1200,
    // 20 min plafond : au-delà, le calcul se limite aux 20 premières minutes
    FLAT_MAX_SPEED_CV: 0.15,
    // régularité de vitesse exigée (écart-type/moyenne) — écarte les
    // portions "plates" mais hachées (feux rouges, trafic urbain)
    // --- Charge d'entraînement (CTL/ATL/TSB, méthode Coggan) ---
    CTL_TIME_CONSTANT: 42,
    // jours — "fitness" longue durée
    ATL_TIME_CONSTANT: 7,
    // jours — "fatigue" court terme
    // --- Modèle physique de puissance ---
    CRR: 5e-3,
    CDA: 0.4,
    AIR_DENSITY: 1.2,
    DRIVETRAIN_EFFICIENCY: 0.97,
    G: 9.81,
    SPEED_CORRECTION_FACTOR: 0.81
  };
  var overrides = typeof window !== "undefined" && window.FIT_ANALYZER_CONFIG || {};
  var DEFAULT_CONFIG = { ...FALLBACK_DEFAULTS, ...overrides };

  // src/trainingLoad.js
  function computeRideTSS(rideStats, cfg) {
    const np = rideStats.norm_power_est_w;
    const ftp = cfg.CURRENT_FTP_W;
    const durationH = (rideStats.moving_time_s || 0) / 3600;
    if (!Number.isFinite(np) || !Number.isFinite(ftp) || ftp <= 0 || durationH <= 0) {
      return null;
    }
    const intensityFactor = np / ftp;
    const tss = durationH * intensityFactor * intensityFactor * 100;
    const reliable = !(intensityFactor > 1.15 && durationH > 20 / 60);
    return { tss, intensityFactor: round1(intensityFactor * 100) / 100, reliable };
  }
  function computePMC(dailyTss, cfg, throughDate) {
    if (!dailyTss.length) return [];
    const ctlTc = cfg.CTL_TIME_CONSTANT || 42;
    const atlTc = cfg.ATL_TIME_CONSTANT || 7;
    const tssByDate = new Map(dailyTss.map((d) => [d.date, d.tss]));
    const sortedDates = dailyTss.map((d) => d.date).sort();
    const start = /* @__PURE__ */ new Date(sortedDates[0] + "T00:00:00");
    const end = throughDate ? new Date(throughDate) : /* @__PURE__ */ new Date();
    end.setHours(0, 0, 0, 0);
    const out = [];
    let ctl = 0, atl = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = isoDate(d);
      const tss = tssByDate.get(iso) || 0;
      const tsb = ctl - atl;
      ctl = ctl + (tss - ctl) / ctlTc;
      atl = atl + (tss - atl) / atlTc;
      out.push({ date: iso, tss, ctl: round1(ctl), atl: round1(atl), tsb: round1(tsb) });
    }
    return out;
  }
  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  // src/aggregate.js
  function aggregateByPeriod(rides, period, cfg) {
    const buckets = /* @__PURE__ */ new Map();
    for (const ride of rides) {
      if (!ride.ride_date) continue;
      const key = period === "week" ? isoWeekKey(ride.ride_date) : ride.ride_date.slice(0, 7);
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          label: period === "week" ? isoWeekLabel(key) : monthLabel(key),
          startDate: period === "week" ? isoWeekStartDate(key) : key + "-01",
          nRides: 0,
          distanceKm: 0,
          elevationM: 0,
          movingTimeS: 0,
          tss: 0,
          tssUnreliable: false
        });
      }
      const b = buckets.get(key);
      b.nRides += 1;
      b.distanceKm += ride.distance_km || 0;
      b.elevationM += ride.elevation_gain_m || 0;
      b.movingTimeS += ride.moving_time_s || 0;
      const tssResult = computeRideTSS(ride, cfg);
      if (tssResult) {
        b.tss += tssResult.tss;
        if (!tssResult.reliable) b.tssUnreliable = true;
      }
    }
    return [...buckets.values()].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((b) => ({
      ...b,
      distanceKm: round12(b.distanceKm),
      elevationM: Math.round(b.elevationM),
      tss: Math.round(b.tss)
    }));
  }
  function isoWeekKey(dateStr) {
    const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
    const dayNr = (d.getDay() + 6) % 7;
    const thursday = new Date(d);
    thursday.setDate(d.getDate() - dayNr + 3);
    const isoYear = thursday.getFullYear();
    const jan4 = new Date(isoYear, 0, 4);
    const jan4DayNr = (jan4.getDay() + 6) % 7;
    const week1Thursday = new Date(jan4);
    week1Thursday.setDate(jan4.getDate() - jan4DayNr + 3);
    const week = 1 + Math.round((thursday - week1Thursday) / (7 * 864e5));
    return `${isoYear}-W${String(week).padStart(2, "0")}`;
  }
  function isoWeekStartDate(key) {
    const [yearStr, weekStr] = key.split("-W");
    const year = parseInt(yearStr, 10), week = parseInt(weekStr, 10);
    const jan4 = new Date(year, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7;
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - jan4Day);
    const start = new Date(week1Monday);
    start.setDate(week1Monday.getDate() + (week - 1) * 7);
    return isoDate2(start);
  }
  function isoWeekLabel(key) {
    const start = /* @__PURE__ */ new Date(isoWeekStartDate(key) + "T00:00:00");
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")} \u2013 ${String(end.getDate()).padStart(2, "0")}/${String(end.getMonth() + 1).padStart(2, "0")}`;
  }
  function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    const names = [
      "janv.",
      "f\xE9vr.",
      "mars",
      "avr.",
      "mai",
      "juin",
      "juil.",
      "ao\xFBt",
      "sept.",
      "oct.",
      "nov.",
      "d\xE9c."
    ];
    return `${names[month - 1]} ${year}`;
  }
  function isoDate2(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function round12(v) {
    return Math.round(v * 10) / 10;
  }

  // src/geo.js
  var EARTH_RADIUS_M2 = 6371e3;
  function haversineDistanceM(lat1, lon1, lat2, lon2) {
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dphi = phi2 - phi1;
    const dlam = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
    return 2 * EARTH_RADIUS_M2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
  }

  // src/climbSegments.js
  var START_MATCH_RADIUS_M = 300;
  var DISTANCE_TOLERANCE = 0.3;
  var ELEVATION_TOLERANCE = 0.35;
  function buildClimbSegments(climbs) {
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
    const out = segments.filter((seg) => seg.occurrences.length >= 2).map((seg, i) => summarizeSegment(seg, i));
    return { segments: out, skippedNoGps };
  }
  function climbToPoint(c) {
    return { start_lat: c.start_lat, start_lon: c.start_lon, distance_m: c.distance_m, elevation_gain_m: c.elevation_gain_m };
  }
  function computeCentroidPoint(occurrences) {
    return {
      start_lat: mean2(occurrences.map((c) => c.start_lat)),
      start_lon: mean2(occurrences.map((c) => c.start_lon)),
      distance_m: mean2(occurrences.map((c) => c.distance_m)),
      elevation_gain_m: mean2(occurrences.map((c) => c.elevation_gain_m))
    };
  }
  function isSameClimb(a, b) {
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
  function applyStoredNames(segments, storedNames) {
    return segments.map((seg) => {
      const segAnchor = {
        start_lat: seg.anchor_lat,
        start_lon: seg.anchor_lon,
        distance_m: seg.avg_distance_m,
        elevation_gain_m: seg.avg_elevation_m
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
    const avgDistanceM = mean2(occ.map((c) => c.distance_m));
    const avgGradePct = mean2(occ.map((c) => c.avg_grade_pct));
    const avgElevationM = mean2(occ.map((c) => c.elevation_gain_m));
    const vams = occ.map((c) => c.vam_mh).filter(Number.isFinite);
    const first = occ[0], last = occ[occ.length - 1];
    const vamTrend = Number.isFinite(first.vam_mh) && Number.isFinite(last.vam_mh) && occ.length >= 2 ? round13((last.vam_mh - first.vam_mh) / first.vam_mh * 100) : null;
    return {
      id: index,
      label: `${round13(avgDistanceM / 1e3)} km \xE0 ${round13(avgGradePct)} %`,
      n_occurrences: occ.length,
      avg_distance_m: Math.round(avgDistanceM),
      avg_elevation_m: Math.round(avgElevationM),
      avg_grade_pct: round13(avgGradePct),
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
        duration_s: c.duration_s
      }))
    };
  }
  function mean2(arr) {
    const valid = arr.filter(Number.isFinite);
    if (!valid.length) return NaN;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }
  function round13(v) {
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  }

  // src/flatSegment.js
  function detectFlatSegment(df, cfg) {
    const n = df.n;
    const isFlat = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const g = df.grade_pct[i];
      isFlat[i] = df.is_moving[i] && Number.isFinite(g) && Math.abs(g) <= cfg.FLAT_MAX_GRADE_PCT ? 1 : 0;
    }
    const segments = contiguousSegments2(isFlat);
    const candidates = segments.map(([s, e]) => {
      let durS = 0;
      for (let i = s; i <= e; i++) durS += df.moving_dt_s[i];
      return { start: s, end: e, durationS: durS };
    }).filter((c) => c.durationS >= cfg.FLAT_MIN_DURATION_S).map((c) => {
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
  function speedCoefficientOfVariation(df, start, end) {
    const speeds = [];
    for (let i = start; i <= end; i++) {
      if (Number.isFinite(df.speed_kmh[i])) speeds.push(df.speed_kmh[i]);
    }
    if (speeds.length < 10) return null;
    const mean3 = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    if (mean3 <= 0) return null;
    const variance = speeds.reduce((a, v) => a + (v - mean3) ** 2, 0) / speeds.length;
    return Math.sqrt(variance) / mean3;
  }
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
    const startKm = (df.distance[start] - df.distance[0]) / 1e3;
    let hrSum = 0, hrCount = 0;
    for (let i = start; i <= cappedEnd; i++) {
      if (Number.isFinite(df.heart_rate[i])) {
        hrSum += df.heart_rate[i];
        hrCount++;
      }
    }
    const avgHr = hrCount > 0 ? hrSum / hrCount : NaN;
    const avgSpeedKmh = durS > 0 ? distanceM / 1e3 / (durS / 3600) : NaN;
    const cumulGain = cumulativeElevationGainSeries(df.alt_smooth, cfg.ELEVATION_THRESHOLD_M);
    const elevationGainBeforeM = cumulGain[start];
    const truncated = cappedEnd < end;
    return {
      start_idx: start,
      end_idx: cappedEnd,
      start_time: new Date(df.timestamp[start]).toISOString(),
      end_time: new Date(df.timestamp[cappedEnd]).toISOString(),
      duration_s: round2(durS),
      distance_m: round2(distanceM),
      avg_speed_kmh: round2(avgSpeedKmh, 1),
      avg_hr: round2(avgHr),
      start_km: round2(startKm, 1),
      elevation_gain_before_m: round2(elevationGainBeforeM),
      truncated
    };
  }
  function contiguousSegments2(mask) {
    const segments = [];
    let start = null;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && start === null) start = i;
      else if (!mask[i] && start !== null) {
        segments.push([start, i - 1]);
        start = null;
      }
    }
    if (start !== null) segments.push([start, mask.length - 1]);
    return segments;
  }
  function round2(v, digits = 0) {
    if (!Number.isFinite(v)) return null;
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  // src/localApi.js
  var PROGRESSION_METRICS = {
    avg_power_est_w: "Puissance estim\xE9e moyenne (W)",
    norm_power_est_w: "Puissance normalis\xE9e estim\xE9e (W)",
    avg_hr: "FC moyenne (bpm)",
    avg_speed_kmh: "Vitesse moyenne (km/h)",
    distance_km: "Distance (km)",
    elevation_gain_m: "D\xE9nivel\xE9 positif (m)",
    aerobic_decoupling_pct: "D\xE9couplage a\xE9robie (%)"
  };
  var COMPARE_METRICS = {
    heart_rate: "FC (bpm)",
    speed_kmh: "Vitesse (km/h)",
    alt_smooth: "Altitude (m)",
    grade_pct: "Pente (%)"
  };
  var _analysisCache = /* @__PURE__ */ new Map();
  var MAX_CACHE_ENTRIES = 3;
  async function getAnalysis(rideId) {
    if (_analysisCache.has(rideId)) return _analysisCache.get(rideId);
    const blob = await getRideFitBlob(rideId);
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
  var _cfgCache = null;
  async function getCfg() {
    if (!_cfgCache) _cfgCache = await getConfig(DEFAULT_CONFIG);
    return _cfgCache;
  }
  async function import_files(fileList) {
    const cfg = await getCfg();
    const results = [];
    for (const file of fileList) {
      const filename = file.name;
      try {
        const dfRaw = await parseFitFile(file, filename);
        const { globalStats, climbs, df } = analyzeRide(dfRaw, cfg);
        const flatSegment = detectFlatSegment(df, cfg);
        const rideDate = new Date(dfRaw.timestamp[0]).toISOString().slice(0, 10);
        const dup = await rideExists(filename, rideDate, globalStats.distance_km);
        if (dup) {
          results.push({ filename, status: "skipped", reason: "d\xE9j\xE0 import\xE9" });
          continue;
        }
        const id = await insertRide({
          filename,
          rideDate,
          importedAt: (/* @__PURE__ */ new Date()).toISOString(),
          stats: globalStats,
          climbs,
          flatSegment,
          fitBlob: file
        });
        results.push({ filename, status: "ok", ride_id: id, ride_date: rideDate, n_climbs: climbs.length });
      } catch (e) {
        console.error(e);
        const reason = e instanceof ParseError ? e.message : e.message || String(e);
        results.push({ filename, status: "error", reason });
      }
    }
    return results;
  }
  async function list_rides() {
    return listRides();
  }
  async function delete_ride(id) {
    invalidateCache(id);
    await deleteRide(id);
    return { status: "ok" };
  }
  async function get_ride_detail(id) {
    const ride = await getRide(id);
    if (!ride) return null;
    return { ...ride, charts: {} };
  }
  async function get_ride_series(id, maxPoints = 1600) {
    const ride = await getRide(id);
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
      return Number.isFinite(v) ? round3(v, digits) : null;
    });
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
      dist_km: idx.map((i) => round3((df.distance[i] - baseDist) / 1e3, 4)),
      alt: series(df.alt_smooth, 1),
      hr: series(df.heart_rate, 0),
      speed: series(df.speed_kmh, 1),
      grade: series(df.grade_pct, 1),
      lat: series(df.lat, 5),
      lon: series(df.lon, 5),
      elapsed_s: idx.map((i) => Math.round((df.timestamp[i] - baseT) / 1e3)),
      climbs: climbsOut
    };
  }
  function indexForTime(df, isoTime) {
    if (!isoTime) return null;
    const target = new Date(isoTime).getTime();
    if (!Number.isFinite(target)) return null;
    const ts = df.timestamp;
    let lo = 0, hi = ts.length - 1;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (ts[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(ts[lo - 1] - target) < Math.abs(ts[lo] - target)) lo -= 1;
    return lo;
  }
  async function preview_climb(rideId, startIdx, endIdx) {
    const cfg = await getCfg();
    let analysis;
    try {
      analysis = await getAnalysis(rideId);
    } catch (e) {
      return { error: e.message };
    }
    const metrics = computeClimbMetrics(analysis.df, startIdx, endIdx, cfg, false);
    if (!metrics) return { error: "Segment trop court pour \xEAtre analys\xE9." };
    return { metrics };
  }
  async function save_climb_bounds(rideId, climbIndex, startIdx, endIdx) {
    const ride = await getRide(rideId);
    if (!ride) return { error: "Sortie introuvable." };
    if (climbIndex < 0 || climbIndex >= (ride.climbs || []).length) {
      return { error: "Mont\xE9e introuvable." };
    }
    const cfg = await getCfg();
    let analysis;
    try {
      analysis = await getAnalysis(rideId);
    } catch (e) {
      return { error: e.message };
    }
    const metrics = computeClimbMetrics(analysis.df, startIdx, endIdx, cfg, false);
    if (!metrics) return { error: "Segment trop court pour \xEAtre analys\xE9." };
    metrics.user_adjusted = true;
    const climbs = [...ride.climbs];
    climbs[climbIndex] = metrics;
    await updateRideClimbs(rideId, climbs);
    return { metrics };
  }
  async function reset_climbs(rideId) {
    const ride = await getRide(rideId);
    if (!ride) return { error: "Sortie introuvable." };
    let analysis;
    try {
      analysis = await getAnalysis(rideId);
    } catch (e) {
      return { error: e.message };
    }
    await updateRideClimbs(rideId, analysis.climbs);
    return { n_climbs: analysis.climbs.length };
  }
  async function get_progression_metrics() {
    return PROGRESSION_METRICS;
  }
  async function get_compare_metrics() {
    return COMPARE_METRICS;
  }
  async function get_progression(metric2) {
    if (!(metric2 in PROGRESSION_METRICS)) return { error: "M\xE9trique inconnue." };
    const rides = (await listRides()).filter((r) => r[metric2] !== null && r[metric2] !== void 0 && r.ride_date);
    rides.sort((a, b) => a.ride_date.localeCompare(b.ride_date));
    const table = rides.map((r) => ({ date: r.ride_date, filename: r.filename, value: r[metric2] }));
    return { table };
  }
  async function get_climb_progression() {
    const climbs = await allClimbsWithRideDate();
    return { climbs };
  }
  async function compare_rides(rideIds, metric2 = "heart_rate") {
    if (!(metric2 in COMPARE_METRICS)) return { error: "M\xE9trique inconnue." };
    if (!rideIds || rideIds.length < 2) return { error: "S\xE9lectionne au moins 2 sorties." };
    const seriesList = [];
    const missing = [];
    for (const rid of rideIds.slice(0, 5)) {
      const ride = await getRide(rid);
      if (!ride) continue;
      if (!ride.hasFitBlob) {
        missing.push(ride.filename);
        continue;
      }
      let analysis;
      try {
        analysis = await getAnalysis(rid);
      } catch (e) {
        missing.push(ride.filename);
        continue;
      }
      const df = analysis.df;
      const col = metric2 === "heart_rate" ? df.heart_rate : metric2 === "speed_kmh" ? df.speed_kmh : metric2 === "alt_smooth" ? df.alt_smooth : df.grade_pct;
      const x = new Array(df.n), y = new Array(df.n);
      let lastY = NaN;
      for (let i = 0; i < df.n; i++) {
        x[i] = (df.distance[i] - df.distance[0]) / 1e3;
        const v = col[i];
        if (Number.isFinite(v)) lastY = v;
        y[i] = lastY;
      }
      seriesList.push({ label: `${ride.ride_date} \u2014 ${ride.filename}`, x, y });
    }
    if (seriesList.length < 2) {
      const detail = missing.length ? ` Fichiers manquants : ${missing.join(", ")}.` : "";
      return { error: "Pas assez de sorties exploitables pour comparer." + detail };
    }
    return { seriesList, metricLabel: COMPARE_METRICS[metric2], warning: missing.length ? `Fichiers introuvables : ${missing.join(", ")}` : null };
  }
  async function get_profile() {
    const cfg = await getCfg();
    return {
      weight_kg: cfg.RIDER_WEIGHT_KG,
      system_weight_kg: cfg.SYSTEM_WEIGHT_KG,
      fc_max: cfg.FC_MAX,
      fc_repos: cfg.FC_REPOS,
      lthr: cfg.LTHR_CYCLING,
      current_ftp_w: cfg.CURRENT_FTP_W,
      target_ftp_w: cfg.TARGET_FTP_W,
      flat_max_grade_pct: cfg.FLAT_MAX_GRADE_PCT
    };
  }
  async function save_profile(partialCfg) {
    const cfg = await getCfg();
    const merged = { ...cfg, ...partialCfg };
    await saveConfig(merged);
    _cfgCache = merged;
    _analysisCache.clear();
    return { status: "ok" };
  }
  async function get_training_load() {
    const cfg = await getCfg();
    const rides = await listRides();
    const byDate = /* @__PURE__ */ new Map();
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
  async function get_dashboard(period = "week") {
    if (period !== "week" && period !== "month") return { error: "P\xE9riode inconnue." };
    const cfg = await getCfg();
    const rides = await listRides();
    if (!rides.length) return { buckets: [] };
    const buckets = aggregateByPeriod(rides, period, cfg);
    return { buckets: buckets.slice(-12) };
  }
  async function get_climb_segments() {
    const climbs = await allClimbsWithRideDate();
    if (!climbs.length) return { segments: [], skippedNoGps: 0 };
    const result = buildClimbSegments(climbs);
    const storedNames = await listClimbNames();
    result.segments = applyStoredNames(result.segments, storedNames);
    result.segments.sort((a, b) => b.n_occurrences - a.n_occurrences);
    return result;
  }
  async function rename_climb_segment(anchor, name, existingNameId) {
    if (!anchor || !Number.isFinite(anchor.anchor_lat) || !Number.isFinite(anchor.anchor_lon)) {
      return { error: "Point de r\xE9f\xE9rence de la mont\xE9e manquant." };
    }
    const trimmed = (name || "").trim();
    if (!trimmed) {
      if (existingNameId) await deleteClimbName(existingNameId);
      return { status: "ok", cleared: true };
    }
    const id = await upsertClimbName(existingNameId || null, {
      anchor_lat: anchor.anchor_lat,
      anchor_lon: anchor.anchor_lon,
      anchor_distance_m: anchor.avg_distance_m,
      anchor_elevation_m: anchor.avg_elevation_m,
      name: trimmed
    });
    return { status: "ok", name_id: id };
  }
  async function get_flat_segments() {
    return { segments: await allFlatSegmentsWithRideDate() };
  }
  async function list_goals() {
    const goals = await listGoals();
    const rides = await listRides();
    const longestRideKm = rides.length ? Math.max(...rides.map((r) => r.distance_km || 0)) : 0;
    const biggestElevationM = rides.length ? Math.max(...rides.map((r) => r.elevation_gain_m || 0)) : 0;
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    return goals.map((g) => {
      const eventDate = /* @__PURE__ */ new Date(g.event_date + "T00:00:00");
      const daysRemaining = Math.round((eventDate - today) / 864e5);
      return {
        id: g.id,
        name: g.name,
        event_date: g.event_date,
        target_distance_km: g.target_distance_km ?? null,
        target_elevation_m: g.target_elevation_m ?? null,
        days_remaining: daysRemaining,
        longest_ride_km: round3(longestRideKm, 1),
        biggest_elevation_m: Math.round(biggestElevationM)
      };
    });
  }
  async function add_goal(goal) {
    if (!goal.name || !goal.event_date) return { error: "Nom et date de l'\xE9v\xE9nement requis." };
    const id = await addGoal({
      name: goal.name,
      event_date: goal.event_date,
      target_distance_km: goal.target_distance_km ?? null,
      target_elevation_m: goal.target_elevation_m ?? null
    });
    return { id };
  }
  async function delete_goal(id) {
    await deleteGoal(id);
    return { status: "ok" };
  }
  function round3(v, digits = 0) {
    if (!Number.isFinite(v)) return null;
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  // src/profile.js
  var NS = "http://www.w3.org/2000/svg";
  var _profileInstanceCounter = 0;
  function el(name, attrs = {}) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== void 0) node.setAttribute(k, String(v));
    }
    return node;
  }
  function nearestIndex(dist, target, lo, hi) {
    let a = lo, b = hi;
    while (b - a > 1) {
      const m = a + b >> 1;
      if (dist[m] < target) a = m;
      else b = m;
    }
    return Math.abs(dist[a] - target) <= Math.abs(dist[b] - target) ? a : b;
  }
  function niceStep(span, targetTicks) {
    const raw = span / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    return mult * mag;
  }
  var ElevationProfile = class {
    /**
     * @param {HTMLElement} host      conteneur
     * @param {Object} data           { dist_km, alt, hr, idx }
     * @param {Object} opts           { editable, window:[i0,i1], bounds:[s,e],
     *                                  climbs, onInput, onCommit }
     */
    constructor(host, data, opts = {}) {
      this.host = host;
      this.data = data;
      this.opts = opts;
      this.editable = !!opts.editable;
      this.uid = `ep${++_profileInstanceCounter}`;
      const n = data.dist_km.length;
      this.i0 = opts.window ? Math.max(0, opts.window[0]) : 0;
      this.i1 = opts.window ? Math.min(n - 1, opts.window[1]) : n - 1;
      if (this.editable) {
        this.s = opts.bounds ? opts.bounds[0] : this.i0;
        this.e = opts.bounds ? opts.bounds[1] : this.i1;
      }
      this.pad = { t: 14, r: 12, b: 26, l: 46 };
      this.height = opts.height || 210;
      this._onResize = () => this.render();
      window.addEventListener("resize", this._onResize);
      this.render();
    }
    destroy() {
      window.removeEventListener("resize", this._onResize);
      this.host.innerHTML = "";
    }
    setWindow(i0, i1) {
      const n = this.data.dist_km.length;
      this.i0 = Math.max(0, i0);
      this.i1 = Math.min(n - 1, i1);
      if (this.editable) {
        this.s = Math.max(this.i0, Math.min(this.s, this.i1));
        this.e = Math.max(this.i0, Math.min(this.e, this.i1));
      }
      this.render();
    }
    getBounds() {
      return [this.s, this.e];
    }
    getRealBounds() {
      return [this.data.idx[this.s], this.data.idx[this.e]];
    }
    /* ------------------------------------------------------------ Echelles */
    _scales(width) {
      const { dist_km, alt } = this.data;
      const x0 = dist_km[this.i0];
      const x1 = dist_km[this.i1];
      const plotW = Math.max(10, width - this.pad.l - this.pad.r);
      const plotH = Math.max(10, this.height - this.pad.t - this.pad.b);
      let lo = Infinity, hi = -Infinity;
      for (let i = this.i0; i <= this.i1; i++) {
        const a = alt[i];
        if (a === null) continue;
        if (a < lo) lo = a;
        if (a > hi) hi = a;
      }
      if (!isFinite(lo)) {
        lo = 0;
        hi = 1;
      }
      if (hi - lo < 10) {
        const c = (hi + lo) / 2;
        lo = c - 5;
        hi = c + 5;
      }
      const margin = (hi - lo) * 0.12;
      lo -= margin;
      hi += margin;
      const spanX = x1 - x0 || 1;
      return {
        plotW,
        plotH,
        x0,
        x1,
        lo,
        hi,
        X: (km) => this.pad.l + (km - x0) / spanX * plotW,
        Y: (a) => this.pad.t + (1 - (a - lo) / (hi - lo)) * plotH,
        invX: (px) => x0 + (px - this.pad.l) / plotW * spanX
      };
    }
    /* -------------------------------------------------------------- Rendu */
    render() {
      const width = Math.max(320, this.host.clientWidth || 640);
      const { dist_km, alt, hr, idx } = this.data;
      const sc = this._scales(width);
      this.sc = sc;
      this.width = width;
      this.host.innerHTML = "";
      const svg = el("svg", {
        class: "profile-svg",
        viewBox: `0 0 ${width} ${this.height}`,
        width: "100%",
        height: this.height,
        role: "img",
        "aria-label": "Profil altim\xE9trique"
      });
      const defs = el("defs");
      const pat = el("pattern", {
        id: `hatch-${this.uid}`,
        width: 6,
        height: 6,
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(45)"
      });
      pat.appendChild(el("rect", { width: 6, height: 6, fill: "#dedfd7" }));
      pat.appendChild(el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#c3bba6", "stroke-width": 1.1 }));
      defs.appendChild(pat);
      const clip = el("clipPath", { id: `plotclip-${this.uid}` });
      clip.appendChild(el("rect", {
        x: this.pad.l,
        y: this.pad.t,
        width: sc.plotW,
        height: sc.plotH
      }));
      defs.appendChild(clip);
      svg.appendChild(defs);
      const targetTicksY = Math.max(2, Math.round(sc.plotH / 55));
      const stepY = niceStep(sc.hi - sc.lo, targetTicksY);
      for (let a = Math.ceil(sc.lo / stepY) * stepY; a <= sc.hi; a += stepY) {
        const y = sc.Y(a);
        svg.appendChild(el("line", {
          class: "axis-line",
          x1: this.pad.l,
          y1: y,
          x2: width - this.pad.r,
          y2: y,
          opacity: 0.45
        }));
        const t = el("text", { class: "axis-txt", x: this.pad.l - 7, y: y + 3, "text-anchor": "end" });
        t.textContent = Math.round(a);
        svg.appendChild(t);
      }
      const baseY = this.pad.t + sc.plotH;
      const runs = [];
      let cur = null;
      for (let i = this.i0; i <= this.i1; i++) {
        if (alt[i] === null) {
          cur = null;
          continue;
        }
        if (!cur) {
          cur = [];
          runs.push(cur);
        }
        cur.push(i);
      }
      for (const run of runs) {
        if (run.length < 2) continue;
        let d = "";
        for (const i of run) {
          d += `${d ? "L" : "M"}${sc.X(dist_km[i]).toFixed(1)} ${sc.Y(alt[i]).toFixed(1)}`;
        }
        const xFirst = sc.X(dist_km[run[0]]).toFixed(1);
        const xLast = sc.X(dist_km[run[run.length - 1]]).toFixed(1);
        const area = `${d}L${xLast} ${baseY}L${xFirst} ${baseY}Z`;
        svg.appendChild(el("path", { d: area, fill: `url(#hatch-${this.uid})`, "clip-path": `url(#plotclip-${this.uid})` }));
        svg.appendChild(el("path", { class: "ridge", d, "clip-path": `url(#plotclip-${this.uid})` }));
      }
      if (this.opts.climbs && !this.editable) {
        for (const c of this.opts.climbs) {
          const a = this._displayIndexOf(c.start_idx);
          const b = this._displayIndexOf(c.end_idx);
          if (b < this.i0 || a > this.i1) continue;
          const xa = sc.X(dist_km[Math.max(a, this.i0)]);
          const xb = sc.X(dist_km[Math.min(b, this.i1)]);
          svg.appendChild(el("rect", {
            class: "climb-tick",
            x: xa,
            y: baseY - 4,
            width: Math.max(2, xb - xa),
            height: 4
          }));
        }
      }
      if (this.opts.showHr !== false && hr && hr.some((v) => v !== null)) {
        let loH = Infinity, hiH = -Infinity;
        for (let i = this.i0; i <= this.i1; i++) {
          const v = hr[i];
          if (v === null) continue;
          if (v < loH) loH = v;
          if (v > hiH) hiH = v;
        }
        if (isFinite(loH) && hiH > loH) {
          const pad = (hiH - loH) * 0.25;
          loH -= pad;
          hiH += pad;
          let dh = "";
          for (let i = this.i0; i <= this.i1; i++) {
            if (hr[i] === null) continue;
            const y = this.pad.t + (1 - (hr[i] - loH) / (hiH - loH)) * sc.plotH;
            dh += `${dh ? "L" : "M"}${sc.X(dist_km[i]).toFixed(1)} ${y.toFixed(1)}`;
          }
          if (dh) svg.appendChild(el("path", { class: "hr-line", d: dh, "clip-path": `url(#plotclip-${this.uid})` }));
        }
      }
      if (this.editable) {
        const xs = sc.X(dist_km[this.s]);
        const xe = sc.X(dist_km[this.e]);
        svg.appendChild(el("rect", {
          class: "sel-band",
          x: Math.min(xs, xe),
          y: this.pad.t,
          width: Math.abs(xe - xs),
          height: sc.plotH
        }));
        this._handle(svg, "s", xs, sc, "A");
        this._handle(svg, "e", xe, sc, "B");
      }
      const targetTicksX = Math.max(2, Math.round(sc.plotW / 78));
      const stepX = niceStep(sc.x1 - sc.x0, targetTicksX);
      for (let km = Math.ceil(sc.x0 / stepX) * stepX; km <= sc.x1 + 1e-9; km += stepX) {
        const x = sc.X(km);
        const t = el("text", {
          class: "axis-txt",
          x,
          y: this.height - 8,
          "text-anchor": "middle"
        });
        t.textContent = (stepX < 1 ? km.toFixed(1) : Math.round(km)) + " km";
        svg.appendChild(t);
      }
      svg.appendChild(el("line", {
        class: "axis-line",
        x1: this.pad.l,
        y1: baseY,
        x2: width - this.pad.r,
        y2: baseY
      }));
      this.svg = svg;
      this.host.appendChild(svg);
      if (this.editable) this._bindDrag();
      this._bindHover();
      if (this._pendingFocus) {
        const target = svg.querySelector(`.handle-grp[data-h="${this._pendingFocus}"]`);
        if (target) target.focus({ preventScroll: true });
        this._pendingFocus = null;
      }
    }
    _displayIndexOf(realIdx) {
      const { idx } = this.data;
      let a = 0, b = idx.length - 1;
      while (b - a > 1) {
        const m = a + b >> 1;
        if (idx[m] < realIdx) a = m;
        else b = m;
      }
      return Math.abs(idx[a] - realIdx) <= Math.abs(idx[b] - realIdx) ? a : b;
    }
    _handle(svg, which, x, sc, letter) {
      const g = el("g", {
        class: "handle-grp",
        tabindex: 0,
        role: "slider",
        "aria-label": which === "s" ? "D\xE9but de la mont\xE9e" : "Fin de la mont\xE9e",
        "aria-valuemin": 0,
        "aria-valuemax": this.data.dist_km.length - 1,
        "aria-valuenow": which === "s" ? this.s : this.e,
        "data-h": which
      });
      g.appendChild(el("line", {
        class: "handle-line",
        x1: x,
        y1: this.pad.t - 4,
        x2: x,
        y2: this.pad.t + sc.plotH
      }));
      g.appendChild(el("rect", {
        class: "handle-hit",
        x: x - 13,
        y: this.pad.t - 10,
        width: 26,
        height: sc.plotH + 14
      }));
      g.appendChild(el("rect", {
        class: "handle-cap",
        x: x - 10,
        y: this.pad.t - 12,
        width: 20,
        height: 15,
        rx: 2
      }));
      const t = el("text", { class: "handle-cap-txt", x, y: this.pad.t - 1.5 });
      t.textContent = letter;
      g.appendChild(t);
      svg.appendChild(g);
    }
    _pointerToIndex(clientX) {
      const rect = this.svg.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width * this.width;
      const km = this.sc.invX(px);
      return nearestIndex(this.data.dist_km, km, this.i0, this.i1);
    }
    _bindDrag() {
      const handles = this.svg.querySelectorAll(".handle-grp");
      handles.forEach((g) => {
        const which = g.dataset.h;
        g.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          g.setPointerCapture(ev.pointerId);
          this.dragging = which;
        });
        g.addEventListener("pointermove", (ev) => {
          if (this.dragging !== which) return;
          this._moveHandle(which, this._pointerToIndex(ev.clientX));
        });
        const end = (ev) => {
          if (this.dragging !== which) return;
          this.dragging = null;
          try {
            g.releasePointerCapture(ev.pointerId);
          } catch (_) {
          }
          if (this.opts.onCommit) this.opts.onCommit(this.s, this.e);
        };
        g.addEventListener("pointerup", end);
        g.addEventListener("pointercancel", end);
        g.addEventListener("keydown", (ev) => {
          const step = ev.shiftKey ? 10 : 1;
          let delta = 0;
          if (ev.key === "ArrowLeft") delta = -step;
          else if (ev.key === "ArrowRight") delta = step;
          else return;
          ev.preventDefault();
          const cur = which === "s" ? this.s : this.e;
          this._moveHandle(which, cur + delta);
          if (this.opts.onCommit) this.opts.onCommit(this.s, this.e);
        });
      });
    }
    _moveHandle(which, target) {
      const MIN_GAP = 2;
      let v = Math.max(this.i0, Math.min(this.i1, target));
      if (which === "s") {
        this.s = Math.min(v, this.e - MIN_GAP);
        this.s = Math.max(this.i0, this.s);
      } else {
        this.e = Math.max(v, this.s + MIN_GAP);
        this.e = Math.min(this.i1, this.e);
      }
      this._pendingFocus = which;
      this.render();
      if (this.opts.onInput) this.opts.onInput(this.s, this.e);
    }
    _bindHover() {
      if (!this.opts.onHover) return;
      this.svg.addEventListener("pointermove", (ev) => {
        if (this.dragging) return;
        this.opts.onHover(this._pointerToIndex(ev.clientX));
      });
      this.svg.addEventListener("pointerleave", () => {
        if (!this.dragging) this.opts.onHover(null);
      });
    }
  };

  // src/svgUtils.js
  var NS2 = "http://www.w3.org/2000/svg";
  function el2(name, attrs = {}) {
    const node = document.createElementNS(NS2, name);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== void 0) node.setAttribute(k, String(v));
    }
    return node;
  }
  function niceStep2(span, targetTicks) {
    const raw = span / Math.max(1, targetTicks);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    return mult * mag;
  }

  // src/charts.js
  var COLOR_PRIMARY = "var(--forest)";
  var SERIES_COLORS = ["#3a5a46", "#c2452d", "#6f97ad", "#b8862f", "#7c6a9c"];
  function makeSvg(width, height) {
    const svg = el2("svg", {
      class: "mini-chart",
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height,
      role: "img"
    });
    return svg;
  }
  function emptyState(host, message) {
    host.innerHTML = "";
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = message;
    host.appendChild(p);
  }
  function renderProgressionChart(host, dates, values, { ylabel, title } = {}) {
    host.innerHTML = "";
    if (!dates.length) {
      emptyState(host, "Pas encore assez de donn\xE9es.");
      return;
    }
    const width = Math.max(320, host.clientWidth || 640);
    const height = 260;
    const pad = { t: 42, r: 18, b: 40, l: 52 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const xMin = Math.min(...dates), xMax = Math.max(...dates);
    let yMin = Math.min(...values), yMax = Math.max(...values);
    if (yMax - yMin < 1e-6) {
      yMin -= 1;
      yMax += 1;
    }
    const yPad = (yMax - yMin) * 0.15;
    yMin -= yPad;
    yMax += yPad;
    const spanX = xMax - xMin || 1;
    const X = (t) => pad.l + (t - xMin) / spanX * plotW;
    const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const svg = makeSvg(width, height);
    const stepY = niceStep2(yMax - yMin, 5);
    for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
      const y = Y(v);
      svg.appendChild(el2("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
      const t = el2("text", { class: "chart-axis-txt", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
      t.textContent = Math.round(v * 10) / 10;
      svg.appendChild(t);
    }
    const targetTicksX = Math.max(2, Math.round(plotW / 90));
    const stepXms = Math.max(864e5, niceStep2(spanX, targetTicksX));
    for (let t = xMin; t <= xMax + 1; t += stepXms) {
      const x = X(t);
      const label = el2("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
      label.textContent = formatDateShort(new Date(t));
      svg.appendChild(label);
    }
    {
      const x = X(xMax);
      const label = el2("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
      label.textContent = formatDateShort(new Date(xMax));
      svg.appendChild(label);
    }
    if (dates.length >= 3) {
      const { slope, intercept } = linearRegression(dates, values);
      const y0 = slope * xMin + intercept;
      const y1 = slope * xMax + intercept;
      svg.appendChild(el2("line", {
        class: "chart-trend",
        x1: X(xMin),
        y1: Y(y0),
        x2: X(xMax),
        y2: Y(y1)
      }));
    }
    let d = "";
    dates.forEach((t, i) => {
      d += `${d ? "L" : "M"}${X(t).toFixed(1)} ${Y(values[i]).toFixed(1)}`;
    });
    svg.appendChild(el2("path", { class: "chart-line", d }));
    dates.forEach((t, i) => {
      svg.appendChild(el2("circle", { class: "chart-dot", cx: X(t), cy: Y(values[i]), r: 4 }));
    });
    if (title) {
      const t = el2("text", { class: "chart-title", x: width / 2, y: 16, "text-anchor": "middle" });
      t.textContent = title;
      svg.appendChild(t);
    }
    if (ylabel) {
      const t = el2("text", {
        class: "chart-axis-label",
        x: pad.l,
        y: pad.t - 12,
        "text-anchor": "start"
      });
      t.textContent = ylabel;
      svg.appendChild(t);
    }
    host.appendChild(svg);
  }
  function formatDateShort(d) {
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
  }
  function linearRegression(xs, ys) {
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num2 = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num2 += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    const slope = den !== 0 ? num2 / den : 0;
    const intercept = meanY - slope * meanX;
    return { slope, intercept };
  }
  function renderHrVamChart(host, climbs) {
    host.innerHTML = "";
    const pts = climbs.filter((c) => c.avg_hr !== null && c.vam_mh !== null);
    if (!pts.length) {
      emptyState(host, "Aucune mont\xE9e exploitable.");
      return;
    }
    const width = Math.max(320, host.clientWidth || 640);
    const height = 300;
    const pad = { t: 42, r: 18, b: 40, l: 52 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const hrs = pts.map((p) => p.avg_hr);
    const vams = pts.map((p) => p.vam_mh);
    let xMin = Math.min(...hrs), xMax = Math.max(...hrs);
    let yMin = Math.min(...vams), yMax = Math.max(...vams);
    if (xMax - xMin < 1e-6) {
      xMin -= 5;
      xMax += 5;
    }
    if (yMax - yMin < 1e-6) {
      yMin -= 20;
      yMax += 20;
    }
    const xPad = (xMax - xMin) * 0.1, yPad = (yMax - yMin) * 0.12;
    xMin -= xPad;
    xMax += xPad;
    yMin -= yPad;
    yMax += yPad;
    const X = (v) => pad.l + (v - xMin) / (xMax - xMin) * plotW;
    const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const svg = makeSvg(width, height);
    const stepY = niceStep2(yMax - yMin, 5);
    for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
      const y = Y(v);
      svg.appendChild(el2("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
      const t = el2("text", { class: "chart-axis-txt", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
      t.textContent = Math.round(v);
      svg.appendChild(t);
    }
    const stepX = niceStep2(xMax - xMin, 5);
    for (let v = Math.ceil(xMin / stepX) * stepX; v <= xMax; v += stepX) {
      const x = X(v);
      const t = el2("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
      t.textContent = Math.round(v);
      svg.appendChild(t);
    }
    const dateSet = [...new Set(pts.map((p) => p.ride_date).filter(Boolean))].sort();
    const colorFor = (rideDate) => {
      if (dateSet.length <= 1) return COLOR_PRIMARY;
      const idx = dateSet.indexOf(rideDate);
      const t = idx / (dateSet.length - 1);
      const from = [154, 152, 141], to = [58, 90, 70];
      const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * t));
      return `rgb(${rgb.join(",")})`;
    };
    pts.forEach((p) => {
      const dot = el2("circle", {
        cx: X(p.avg_hr),
        cy: Y(p.vam_mh),
        r: 6,
        fill: colorFor(p.ride_date),
        class: "chart-scatter-dot"
      });
      svg.appendChild(dot);
      if (p.avg_grade_pct !== null && p.avg_grade_pct !== void 0) {
        const label = el2("text", {
          class: "chart-point-label",
          x: X(p.avg_hr) + 8,
          y: Y(p.vam_mh) - 6
        });
        label.textContent = `${p.avg_grade_pct}%`;
        svg.appendChild(label);
      }
    });
    const titleEl = el2("text", { class: "chart-title", x: width / 2, y: 16, "text-anchor": "middle" });
    titleEl.textContent = "VAM vs FC moyenne (\xE9tiquette = pente)";
    svg.appendChild(titleEl);
    const yl = el2("text", { class: "chart-axis-label", x: pad.l, y: pad.t - 12 });
    yl.textContent = "VAM (m/h)";
    svg.appendChild(yl);
    const xl = el2("text", { class: "chart-axis-label", x: width - pad.r, y: height - 4, "text-anchor": "end" });
    xl.textContent = "FC moyenne (bpm)";
    svg.appendChild(xl);
    host.appendChild(svg);
  }
  function renderPmcChart(host, pmc) {
    host.innerHTML = "";
    if (!pmc.length) {
      emptyState(host, "Pas encore de donn\xE9es de charge.");
      return;
    }
    const width = Math.max(320, host.clientWidth || 640);
    const height = 280;
    const pad = { t: 42, r: 18, b: 40, l: 42 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const dates = pmc.map((p) => (/* @__PURE__ */ new Date(p.date + "T00:00:00")).getTime());
    const xMin = Math.min(...dates), xMax = Math.max(...dates);
    const allVals = pmc.flatMap((p) => [p.ctl, p.atl, p.tsb]);
    let yMin = Math.min(...allVals, 0), yMax = Math.max(...allVals, 10);
    const yPad = (yMax - yMin) * 0.12 || 5;
    yMin -= yPad;
    yMax += yPad;
    const X = (t) => pad.l + (t - xMin) / (xMax - xMin || 1) * plotW;
    const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const svg = makeSvg(width, height);
    if (yMin < 0 && yMax > 0) {
      svg.appendChild(el2("line", {
        x1: pad.l,
        y1: Y(0),
        x2: width - pad.r,
        y2: Y(0),
        class: "chart-grid",
        "stroke-width": 1.4
      }));
    }
    const stepY = niceStep2(yMax - yMin, 5);
    for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
      const y = Y(v);
      svg.appendChild(el2("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
      const t = el2("text", { class: "chart-axis-txt", x: pad.l - 6, y: y + 4, "text-anchor": "end" });
      t.textContent = Math.round(v);
      svg.appendChild(t);
    }
    const targetTicksX = Math.max(2, Math.round(plotW / 90));
    const stepXms = Math.max(864e5, niceStep2(xMax - xMin, targetTicksX));
    for (let t = xMin; t <= xMax + 1; t += stepXms) {
      const x = X(t);
      const label = el2("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
      label.textContent = formatDateShort(new Date(t));
      svg.appendChild(label);
    }
    const series = [
      { key: "ctl", color: "#3a5a46", label: "CTL (forme)" },
      { key: "atl", color: "#c2452d", label: "ATL (fatigue)" },
      { key: "tsb", color: "#b8862f", label: "TSB (fra\xEEcheur)" }
    ];
    series.forEach((s) => {
      let d = "";
      pmc.forEach((p, i) => {
        d += `${d ? "L" : "M"}${X(dates[i]).toFixed(1)} ${Y(p[s.key]).toFixed(1)}`;
      });
      svg.appendChild(el2("path", { d, fill: "none", stroke: s.color, "stroke-width": 2 }));
    });
    let lx = pad.l;
    const legendY = 30;
    series.forEach((s) => {
      svg.appendChild(el2("rect", { x: lx, y: legendY - 8, width: 10, height: 10, fill: s.color, rx: 2 }));
      const label = el2("text", { class: "chart-legend-txt", x: lx + 15, y: legendY + 1 });
      label.textContent = s.label;
      svg.appendChild(label);
      lx += 15 + s.label.length * 6.4 + 16;
    });
    host.appendChild(svg);
  }
  function renderVolumeBarChart(host, buckets, valueKey, ylabel, title) {
    host.innerHTML = "";
    if (!buckets.length) {
      emptyState(host, "Pas encore de donn\xE9es.");
      return;
    }
    const width = Math.max(320, host.clientWidth || 640);
    const height = 260;
    const pad = { t: 42, r: 18, b: 52, l: 48 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const values = buckets.map((b) => b[valueKey] || 0);
    const yMax = Math.max(...values, 1) * 1.15;
    const Y = (v) => pad.t + (1 - v / yMax) * plotH;
    const barW = plotW / buckets.length;
    const svg = makeSvg(width, height);
    const stepY = niceStep2(yMax, 5);
    for (let v = 0; v <= yMax; v += stepY) {
      const y = Y(v);
      svg.appendChild(el2("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
      const t = el2("text", { class: "chart-axis-txt", x: pad.l - 6, y: y + 4, "text-anchor": "end" });
      t.textContent = Math.round(v);
      svg.appendChild(t);
    }
    buckets.forEach((b, i) => {
      const x = pad.l + i * barW;
      const v = b[valueKey] || 0;
      const barColor = b.tssUnreliable && valueKey === "tss" ? "#b8862f" : "var(--forest)";
      svg.appendChild(el2("rect", {
        x: x + barW * 0.14,
        y: Y(v),
        width: barW * 0.72,
        height: Math.max(0, Y(0) - Y(v)),
        fill: barColor,
        rx: 2
      }));
      const label = el2("text", {
        class: "chart-axis-txt",
        x: x + barW / 2,
        y: height - pad.b + 16,
        "text-anchor": "middle"
      });
      label.textContent = b.label.length > 10 ? b.label.split(" ")[0] : b.label;
      svg.appendChild(label);
    });
    const titleEl = el2("text", { class: "chart-title", x: width / 2, y: 18, "text-anchor": "middle" });
    titleEl.textContent = title;
    svg.appendChild(titleEl);
    const yl = el2("text", { class: "chart-axis-label", x: pad.l, y: pad.t - 14 });
    yl.textContent = ylabel;
    svg.appendChild(yl);
    host.appendChild(svg);
  }
  function renderCompareChart(host, seriesList, { ylabel, title } = {}) {
    host.innerHTML = "";
    if (!seriesList.length) {
      emptyState(host, "Rien \xE0 comparer.");
      return;
    }
    const width = Math.max(320, host.clientWidth || 640);
    const height = 320;
    const pad = { t: 44, r: 18, b: 60, l: 52 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const s of seriesList) {
      for (let i = 0; i < s.x.length; i++) {
        if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) continue;
        if (s.x[i] < xMin) xMin = s.x[i];
        if (s.x[i] > xMax) xMax = s.x[i];
        if (s.y[i] < yMin) yMin = s.y[i];
        if (s.y[i] > yMax) yMax = s.y[i];
      }
    }
    if (!Number.isFinite(xMin)) {
      emptyState(host, "Aucune donn\xE9e exploitable.");
      return;
    }
    const yPad = (yMax - yMin) * 0.1 || 1;
    yMin -= yPad;
    yMax += yPad;
    const X = (v) => pad.l + (v - xMin) / (xMax - xMin || 1) * plotW;
    const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const svg = makeSvg(width, height);
    const stepY = niceStep2(yMax - yMin, 5);
    for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
      const y = Y(v);
      svg.appendChild(el2("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
      const t = el2("text", { class: "chart-axis-txt", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
      t.textContent = Math.round(v);
      svg.appendChild(t);
    }
    const stepX = niceStep2(xMax - xMin, 6);
    for (let v = Math.ceil(xMin / stepX) * stepX; v <= xMax; v += stepX) {
      const x = X(v);
      const t = el2("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
      t.textContent = `${Math.round(v)} km`;
      svg.appendChild(t);
    }
    seriesList.forEach((s, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      let d = "";
      for (let k = 0; k < s.x.length; k++) {
        if (!Number.isFinite(s.x[k]) || !Number.isFinite(s.y[k])) continue;
        d += `${d ? "L" : "M"}${X(s.x[k]).toFixed(1)} ${Y(s.y[k]).toFixed(1)}`;
      }
      svg.appendChild(el2("path", { d, fill: "none", stroke: color, "stroke-width": 1.8, opacity: 0.9 }));
    });
    const legendY = height - pad.b + 40;
    let lx = pad.l;
    seriesList.forEach((s, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      svg.appendChild(el2("rect", { x: lx, y: legendY - 8, width: 10, height: 10, fill: color, rx: 2 }));
      const label = el2("text", { class: "chart-legend-txt", x: lx + 15, y: legendY + 1 });
      const text = s.label.length > 30 ? s.label.slice(0, 28) + "\u2026" : s.label;
      label.textContent = text;
      svg.appendChild(label);
      lx += 15 + text.length * 6.2 + 18;
    });
    if (title) {
      const t = el2("text", { class: "chart-title", x: width / 2, y: 18, "text-anchor": "middle" });
      t.textContent = title;
      svg.appendChild(t);
    }
    if (ylabel) {
      const t = el2("text", { class: "chart-axis-label", x: pad.l, y: pad.t - 14 });
      t.textContent = ylabel;
      svg.appendChild(t);
    }
    host.appendChild(svg);
  }

  // src/mapView.js
  var _leafletCssInjected = false;
  function ensureLeafletCss() {
    if (_leafletCssInjected) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/leaflet.css";
    document.head.appendChild(link);
    _leafletCssInjected = true;
  }
  function renderRouteMap(container, series, climbs = []) {
    ensureLeafletCss();
    const pts = [];
    for (let i = 0; i < series.lat.length; i++) {
      if (Number.isFinite(series.lat[i]) && Number.isFinite(series.lon[i])) {
        pts.push([series.lat[i], series.lon[i], i]);
      }
    }
    if (pts.length < 2) {
      container.innerHTML = `<p class="muted">Pas de coordonn\xE9es GPS exploitables pour cette sortie.</p>`;
      return null;
    }
    container.innerHTML = "";
    const mapDiv = document.createElement("div");
    mapDiv.className = "route-map";
    container.appendChild(mapDiv);
    const map = window.L.map(mapDiv, { scrollWheelZoom: false });
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '\xA9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      maxZoom: 18
    }).addTo(map);
    const latLngs = pts.map(([lat, lon]) => [lat, lon]);
    const route = window.L.polyline(latLngs, {
      color: "#3a5a46",
      weight: 3.5,
      opacity: 0.9,
      lineJoin: "round"
    }).addTo(map);
    for (const c of climbs) {
      const segPts = pts.filter(([, , i]) => i >= c.start_idx && i <= c.end_idx).map(([lat, lon]) => [lat, lon]);
      if (segPts.length >= 2) {
        window.L.polyline(segPts, { color: "#c2452d", weight: 4.5, opacity: 0.85 }).addTo(map);
      }
    }
    addMarker(map, latLngs[0], "A", "#3a5a46");
    addMarker(map, latLngs[latLngs.length - 1], "B", "#24231f");
    map.fitBounds(route.getBounds(), { padding: [24, 24] });
    const resize = () => map.invalidateSize();
    window.addEventListener("resize", resize);
    map._faResizeHandler = resize;
    return map;
  }
  function destroyRouteMap(map) {
    if (!map) return;
    if (map._faResizeHandler) window.removeEventListener("resize", map._faResizeHandler);
    map.remove();
  }
  function addMarker(map, latLng, label, color) {
    const icon = window.L.divIcon({
      className: "route-marker",
      html: `<span style="background:${color}">${label}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    window.L.marker(latLng, { icon }).addTo(map);
  }

  // src/pwa.js
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((err) => {
        console.warn("Service worker non enregistr\xE9 :", err);
      });
    });
  }
  function setupInstallPrompt() {
    const banner = document.getElementById("install-banner");
    const btn = document.getElementById("btn-install");
    if (!banner || !btn) return;
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (ev) => {
      ev.preventDefault();
      deferredPrompt = ev;
      if (sessionStorage.getItem("installBannerDismissed") !== "1") {
        banner.classList.add("show");
      }
    });
    btn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      banner.classList.remove("show");
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    });
    window.addEventListener("appinstalled", () => {
      banner.classList.remove("show");
      sessionStorage.setItem("installBannerDismissed", "1");
    });
  }

  // src/app.js
  function esc(s) {
    if (s === null || s === void 0) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var nf = (v, d = 0) => v === null || v === void 0 || Number.isNaN(v) ? "\u2014" : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  function num(v, unit = "", d = 0) {
    if (v === null || v === void 0 || Number.isNaN(v)) return "\u2014";
    return `${nf(v, d)}${unit ? `<small>${esc(unit)}</small>` : ""}`;
  }
  function signed(v, unit = "", d = 1) {
    if (v === null || v === void 0 || Number.isNaN(v)) return "\u2014";
    return `${v > 0 ? "+" : ""}${nf(v, d)}${unit ? `<small>${esc(unit)}</small>` : ""}`;
  }
  function dur(sec) {
    if (sec === null || sec === void 0) return "\u2014";
    const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60);
    if (h > 0) return `${h}<small>h</small>${String(m).padStart(2, "0")}`;
    if (m > 0) return `${m}<small>min</small>`;
    return `${s}<small>s</small>`;
  }
  function frDate(iso) {
    if (!iso) return "\u2014";
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y.slice(2)}`;
  }
  var metric = (k, v) => `<div class="metric"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
  var spinner = (t = "Chargement") => `<div class="loading"><span class="spin"></span>${esc(t)}</div>`;
  var notice = (m, ok = false) => `<div class="notice${ok ? " ok" : ""}">${esc(m)}</div>`;
  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
  async function call(method, ...args) {
    const r = await localApi_exports[method](...args);
    if (r && typeof r === "object" && r.error) throw new Error(r.error);
    return r;
  }
  var activeProfile = null;
  var activeMap = null;
  function showTab(name) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-content").forEach((s) => s.classList.remove("active"));
    const el3 = document.getElementById("tab-" + name);
    if (el3) el3.classList.add("active");
    window.scrollTo(0, 0);
    if (name !== "detail" && activeProfile) {
      activeProfile.destroy();
      activeProfile = null;
    }
    if (name !== "detail" && activeMap) {
      destroyRouteMap(activeMap);
      activeMap = null;
    }
    if (name === "rides") loadRides();
    if (name === "progression") loadProgression();
    if (name === "compare") loadCompare();
  }
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.getElementById("btn-back").addEventListener("click", () => showTab("rides"));
  var filePicker = document.getElementById("file-picker");
  var btnPick = document.getElementById("btn-pick");
  btnPick.addEventListener("click", () => filePicker.click());
  filePicker.addEventListener("change", async () => {
    const files = Array.from(filePicker.files || []);
    filePicker.value = "";
    if (!files.length) return;
    const out = document.getElementById("import-out");
    btnPick.disabled = true;
    out.innerHTML = spinner(`Analyse de ${files.length} fichier(s)`);
    try {
      const res = await call("import_files", files);
      const ok = res.filter((r) => r.status === "ok").length;
      out.innerHTML = `<div class="card" style="margin-top:18px">` + res.map((r) => {
        if (r.status === "ok") {
          return `<div class="import-line st-ok">${esc(r.filename)} \u2014 ${esc(r.ride_date)}, ${esc(r.n_climbs)} mont\xE9e(s)</div>`;
        }
        if (r.status === "skipped") {
          return `<div class="import-line st-skip">${esc(r.filename)} \u2014 ${esc(r.reason)}</div>`;
        }
        return `<div class="import-line st-err">${esc(r.filename)} \u2014 ${esc(r.reason)}</div>`;
      }).join("") + `</div>`;
      if (ok) {
        out.innerHTML += `<div class="btn-row" style="margin-top:16px">
        <button class="btn btn-primary" id="go-rides">Voir les ${ok} sortie(s)</button></div>`;
        document.getElementById("go-rides").addEventListener("click", () => showTab("rides"));
      }
    } catch (e) {
      out.innerHTML = notice(e.message);
    } finally {
      btnPick.disabled = false;
    }
  });
  async function loadRides() {
    const out = document.getElementById("rides-out");
    out.innerHTML = spinner();
    try {
      const rides = await call("list_rides");
      if (!rides.length) {
        out.innerHTML = `<div class="empty"><div class="big">Aucune sortie</div>
        <p>Importe tes premiers fichiers .fit pour commencer.</p></div>`;
        return;
      }
      out.innerHTML = `<div class="table-scroll"><table><thead><tr>
        <th>Date</th><th>Fichier</th><th>Dist.</th><th>D+</th><th>Temps</th>
        <th>V. moy</th><th>FC</th><th>Puiss.</th><th></th>
      </tr></thead><tbody>` + rides.map((r) => `
        <tr class="ride-row" data-id="${esc(r.id)}" tabindex="0">
          <td class="date-cell">${frDate(r.ride_date)}</td>
          <td class="fname">${esc(r.filename)}</td>
          <td class="num">${nf(r.distance_km, 1)} km</td>
          <td class="num">${nf(r.elevation_gain_m)} m</td>
          <td class="num">${dur(r.moving_time_s).replace(/<\/?small>/g, "")}</td>
          <td class="num">${nf(r.avg_speed_kmh, 1)}</td>
          <td class="num">${nf(r.avg_hr)}</td>
          <td class="num">${nf(r.avg_power_est_w)} W</td>
          <td><button class="btn-quiet" data-del="${esc(r.id)}">Supprimer</button></td>
        </tr>`).join("") + `</tbody></table></div>`;
      out.querySelectorAll(".ride-row").forEach((row) => {
        const open = (ev) => {
          if (ev.target.dataset.del) return;
          openRide(parseInt(row.dataset.id, 10));
        };
        row.addEventListener("click", open);
        row.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            open(ev);
          }
        });
      });
      out.querySelectorAll("[data-del]").forEach((b) => {
        b.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!confirm("Supprimer cette sortie ?")) return;
          await call("delete_ride", parseInt(b.dataset.del, 10));
          loadRides();
        });
      });
    } catch (e) {
      out.innerHTML = notice(e.message);
    }
  }
  var currentRide = null;
  var currentSeries = null;
  var currentSegments = [];
  async function openRide(id) {
    showTab("detail");
    const out = document.getElementById("detail-out");
    out.innerHTML = spinner();
    try {
      const [ride, series, profile] = await Promise.all([
        call("get_ride_detail", id),
        call("get_ride_series", id).catch(() => null),
        call("get_profile").catch(() => ({ flat_max_grade_pct: null }))
      ]);
      if (!ride) {
        out.innerHTML = notice("Sortie introuvable.");
        return;
      }
      currentRide = ride;
      currentSeries = series;
      const FLAT_MAX_GRADE = profile.flat_max_grade_pct;
      const s = ride.stats;
      let html = `<p class="eyebrow">${frDate(ride.ride_date)}</p>
      <h1>${esc(ride.filename)}</h1>`;
      html += `<div class="metrics">
      ${metric("Distance", num(s.distance_km, "km", 1))}
      ${metric("D\xE9nivel\xE9 +", num(s.elevation_gain_m, "m"))}
      ${metric("D\xE9nivel\xE9 \u2212", num(s.elevation_loss_m, "m"))}
      ${metric("Temps mobile", dur(s.moving_time_s))}
      ${metric("Temps total", dur(s.duration_s))}
      ${metric("Vitesse moy.", num(s.avg_speed_kmh, "km/h", 1))}
      ${metric("Vitesse max", num(s.max_speed_kmh, "km/h", 1))}
      ${metric("FC moyenne", num(s.avg_hr, "bpm"))}
      ${metric("FC max", num(s.max_hr, "bpm"))}
      ${metric("Cadence", num(s.avg_cadence, "rpm"))}
      ${metric("Puissance est.", num(s.avg_power_est_w, "W"))}
      ${metric("Puiss. normalis\xE9e", num(s.norm_power_est_w, "W"))}
      ${metric("% FTP", num(s.avg_power_est_pct_ftp, "%"))}
      ${metric("D\xE9couplage", s.aerobic_decoupling_pct === null ? "\u2014" : num(s.aerobic_decoupling_pct, "%", 1))}
    </div>`;
      if (series && series.alt) {
        html += `<h2>Profil de la sortie</h2>
        <div class="card"><div id="ride-profile" class="profile-wrap"></div>
        <div class="readout" id="ride-readout"></div></div>`;
      }
      if (series && series.lat) {
        html += `<h2>Trac\xE9</h2>
        <p class="lede">N\xE9cessite une connexion Internet (fond de carte OpenStreetMap) \u2014 le reste de l'appli continue de fonctionner hors ligne.</p>
        <div class="card"><div id="ride-map"></div></div>`;
      }
      html += `<h2>Segment plat de r\xE9f\xE9rence</h2>
      <p class="lede">
        Portion plate d'au moins 5 min rep\xE9r\xE9e automatiquement (pente \u2264 ${nf(FLAT_MAX_GRADE, 1)} %,
        plafonn\xE9e \xE0 20 min) \u2014 vitesse et FC comparables d'une sortie \xE0 l'autre \xE0 effort similaire.
      </p>`;
      if (ride.flatSegment) {
        const fs = ride.flatSegment;
        html += `<div class="metrics">
        ${metric("Vitesse moy.", num(fs.avg_speed_kmh, "km/h", 1))}
        ${metric("FC moyenne", num(fs.avg_hr, "bpm"))}
        ${metric("Dur\xE9e", dur(fs.duration_s))}
        ${metric("Longueur", num(fs.distance_m / 1e3, "km", 1))}
        ${metric("Intervient au km", num(fs.start_km, "km", 1))}
        ${metric("D+ d\xE9j\xE0 grimp\xE9", num(fs.elevation_gain_before_m, "m"))}
      </div>`;
        if (fs.truncated) {
          html += `<p class="muted" style="margin-top:8px">Ce tron\xE7on plat continuait au-del\xE0 de 20 min \u2014 le calcul s'arr\xEAte l\xE0 pour rester comparable aux autres sorties.</p>`;
        }
      } else if (ride.flatSegmentComputed) {
        html += `<div class="empty"><div class="big">Pas de plat assez long sur cette sortie</div>
        <p>Il faut au moins 5 minutes continues sous ${nf(FLAT_MAX_GRADE, 1)} % de pente.</p></div>`;
      } else {
        html += `<div class="empty"><div class="big">Pas encore analys\xE9</div>
        <p>Cette sortie a \xE9t\xE9 import\xE9e avant l'ajout de cette fonction \u2014 r\xE9importe-la pour v\xE9rifier si elle contient un segment plat.</p></div>`;
      }
      if (s.hr_zones_pct) {
        html += `<h2>Temps par zone cardiaque</h2><div class="card zones">` + Object.entries(s.hr_zones_pct).map(([z, p], i) => `
          <div class="zone">
            <span class="zone-k">${esc(z)}</span>
            <span class="zone-bar"><span class="${i === 3 ? "z4" : i === 4 ? "z5" : ""}"
              style="width:${Math.max(0, Math.min(100, p))}%"></span></span>
            <span class="zone-v">${nf(p, 1)} %</span>
          </div>`).join("") + `</div>`;
      }
      if (ride.climbs && ride.climbs.length) {
        html += `<h2>Mont\xE9es <span class="muted">(${ride.climbs.length})</span></h2>
        <p class="lede">Ouvre une mont\xE9e pour ajuster son d\xE9but et sa fin sur le profil.</p>`;
        html += ride.climbs.map((c, i) => climbCard(c, i)).join("");
        html += `<div class="btn-row" style="margin-top:16px">
        <button class="btn-quiet" id="reset-climbs">Revenir \xE0 la d\xE9tection automatique</button></div>`;
        if (ride.climbs.length > 1) {
          html += `<h2>VAM et fr\xE9quence cardiaque</h2><div class="card" id="hr-vam-chart"></div>`;
        }
      } else {
        html += `<h2>Mont\xE9es</h2>
        <div class="empty"><div class="big">Aucune mont\xE9e d\xE9tect\xE9e</div>
        <p>Seuils actuels : pente \u2265 3 %, longueur \u2265 400 m, D+ \u2265 25 m.
        R\xE9glables dans l'onglet Profil (bient\xF4t).</p></div>`;
      }
      out.innerHTML = html;
      if (series && series.alt) renderRideProfile(series, ride.climbs);
      if (series && series.lat) renderRideMap(series, ride.climbs);
      if (ride.climbs && ride.climbs.length > 1) {
        renderHrVamChart(document.getElementById("hr-vam-chart"), ride.climbs);
      }
      out.querySelectorAll(".climb-head").forEach((h) => {
        h.addEventListener("click", () => toggleClimb(parseInt(h.dataset.i, 10)));
      });
      const rc = document.getElementById("reset-climbs");
      if (rc) rc.addEventListener("click", async () => {
        if (!confirm("Recalculer les mont\xE9es automatiquement ? Tes ajustements manuels seront perdus.")) return;
        await call("reset_climbs", id);
        openRide(id);
      });
    } catch (e) {
      out.innerHTML = notice(e.message);
    }
  }
  function climbCard(c, i) {
    const drift = c.hr_drift_bpm;
    const dcls = drift === null ? "" : drift > 5 ? "drift-up" : drift < -2 ? "drift-down" : "";
    return `<div class="climb" id="climb-${i}">
    <button class="climb-head" data-i="${i}">
      <span class="climb-no">${i + 1}</span>
      <span class="climb-title">
        <span class="t">${nf(c.distance_m / 1e3, 1)} km \xE0 ${nf(c.avg_grade_pct, 1)} %</span>
        ${c.user_adjusted ? `<span class="tag">Ajust\xE9e</span>` : ""}
        <span class="s">${nf(c.elevation_gain_m)} m D+ \xB7 ${dur(c.duration_s).replace(/<\/?small>/g, "")}</span>
      </span>
      <span class="climb-vam">${nf(c.vam_mh)}<small> m/h</small></span>
      <span class="chev">\u25B8</span>
    </button>
    <div class="climb-body" id="climb-body-${i}"></div>
  </div>`;
  }
  function renderRideProfile(series, climbs) {
    const host = document.getElementById("ride-profile");
    const readout = document.getElementById("ride-readout");
    if (!host) return;
    if (activeProfile) activeProfile.destroy();
    const tickClimbs = (series.climbs || []).map((sc) => ({
      start_idx: sc.start_idx,
      end_idx: sc.end_idx
    }));
    activeProfile = new ElevationProfile(host, series, {
      editable: false,
      height: 190,
      climbs: tickClimbs,
      onHover: (i) => {
        if (i === null) {
          readout.innerHTML = "";
          return;
        }
        readout.innerHTML = `<span>km <b>${nf(series.dist_km[i], 1)}</b></span><span>alt <b>${nf(series.alt[i])} m</b></span>` + (series.hr[i] !== null ? `<span>FC <b>${nf(series.hr[i])} bpm</b></span>` : "") + (series.grade[i] !== null ? `<span>pente <b>${nf(series.grade[i], 1)} %</b></span>` : "");
      }
    });
  }
  function renderRideMap(series, climbs) {
    const host = document.getElementById("ride-map");
    if (!host) return;
    if (activeMap) {
      destroyRouteMap(activeMap);
      activeMap = null;
    }
    const tickClimbs = (series.climbs || []).map((sc) => ({
      start_idx: sc.start_idx,
      end_idx: sc.end_idx
    }));
    try {
      activeMap = renderRouteMap(host, series, tickClimbs);
    } catch (e) {
      host.innerHTML = notice("Carte indisponible : " + e.message);
    }
  }
  var climbEditors = {};
  async function toggleClimb(i) {
    const card = document.getElementById(`climb-${i}`);
    const body = document.getElementById(`climb-body-${i}`);
    const wasOpen = card.classList.contains("open");
    card.classList.toggle("open", !wasOpen);
    if (wasOpen || body.dataset.built) return;
    if (!currentSeries) {
      body.innerHTML = notice("Profil indisponible : le fichier .fit est introuvable.");
      body.dataset.built = "1";
      return;
    }
    buildClimbEditor(i, body);
    body.dataset.built = "1";
  }
  function buildClimbEditor(i, body) {
    const climb = currentRide.climbs[i];
    const series = currentSeries;
    const seriesClimb = (series.climbs || []).find((c) => c.index === i);
    const toDisp = (real) => {
      const idx = series.idx;
      let a = 0, b = idx.length - 1;
      while (b - a > 1) {
        const m = a + b >> 1;
        if (idx[m] < real) a = m;
        else b = m;
      }
      return Math.abs(idx[a] - real) <= Math.abs(idx[b] - real) ? a : b;
    };
    const s0 = toDisp(seriesClimb ? seriesClimb.start_idx : climb.start_idx);
    const e0 = toDisp(seriesClimb ? seriesClimb.end_idx : climb.end_idx);
    const span = Math.max(6, e0 - s0);
    const pad = Math.round(span * 0.45);
    const n = series.dist_km.length;
    const w0 = Math.max(0, s0 - pad);
    const w1 = Math.min(n - 1, e0 + pad);
    body.innerHTML = `
    <div class="signpost" id="sp-${i}"></div>
    <div class="profile-wrap" id="prof-${i}"></div>
    <div class="readout" id="ro-${i}"></div>
    <p class="editor-hint">
      <span>Fais glisser les bornes <b>A</b> et <b>B</b> (ou touche-les au doigt).</span>
    </p>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-primary" id="save-${i}" disabled>Enregistrer les bornes</button>
      <button class="btn btn-ghost" id="undo-${i}" disabled>Annuler</button>
      <button class="btn-quiet" id="zoom-${i}">Voir toute la sortie</button>
      <span class="muted" id="msg-${i}"></span>
    </div>`;
    const sp = document.getElementById(`sp-${i}`);
    const ro = document.getElementById(`ro-${i}`);
    const btnSave = document.getElementById(`save-${i}`);
    const btnUndo = document.getElementById(`undo-${i}`);
    const btnZoom = document.getElementById(`zoom-${i}`);
    const msg = document.getElementById(`msg-${i}`);
    const paint = (m) => {
      sp.innerHTML = `
      <div class="sp wide"><span class="sp-k">Longueur</span>
        <span class="sp-v">${nf(m.distance_m / 1e3, 2)}<small>km</small></span></div>
      <div class="sp"><span class="sp-k">D\xE9nivel\xE9</span>
        <span class="sp-v">${nf(m.elevation_gain_m)}<small>m</small></span></div>
      <div class="sp"><span class="sp-k">Pente moy.</span>
        <span class="sp-v">${nf(m.avg_grade_pct, 1)}<small>%</small></span></div>
      <div class="sp"><span class="sp-k">VAM</span>
        <span class="sp-v">${nf(m.vam_mh)}<small>m/h</small></span></div>
      <div class="sp"><span class="sp-k">FC moy.</span>
        <span class="sp-v">${m.avg_hr === null ? "\u2014" : nf(m.avg_hr)}<small>bpm</small></span></div>
      <div class="sp"><span class="sp-k">D\xE9rive FC</span>
        <span class="sp-v">${m.hr_drift_bpm === null ? "\u2014" : (m.hr_drift_bpm > 0 ? "+" : "") + nf(m.hr_drift_bpm, 1)}<small>bpm</small></span></div>
      <div class="sp"><span class="sp-k">Puiss. est.</span>
        <span class="sp-v">${m.est_power_w === null ? "\u2014" : nf(m.est_power_w)}<small>W</small></span></div>`;
    };
    paint(climb);
    const localPreview = (a, b) => {
      const dm = (series.dist_km[b] - series.dist_km[a]) * 1e3;
      const dp = (series.alt[b] ?? 0) - (series.alt[a] ?? 0);
      const g = dm > 0 ? dp / dm * 100 : 0;
      ro.innerHTML = `<span>Segment <b>${nf(dm / 1e3, 2)} km</b></span><span>D+ <b>${nf(dp)} m</b></span><span>pente <b>${nf(g, 1)} %</b></span><span class="muted">rel\xE2che pour recalculer</span>`;
    };
    const commit = debounce(async (a, b) => {
      try {
        msg.textContent = "";
        const res = await call("preview_climb", currentRide.id, series.idx[a], series.idx[b]);
        paint(res.metrics);
        ro.innerHTML = `<span class="muted">Bornes modifi\xE9es \u2014 enregistre pour conserver.</span>`;
        btnSave.disabled = false;
        btnUndo.disabled = false;
      } catch (e) {
        ro.innerHTML = `<span class="st-err">${esc(e.message)}</span>`;
        btnSave.disabled = true;
      }
    }, 120);
    const prof = new ElevationProfile(document.getElementById(`prof-${i}`), series, {
      editable: true,
      height: 230,
      window: [w0, w1],
      bounds: [s0, e0],
      onInput: localPreview,
      onCommit: commit
    });
    climbEditors[i] = prof;
    btnSave.addEventListener("click", async () => {
      const [ra, rb] = prof.getRealBounds();
      btnSave.disabled = true;
      msg.textContent = "Enregistrement\u2026";
      try {
        const res = await call("save_climb_bounds", currentRide.id, i, ra, rb);
        currentRide.climbs[i] = res.metrics;
        paint(res.metrics);
        ro.innerHTML = "";
        msg.textContent = "Bornes enregistr\xE9es.";
        btnUndo.disabled = true;
        refreshClimbHeader(i, res.metrics);
      } catch (e) {
        msg.textContent = "";
        ro.innerHTML = `<span class="st-err">${esc(e.message)}</span>`;
        btnSave.disabled = false;
      }
    });
    btnUndo.addEventListener("click", () => {
      prof.s = s0;
      prof.e = e0;
      prof.setWindow(w0, w1);
      paint(climb);
      ro.innerHTML = "";
      btnSave.disabled = true;
      btnUndo.disabled = true;
      msg.textContent = "";
    });
    let zoomed = false;
    btnZoom.addEventListener("click", () => {
      zoomed = !zoomed;
      prof.setWindow(zoomed ? 0 : w0, zoomed ? series.dist_km.length - 1 : w1);
      btnZoom.textContent = zoomed ? "Recentrer sur la mont\xE9e" : "Voir toute la sortie";
    });
  }
  function refreshClimbHeader(i, m) {
    const head = document.querySelector(`.climb-head[data-i="${i}"]`);
    if (!head) return;
    head.querySelector(".t").textContent = `${nf(m.distance_m / 1e3, 1)} km \xE0 ${nf(m.avg_grade_pct, 1)} %`;
    head.querySelector(".s").textContent = `${nf(m.elevation_gain_m)} m D+ \xB7 ${dur(m.duration_s).replace(/<\/?small>/g, "")}`;
    head.querySelector(".climb-vam").innerHTML = `${nf(m.vam_mh)}<small> m/h</small>`;
    if (!head.querySelector(".tag")) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "Ajust\xE9e";
      head.querySelector(".climb-title").insertBefore(
        tag,
        head.querySelector(".climb-title .s")
      );
    }
  }
  async function loadProgression() {
    const sel = document.getElementById("metric-select");
    if (!sel.dataset.loaded) {
      try {
        const m = await call("get_progression_metrics");
        sel.innerHTML = Object.entries(m).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
        sel.dataset.loaded = "1";
        sel.addEventListener("change", () => progChart(sel.value));
      } catch (e) {
        document.getElementById("prog-chart").innerHTML = notice(e.message);
        return;
      }
    }
    progChart(sel.value);
    climbProg();
    loadGoals();
    loadTrainingLoad();
    loadDashboard();
    loadFlatSegments();
    loadClimbSegments();
  }
  async function loadGoals() {
    const out = document.getElementById("goals-out");
    out.innerHTML = spinner();
    try {
      const goals = await call("list_goals");
      let html = "";
      if (goals.length) {
        html += goals.map((g) => {
          const overdue = g.days_remaining < 0;
          const distOk = g.target_distance_km ? g.longest_ride_km >= g.target_distance_km * 0.6 : null;
          return `<div class="goal-row" data-goal="${esc(g.id)}">
          <div class="goal-head">
            <div>
              <div class="goal-name">${esc(g.name)}</div>
              <div class="muted">${frDate(g.event_date)}</div>
            </div>
            <div class="goal-countdown ${overdue ? "past" : ""}">
              ${overdue ? "pass\xE9" : `<b>${esc(g.days_remaining)}</b><small>jours</small>`}
            </div>
          </div>
          ${g.target_distance_km || g.target_elevation_m ? `<div class="stats-grid" style="margin-top:10px">
            ${g.target_distance_km ? metric("Objectif distance", num(g.target_distance_km, " km")) : ""}
            ${g.target_elevation_m ? metric("Objectif D+", num(g.target_elevation_m, " m")) : ""}
            ${metric("Ta plus longue sortie", num(g.longest_ride_km, " km", 1))}
            ${metric("Ton plus gros D+", num(g.biggest_elevation_m, " m"))}
          </div>` : ""}
          <button class="btn-quiet" data-del-goal="${esc(g.id)}">Supprimer cet objectif</button>
        </div>`;
        }).join("");
      }
      html += `<div class="row" style="margin-top:${goals.length ? 14 : 0}px">
      <button class="btn btn-ghost" id="btn-add-goal">+ Ajouter un objectif</button>
    </div>
    <form id="goal-form" class="goal-form" style="display:none">
      <div class="row"><label for="goal-name">Nom</label>
        <input type="text" id="goal-name" placeholder="Ex : Travers\xE9e des Alpes" required></div>
      <div class="row"><label for="goal-date">Date</label>
        <input type="date" id="goal-date" required></div>
      <div class="row"><label for="goal-dist">Distance cible (km, optionnel)</label>
        <input type="number" id="goal-dist" min="0" step="1"></div>
      <div class="row"><label for="goal-elev">D+ cible (m, optionnel)</label>
        <input type="number" id="goal-elev" min="0" step="10"></div>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Enregistrer</button>
        <button type="button" class="btn-quiet" id="btn-cancel-goal">Annuler</button></div>
    </form>`;
      out.innerHTML = html;
      out.querySelectorAll("[data-del-goal]").forEach((b) => {
        b.addEventListener("click", async () => {
          if (!confirm("Supprimer cet objectif ?")) return;
          await call("delete_goal", parseInt(b.dataset.delGoal, 10));
          loadGoals();
        });
      });
      const addBtn = document.getElementById("btn-add-goal");
      const form = document.getElementById("goal-form");
      addBtn.addEventListener("click", () => {
        addBtn.style.display = "none";
        form.style.display = "flex";
      });
      document.getElementById("btn-cancel-goal").addEventListener("click", () => {
        form.style.display = "none";
        addBtn.style.display = "";
      });
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        try {
          await call("add_goal", {
            name: document.getElementById("goal-name").value.trim(),
            event_date: document.getElementById("goal-date").value,
            target_distance_km: parseFloat(document.getElementById("goal-dist").value) || null,
            target_elevation_m: parseFloat(document.getElementById("goal-elev").value) || null
          });
          loadGoals();
        } catch (e) {
          alert(e.message);
        }
      });
    } catch (e) {
      out.innerHTML = notice(e.message);
    }
  }
  async function loadTrainingLoad() {
    const summary = document.getElementById("pmc-summary");
    const chart = document.getElementById("pmc-chart");
    summary.innerHTML = "";
    chart.innerHTML = spinner();
    try {
      const data = await call("get_training_load");
      if (!data.pmc || !data.pmc.length) {
        chart.innerHTML = `<div class="empty"><div class="big">Pas encore de charge calculable</div>
        <p>Il faut au moins une sortie avec une FTP configur\xE9e dans <code>config.local.js</code>.</p></div>`;
        return;
      }
      const latest = data.latest;
      summary.innerHTML = `
      ${metric("CTL (forme)", num(latest.ctl))}
      ${metric("ATL (fatigue)", num(latest.atl))}
      ${metric("TSB (fra\xEEcheur)", signed(latest.tsb))}`;
      renderPmcChart(chart, data.pmc);
      if (data.pmc.length < 21) {
        chart.innerHTML += notice(
          `Historique encore court (${data.pmc.length} jour(s)) : CTL/ATL/TSB partent de z\xE9ro et mettent plusieurs semaines \xE0 devenir repr\xE9sentatifs. Ne tire pas de conclusion sur le TSB tant que l'historique est court.`
        );
      }
      if (data.nUnreliable > 0) {
        chart.innerHTML += notice(
          `${data.nUnreliable} sortie(s) sur ${data.nRidesWithTss} ont un TSS jug\xE9 peu fiable (intensit\xE9 moyenne implausible sur la dur\xE9e \u2014 v\xE9rifie ton FTP dans config.local.js).`
        );
      }
    } catch (e) {
      chart.innerHTML = notice(e.message);
    }
  }
  async function loadDashboard() {
    const sel = document.getElementById("dashboard-period");
    if (!sel.dataset.bound) {
      sel.addEventListener("change", () => dashboardChart(sel.value));
      sel.dataset.bound = "1";
    }
    dashboardChart(sel.value);
  }
  async function dashboardChart(period) {
    const chart = document.getElementById("dashboard-chart");
    const table = document.getElementById("dashboard-table");
    chart.innerHTML = spinner();
    table.innerHTML = "";
    try {
      const data = await call("get_dashboard", period);
      if (!data.buckets || !data.buckets.length) {
        chart.innerHTML = `<div class="empty"><div class="big">Pas encore de donn\xE9es</div></div>`;
        return;
      }
      renderVolumeBarChart(
        chart,
        data.buckets,
        "distanceKm",
        "Distance (km)",
        period === "week" ? "Distance par semaine" : "Distance par mois"
      );
      table.innerHTML = `<div class="card" style="margin-top:14px"><div class="table-scroll"><table><thead><tr>
        <th>${period === "week" ? "Semaine" : "Mois"}</th><th>Sorties</th><th>Distance</th>
        <th>D+</th><th>Temps</th><th>TSS</th>
      </tr></thead><tbody>` + data.buckets.slice().reverse().map((b) => `<tr>
        <td>${esc(b.label)}</td>
        <td class="num">${esc(b.nRides)}</td>
        <td class="num">${nf(b.distanceKm, 1)} km</td>
        <td class="num">${nf(b.elevationM)} m</td>
        <td class="num">${dur(b.movingTimeS).replace(/<\/?small>/g, "")}</td>
        <td class="num">${nf(b.tss)}${b.tssUnreliable ? " \u26A0" : ""}</td>
      </tr>`).join("") + `</tbody></table></div></div>`;
    } catch (e) {
      chart.innerHTML = notice(e.message);
    }
  }
  async function loadFlatSegments() {
    const chart = document.getElementById("flat-chart");
    const table = document.getElementById("flat-table");
    chart.innerHTML = spinner();
    table.innerHTML = "";
    try {
      const data = await call("get_flat_segments");
      const segs = data.segments || [];
      if (!segs.length) {
        chart.innerHTML = `<div class="empty"><div class="big">Pas encore de segment plat</div>
        <p>Il faut au moins une sortie avec 5 min continues de plat.</p></div>`;
        return;
      }
      if (segs.length >= 2) {
        const dates = segs.map((s) => new Date(s.ride_date).getTime());
        const speeds = segs.map((s) => s.avg_speed_kmh);
        renderProgressionChart(chart, dates, speeds, {
          ylabel: "Vitesse (km/h)",
          title: "Vitesse sur le segment plat de r\xE9f\xE9rence"
        });
      } else {
        chart.innerHTML = `<p class="muted">Une seule sortie avec segment plat pour l'instant \u2014
        le graphique appara\xEEtra \xE0 partir de la deuxi\xE8me.</p>`;
      }
      table.innerHTML = `<div class="card" style="margin-top:14px"><div class="table-scroll"><table><thead><tr>
        <th>Date</th><th>Sortie</th><th>Vitesse</th><th>FC</th><th>Dur\xE9e</th><th>Longueur</th>
        <th>Km sortie</th><th>D+ avant</th>
      </tr></thead><tbody>` + segs.slice().reverse().map((s) => `<tr>
        <td class="date-cell">${frDate(s.ride_date)}</td>
        <td class="fname">${esc(s.ride_filename)}</td>
        <td class="num"><b>${nf(s.avg_speed_kmh, 1)}</b> km/h</td>
        <td class="num">${nf(s.avg_hr)} bpm</td>
        <td class="num">${dur(s.duration_s).replace(/<\/?small>/g, "")}${s.truncated ? " \u26A0" : ""}</td>
        <td class="num">${nf(s.distance_m / 1e3, 1)} km</td>
        <td class="num">${nf(s.start_km, 1)} km</td>
        <td class="num">${nf(s.elevation_gain_before_m)} m</td>
      </tr>`).join("") + `</tbody></table></div></div>`;
    } catch (e) {
      chart.innerHTML = notice(e.message);
    }
  }
  async function loadClimbSegments() {
    const out = document.getElementById("segments-out");
    out.innerHTML = spinner();
    try {
      const data = await call("get_climb_segments");
      currentSegments = data.segments || [];
      if (!currentSegments.length) {
        out.innerHTML = `<div class="empty"><div class="big">Aucune mont\xE9e r\xE9p\xE9t\xE9e pour l'instant</div>
        <p>Regrimpe une mont\xE9e d\xE9j\xE0 vue sur une autre sortie pour voir appara\xEEtre ta progression dessus.
        ${data.skippedNoGps ? `(${data.skippedNoGps} mont\xE9e(s) sans coordonn\xE9es GPS ignor\xE9e(s) \u2014 r\xE9importe ces sorties pour les inclure.)` : ""}</p></div>`;
        return;
      }
      out.innerHTML = currentSegments.map((s, i) => `
      <div class="climb" id="segment-${i}">
        <div class="climb-head" data-seg="${i}">
          <span class="climb-no">${s.n_occurrences}\xD7</span>
          <span class="climb-title">
            <span class="t">${esc(s.name || s.label)}</span>
            <span class="s">${s.name ? `${esc(s.label)} \xB7 ` : ""}${frDate(s.first_date)} \u2192 ${frDate(s.last_date)}
              ${s.vam_trend_pct !== null ? ` \xB7 VAM ${signed(s.vam_trend_pct, " %", 1).replace(/<\/?small>/g, "")}` : ""}
              <button class="btn-rename" data-rename="${i}" title="Renommer" aria-label="Renommer cette mont\xE9e">\u270E renommer</button></span>
          </span>
          <span class="climb-vam">${nf(s.best_vam_mh)}<small> m/h max</small></span>
          <span class="chev">\u25B8</span>
        </div>
        <div class="climb-body" id="segment-body-${i}">
          <div class="table-scroll"><table><thead><tr>
            <th>Date</th><th>Sortie</th><th>VAM</th><th>FC</th><th>D\xE9rive</th><th>Puiss.</th>
          </tr></thead><tbody>${s.occurrences.slice().reverse().map((o) => `<tr>
            <td class="date-cell">${frDate(o.ride_date)}</td>
            <td class="fname">${esc(o.ride_filename)}</td>
            <td class="num"><b>${nf(o.vam_mh)}</b></td>
            <td class="num">${nf(o.avg_hr)}</td>
            <td class="num">${o.hr_drift_bpm === null ? "\u2014" : (o.hr_drift_bpm > 0 ? "+" : "") + nf(o.hr_drift_bpm, 1)}</td>
            <td class="num">${nf(o.est_power_w)} W</td>
          </tr>`).join("")}</tbody></table></div>
        </div>
      </div>`).join("");
      out.querySelectorAll("[data-seg]").forEach((h) => {
        h.setAttribute("role", "button");
        h.setAttribute("tabindex", "0");
        const toggle = () => document.getElementById(`segment-${h.dataset.seg}`).classList.toggle("open");
        h.addEventListener("click", toggle);
        h.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggle();
          }
        });
      });
      out.querySelectorAll("[data-rename]").forEach((btn) => {
        btn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const i = parseInt(btn.dataset.rename, 10);
          const seg = currentSegments[i];
          const current = seg.name || "";
          const input = prompt(
            `Nom de cette mont\xE9e (${seg.label}) :
Laisse vide pour revenir au nom automatique.`,
            current
          );
          if (input === null) return;
          try {
            await call("rename_climb_segment", {
              anchor_lat: seg.anchor_lat,
              anchor_lon: seg.anchor_lon,
              avg_distance_m: seg.avg_distance_m,
              avg_elevation_m: seg.avg_elevation_m
            }, input, seg.name_id);
            loadClimbSegments();
          } catch (e) {
            alert(e.message);
          }
        });
      });
      if (data.skippedNoGps) {
        out.innerHTML += notice(
          `${data.skippedNoGps} mont\xE9e(s) sans coordonn\xE9es GPS n'ont pas pu \xEAtre compar\xE9es (sorties import\xE9es avant l'ajout de cette fonction \u2014 r\xE9importe-les pour les inclure).`
        );
      }
    } catch (e) {
      out.innerHTML = notice(e.message);
    }
  }
  async function progChart(m) {
    const out = document.getElementById("prog-chart");
    out.innerHTML = "";
    try {
      const d = await call("get_progression", m);
      if (!d.table || d.table.length < 2) {
        out.innerHTML = `<div class="empty"><div class="big">Pas assez de donn\xE9es</div>
        <p>Il faut au moins deux sorties comportant cette m\xE9trique.</p></div>`;
        return;
      }
      const dates = d.table.map((row) => new Date(row.date).getTime());
      const values = d.table.map((row) => row.value);
      const metrics = await call("get_progression_metrics");
      renderProgressionChart(out, dates, values, { ylabel: metrics[m], title: `Progression \u2014 ${metrics[m]}` });
      const a = d.table[0].value, b = d.table[d.table.length - 1].value;
      if (typeof a === "number" && typeof b === "number" && a !== 0) {
        const pct = (b - a) / Math.abs(a) * 100;
        out.innerHTML += `<p class="muted" style="margin-top:12px">
        De la premi\xE8re \xE0 la derni\xE8re sortie : <b>${signed(Math.round(pct * 10) / 10, " %").replace(/<\/?small>/g, "")}</b>
        (${nf(a, 1)} \u2192 ${nf(b, 1)}). \xC9cart brut entre deux sorties, sans
        correction du terrain ni des conditions.</p>`;
      }
    } catch (e) {
      out.innerHTML = notice(e.message);
    }
  }
  async function climbProg() {
    const chartHost = document.getElementById("climb-chart");
    const table = document.getElementById("climb-table");
    chartHost.innerHTML = "";
    table.innerHTML = "";
    try {
      const d = await call("get_climb_progression");
      if (!d.climbs || !d.climbs.length) {
        chartHost.innerHTML = `<div class="empty"><div class="big">Aucune mont\xE9e</div>
         <p>Importe une sortie comportant du d\xE9nivel\xE9.</p></div>`;
        return;
      }
      renderHrVamChart(chartHost, d.climbs);
      table.innerHTML = `<div class="card" style="margin-top:14px"><div class="table-scroll"><table><thead><tr>
        <th>Date</th><th>Sortie</th><th>Pente</th><th>Long.</th><th>D+</th>
        <th>VAM</th><th>FC</th><th>D\xE9rive</th><th>Puiss.</th>
      </tr></thead><tbody>` + d.climbs.slice().reverse().map((c) => `<tr>
        <td class="date-cell">${frDate(c.ride_date)}</td>
        <td class="fname">${esc(c.ride_filename)}</td>
        <td class="num">${nf(c.avg_grade_pct, 1)} %</td>
        <td class="num">${nf(c.distance_m / 1e3, 1)} km</td>
        <td class="num">${nf(c.elevation_gain_m)} m</td>
        <td class="num"><b>${nf(c.vam_mh)}</b></td>
        <td class="num">${nf(c.avg_hr)}</td>
        <td class="num">${c.hr_drift_bpm === null ? "\u2014" : (c.hr_drift_bpm > 0 ? "+" : "") + nf(c.hr_drift_bpm, 1)}</td>
        <td class="num">${nf(c.est_power_w)} W</td>
      </tr>`).join("") + `</tbody></table></div></div>`;
    } catch (e) {
      chartHost.innerHTML = notice(e.message);
    }
  }
  async function loadCompare() {
    const picker = document.getElementById("compare-picker");
    const sel = document.getElementById("compare-metric");
    picker.innerHTML = spinner();
    try {
      if (!sel.dataset.loaded) {
        const m = await call("get_compare_metrics");
        sel.innerHTML = Object.entries(m).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
        sel.dataset.loaded = "1";
      }
      const rides = await call("list_rides");
      if (!rides.length) {
        picker.innerHTML = `<div class="empty"><div class="big">Aucune sortie</div></div>`;
        return;
      }
      picker.innerHTML = rides.map((r) => `
      <label class="pick"><input type="checkbox" class="cmp" value="${esc(r.id)}">
        <span><b>${frDate(r.ride_date)}</b> \xB7 ${esc(r.filename)}
        <span class="muted">${nf(r.distance_km, 1)} km \xB7 ${nf(r.elevation_gain_m)} m D+</span></span>
      </label>`).join("");
    } catch (e) {
      picker.innerHTML = notice(e.message);
    }
  }
  document.getElementById("btn-compare").addEventListener("click", async () => {
    const ids = Array.from(document.querySelectorAll(".cmp:checked")).map((c) => parseInt(c.value, 10));
    const out = document.getElementById("compare-out");
    if (ids.length < 2) {
      out.innerHTML = notice("S\xE9lectionne au moins 2 sorties.");
      return;
    }
    if (ids.length > 5) {
      out.innerHTML = notice("5 sorties au maximum : au-del\xE0 le graphique devient illisible.");
      return;
    }
    out.innerHTML = spinner("G\xE9n\xE9ration du graphique");
    try {
      const r = await call("compare_rides", ids, document.getElementById("compare-metric").value);
      out.innerHTML = "";
      renderCompareChart(out, r.seriesList, { ylabel: r.metricLabel, title: `Comparaison \u2014 ${r.metricLabel}` });
      if (r.warning) out.innerHTML += notice(r.warning);
    } catch (e) {
      out.innerHTML = notice(e.message);
    }
  });
  registerServiceWorker();
  setupInstallPrompt();
  loadRides();
})();
