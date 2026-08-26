// Persistance locale via IndexedDB — équivalent navigateur de la base SQLite
// de l'appli desktop. Un seul utilisateur, tout reste sur l'appareil, aucune
// connexion réseau. Le fichier .fit original est conservé en Blob dans le
// même enregistrement (permet de recharger le tracé complet pour l'éditeur
// de montée sans redemander le fichier à l'utilisateur).

const DB_NAME = "fit_analyzer";
const DB_VERSION = 3;   // v3 : ajout de la table "climb_names" (noms personnalisés des montées répétées)
const STORE_RIDES = "rides";
const STORE_PROFILE = "profile";
const STORE_GOALS = "goals";
const STORE_CLIMB_NAMES = "climb_names";

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Chaque "if" est gardé : une mise à niveau depuis une version
      // antérieure ne doit PAS toucher aux tables déjà peuplées — seules les
      // tables manquantes sont créées.
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

/* ------------------------------------------------------------------ */
/* Sorties                                                              */
/* ------------------------------------------------------------------ */

/**
 * Enregistre une sortie. `fitBlob` est le fichier .fit original (Blob),
 * conservé pour pouvoir rouvrir le tracé complet plus tard (édition de
 * montée, comparaison) sans redemander le fichier à l'utilisateur.
 * `flatSegment` (nullable) : voir flatSegment.js — segment plat de référence
 * de la sortie, absent si aucun tronçon plat suffisamment long n'a été trouvé.
 */
export async function insertRide({ filename, rideDate, importedAt, stats, climbs, flatSegment, fitBlob }) {
  const store = await tx(STORE_RIDES, "readwrite");
  const record = {
    filename, ride_date: rideDate, imported_at: importedAt,
    stats, climbs, flat_segment: flatSegment ?? null, fit_blob: fitBlob,
  };
  const id = await wrapRequest(store.add(record));
  return id;
}

export async function listRides() {
  const store = await tx(STORE_RIDES, "readonly");
  const all = await wrapRequest(store.getAll());
  all.sort((a, b) => (b.ride_date || "").localeCompare(a.ride_date || "") || b.id - a.id);
  return all.map((r) => ({
    id: r.id, filename: r.filename, ride_date: r.ride_date, imported_at: r.imported_at,
    ...r.stats,
  }));
}

/**
 * Remplace les champs calculés (stats/climbs/flat_segment) d'une sortie déjà
 * en base, SANS toucher au fichier .fit original ni aux métadonnées d'import
 * — c'est ce qui permet de "recalculer" une sortie avec le moteur d'analyse
 * à jour (après un correctif du modèle, un nouveau seuil...) sans avoir à la
 * supprimer et la réimporter.
 */
export async function updateRideAnalysis(id, { stats, climbs, flatSegment }) {
  const store = await tx(STORE_RIDES, "readwrite");
  const existing = await wrapRequest(store.get(id));
  if (!existing) throw new Error("Sortie introuvable.");
  await wrapRequest(store.put({
    ...existing, stats, climbs, flat_segment: flatSegment ?? null,
  }));
}

export async function getRide(id) {
  const store = await tx(STORE_RIDES, "readonly");
  const r = await wrapRequest(store.get(id));
  if (!r) return null;
  return {
    id: r.id, filename: r.filename, ride_date: r.ride_date, imported_at: r.imported_at,
    stats: r.stats, climbs: r.climbs,
    flatSegment: r.flat_segment ?? null,
    // Distingue "analysé, aucun plat assez long trouvé" (flat_segment absent
    // MAIS la clé existe, valant null) de "jamais analysé pour cette
    // fonction" (sortie importée avant son ajout, clé absente) — sans ça
    // l'interface afficherait à tort "pas de plat" sur une sortie qui n'a
    // simplement jamais été vérifiée.
    flatSegmentComputed: "flat_segment" in r,
    hasFitBlob: !!r.fit_blob,
  };
}

/**
 * Segments plats de toutes les sorties qui en ont un (pour la comparaison
 * inter-sorties). Les sorties importées avant l'ajout de cette fonction
 * n'ont pas de flat_segment stocké — simplement absentes de la liste, comme
 * pour les montées sans coordonnées GPS.
 */
export async function allFlatSegmentsWithRideDate() {
  const store = await tx(STORE_RIDES, "readonly");
  const all = await wrapRequest(store.getAll());
  return all
    .filter((r) => r.flat_segment)
    .map((r) => ({ ...r.flat_segment, ride_id: r.id, ride_date: r.ride_date, ride_filename: r.filename }))
    .sort((a, b) => (a.ride_date || "").localeCompare(b.ride_date || ""));
}

/** Récupère le Blob .fit original d'une sortie (pour re-parser côté client). */
export async function getRideFitBlob(id) {
  const store = await tx(STORE_RIDES, "readonly");
  const r = await wrapRequest(store.get(id));
  return r ? r.fit_blob : null;
}

export async function updateRideClimbs(id, climbs) {
  const store = await tx(STORE_RIDES, "readwrite");
  const r = await wrapRequest(store.get(id));
  if (!r) throw new Error("Sortie introuvable.");
  r.climbs = climbs;
  await wrapRequest(store.put(r));
}

export async function deleteRide(id) {
  const store = await tx(STORE_RIDES, "readwrite");
  await wrapRequest(store.delete(id));
}

/**
 * Détecte un doublon : nom de fichier identique, OU même date + distance à
 * moins de 50 m près (un même exercice réexporté change parfois de nom).
 */
export async function rideExists(filename, rideDate, distanceKm) {
  const store = await tx(STORE_RIDES, "readonly");
  const all = await wrapRequest(store.getAll());
  for (const r of all) {
    if (r.filename === filename) return true;
    if (rideDate && distanceKm !== undefined && r.ride_date === rideDate) {
      const existing = r.stats ? r.stats.distance_km : null;
      if (existing !== null && existing !== undefined && Math.abs(existing - distanceKm) < 0.05) {
        return true;
      }
    }
  }
  return false;
}

export async function allClimbsWithRideDate() {
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

/* ------------------------------------------------------------------ */
/* Profil / configuration éditable                                     */
/* ------------------------------------------------------------------ */

export async function getConfig(defaults) {
  const store = await tx(STORE_PROFILE, "readonly");
  const row = await wrapRequest(store.get("config"));
  return row ? { ...defaults, ...row.value } : { ...defaults };
}

export async function saveConfig(cfg) {
  const store = await tx(STORE_PROFILE, "readwrite");
  await wrapRequest(store.put({ key: "config", value: cfg }));
}

/* ------------------------------------------------------------------ */
/* Objectifs (compte à rebours)                                        */
/* ------------------------------------------------------------------ */

export async function addGoal(goal) {
  const store = await tx(STORE_GOALS, "readwrite");
  return wrapRequest(store.add(goal));
}

export async function listGoals() {
  const store = await tx(STORE_GOALS, "readonly");
  const all = await wrapRequest(store.getAll());
  return all.sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
}

export async function updateGoal(id, patch) {
  const store = await tx(STORE_GOALS, "readwrite");
  const existing = await wrapRequest(store.get(id));
  if (!existing) throw new Error("Objectif introuvable.");
  await wrapRequest(store.put({ ...existing, ...patch, id }));
}

export async function deleteGoal(id) {
  const store = await tx(STORE_GOALS, "readwrite");
  await wrapRequest(store.delete(id));
}

/* ------------------------------------------------------------------ */
/* Noms personnalisés des montées répétées                             */
/* ------------------------------------------------------------------ */

/**
 * Chaque entrée mémorise un point de référence géographique (coordonnées +
 * profil de la montée au moment du renommage) plutôt qu'un identifiant de
 * segment — les segments sont recalculés à chaque appel de
 * get_climb_segments() et leur "id" n'est qu'un index de tableau, instable
 * d'un appel à l'autre. Voir climbSegments.js -> applyStoredNames().
 */
export async function listClimbNames() {
  const store = await tx(STORE_CLIMB_NAMES, "readonly");
  return wrapRequest(store.getAll());
}

export async function upsertClimbName(existingId, entry) {
  const store = await tx(STORE_CLIMB_NAMES, "readwrite");
  if (existingId) {
    const current = await wrapRequest(store.get(existingId));
    await wrapRequest(store.put({ ...current, ...entry, id: existingId }));
    return existingId;
  }
  return wrapRequest(store.add(entry));
}

export async function deleteClimbName(id) {
  const store = await tx(STORE_CLIMB_NAMES, "readwrite");
  await wrapRequest(store.delete(id));
}

/* ------------------------------------------------------------------ */
/* Diagnostic / gestion de l'espace                                    */
/* ------------------------------------------------------------------ */

export async function estimateStorageUsage() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    return { usageBytes: usage, quotaBytes: quota };
  }
  return null;
}

export async function clearAllData() {
  const store = await tx(STORE_RIDES, "readwrite");
  await wrapRequest(store.clear());
}
