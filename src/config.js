// Profil athlète et constantes de calcul.
// Port fidèle de config.py (application desktop).
//
// Ces valeurs de base sont un FILET DE SÉCURITÉ (au cas où config.local.js
// serait absent ou mal formé) : le vrai profil à éditer se trouve dans
// /config.local.js à la racine du projet — CE fichier-ci (src/config.js)
// est compilé dans js/app.bundle.js et donc pas pratique à modifier sans
// rebuild ; config.local.js, lui, est chargé tel quel et peut s'éditer
// directement sur GitHub, sans rebuild.

const FALLBACK_DEFAULTS = {
  // --- Profil physiologique ---
  RIDER_WEIGHT_KG: 87.0,
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
  CLIMB_MIN_GRADE_PCT: 3.0,
  CLIMB_MIN_DISTANCE_M: 400,
  CLIMB_MIN_ELEVATION_M: 25,
  CLIMB_MERGE_GAP_M: 150,
  ALTITUDE_SMOOTHING_WINDOW: 13,
  GRADE_WINDOW_M: 50,
  ELEVATION_THRESHOLD_M: 1.5,

  // --- Filtrage temps mobile ---
  MOVING_MAX_GAP_S: 30,
  MOVING_MIN_SPEED_KMH: 3.0,

  // --- Détection du segment plat de référence (indicateur de forme) ---
  FLAT_MAX_GRADE_PCT: 1.5,   // pente lissée tolérée, en valeur absolue (±)
  FLAT_MIN_DURATION_S: 300,  // 5 min minimum pour qualifier
  FLAT_MAX_DURATION_S: 1200, // 20 min plafond : au-delà, le calcul se limite aux 20 premières minutes
  FLAT_MAX_SPEED_CV: 0.15,   // régularité de vitesse exigée (écart-type/moyenne) — écarte les
                             // portions "plates" mais hachées (feux rouges, trafic urbain)

  // --- Charge d'entraînement (CTL/ATL/TSB, méthode Coggan) ---
  CTL_TIME_CONSTANT: 42,   // jours — "fitness" longue durée
  ATL_TIME_CONSTANT: 7,    // jours — "fatigue" court terme

  // --- Modèle physique de puissance ---
  CRR: 0.005,
  CDA: 0.40,
  AIR_DENSITY: 1.20,
  DRIVETRAIN_EFFICIENCY: 0.97,
  G: 9.81,
  SPEED_CORRECTION_FACTOR: 0.81,
};

// window.FIT_ANALYZER_CONFIG est défini par config.local.js (chargé en
// <script> avant app.bundle.js dans index.html). S'il est absent — fichier
// supprimé par erreur, ou <script> pas encore chargé au moment de l'import —
// on retombe silencieusement sur FALLBACK_DEFAULTS plutôt que de planter.
const overrides = (typeof window !== "undefined" && window.FIT_ANALYZER_CONFIG) || {};

export const DEFAULT_CONFIG = { ...FALLBACK_DEFAULTS, ...overrides };
