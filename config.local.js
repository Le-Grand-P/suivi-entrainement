// ============================================================================
// TON PROFIL & TOUS LES RÉGLAGES DE CALCUL — modifiables directement ici.
//
// Ce fichier n'est PAS compilé dans js/app.bundle.js : édite-le directement
// sur GitHub (icône crayon ✏️ en haut à droite du fichier), valide
// ("Commit changes"), et le site se met à jour tout seul en 1-2 minutes —
// sans "npm run build", sans rien réinstaller. Recharge juste l'appli.
//
// Si tu modifies un autre fichier (dans src/), là il FAUT rebuilder :
//   npm install && npm run build
// puis repousser js/app.bundle.js. Seul CE fichier fait exception.
//
// Tu peux supprimer ou commenter n'importe quelle ligne ci-dessous : la
// valeur de secours intégrée à l'appli prendra le relais automatiquement.
// ============================================================================

window.FIT_ANALYZER_CONFIG = {

  // ------------------------------------------------------------------------
  // PROFIL PHYSIOLOGIQUE
  // ------------------------------------------------------------------------
  RIDER_WEIGHT_KG: 87.0,          // ton poids seul, kg
  SYSTEM_WEIGHT_KG: 98.5,          // poids + vélo + équipement, kg (utilisé pour la puissance estimée)
  FC_MAX: 187,                     // fréquence cardiaque max, bpm
  FC_REPOS: 41,                    // fréquence cardiaque au repos, bpm (méthode Karvonen)
  LTHR_CYCLING: 165,               // seuil FC vélo, bpm
  CURRENT_FTP_W: 240,              // FTP actuel estimé, watts (sert au calcul du % FTP)
  TARGET_FTP_W: 290,               // FTP visé, watts (affichage seulement, pas utilisé dans les calculs)

  // ------------------------------------------------------------------------
  // ZONES CARDIAQUES (méthode Karvonen)
  // ------------------------------------------------------------------------
  SWEET_SPOT_HR_MIN: 152,          // borne basse de la zone "sweet spot", bpm
  SWEET_SPOT_HR_MAX: 163,          // borne haute de la zone "sweet spot", bpm

  // ------------------------------------------------------------------------
  // DÉTECTION DES MONTÉES
  // Hypothèses de modélisation, pas des faits mesurés — ajuste si la
  // détection te semble trop stricte, trop permissive, ou fusionne à tort
  // des montées séparées par un replat.
  // ------------------------------------------------------------------------
  CLIMB_MIN_GRADE_PCT: 3.0,        // pente moyenne lissée minimale pour qualifier un tronçon de "montée", %
  CLIMB_MIN_DISTANCE_M: 400,       // distance minimale du tronçon, m
  CLIMB_MIN_ELEVATION_M: 25,       // dénivelé minimal du tronçon, m
  CLIMB_MERGE_GAP_M: 150,          // deux montées séparées de moins de X m (replat/faux plat) sont fusionnées
  ALTITUDE_SMOOTHING_WINDOW: 13,   // nb de points de la moyenne glissante sur l'altitude
  GRADE_WINDOW_M: 50,              // fenêtre de distance (m) pour calculer la pente (évite le bruit du baromètre)
  ELEVATION_THRESHOLD_M: 1.5,      // hystérésis du cumul de D+/D- : une variation doit dépasser ce seuil pour compter

  // ------------------------------------------------------------------------
  // FILTRAGE DU TEMPS MOBILE
  // ------------------------------------------------------------------------
  MOVING_MAX_GAP_S: 30,            // dt max (s) entre 2 points pour rester considéré comme "temps mobile"
  MOVING_MIN_SPEED_KMH: 3.0,       // vitesse min (km/h) pour compter comme "en mouvement"

  // ------------------------------------------------------------------------
  // CHARGE D'ENTRAÎNEMENT (CTL/ATL/TSB, méthode Coggan)
  // ------------------------------------------------------------------------
  CTL_TIME_CONSTANT: 42,           // jours — constante de temps de la "forme" longue durée (CTL)
  ATL_TIME_CONSTANT: 7,            // jours — constante de temps de la "fatigue" court terme (ATL)

  // ------------------------------------------------------------------------
  // MODÈLE PHYSIQUE DE PUISSANCE ESTIMÉE
  // Valeurs standards route/grimpe — pas des mesures de ton matériel réel.
  // ------------------------------------------------------------------------
  CRR: 0.005,                      // coefficient de résistance au roulement (pneus route)
  CDA: 0.40,                       // traînée aérodynamique (position assise, montée), m²
  AIR_DENSITY: 1.20,               // densité de l'air, kg/m3 (niveau de la mer, air tempéré)
  DRIVETRAIN_EFFICIENCY: 0.97,     // rendement transmission (chaîne, pignons)
  G: 9.81,                         // accélération de la pesanteur, m/s²
  SPEED_CORRECTION_FACTOR: 0.81,   // facteur de correction empirique (le modèle brut surestime la vitesse réelle)

};
