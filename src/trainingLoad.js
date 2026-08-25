// Charge d'entraînement : TSS estimé par sortie, puis CTL/ATL/TSB (courbe de
// gestion de la performance, méthode Coggan). Aucun capteur de puissance réel
// n'étant disponible, le TSS est calculé à partir de la puissance ESTIMÉE
// (voir analysis.js) — à interpréter en tendance, pas en valeur absolue isolée.

/**
 * TSS (Training Stress Score) estimé d'une sortie.
 * Formule standard : TSS = heures × IF² × 100, avec IF = NP/FTP.
 * Retourne null si les données nécessaires manquent (pas de FTP configuré,
 * puissance normalisée non calculable, sortie sans durée exploitable).
 *
 * Le champ `reliable` passe à false quand l'intensité moyenne implicite
 * dépasse ce qui est physiologiquement tenable sur la durée de la sortie
 * (IF > 1.15 pour plus de 20 min) : ça n'indique pas une sortie extraordinaire,
 * ça indique presque toujours un FTP mal calé par rapport à cette sortie
 * précise (ou, plus rarement, une puissance estimée gonflée par du vent
 * arrière non modélisé). Le TSS est quand même renvoyé — libre à l'appelant
 * de l'exclure ou de l'afficher avec un avertissement.
 */
export function computeRideTSS(rideStats, cfg) {
  const np = rideStats.norm_power_est_w;
  const ftp = cfg.CURRENT_FTP_W;
  const durationH = (rideStats.moving_time_s || 0) / 3600;
  if (!Number.isFinite(np) || !Number.isFinite(ftp) || ftp <= 0 || durationH <= 0) {
    return null;
  }
  const intensityFactor = np / ftp;
  const tss = durationH * intensityFactor * intensityFactor * 100;
  const reliable = !(intensityFactor > 1.15 && durationH > (20 / 60));
  return { tss, intensityFactor: round1(intensityFactor * 100) / 100, reliable };
}

/**
 * Construit la courbe CTL/ATL/TSB jour par jour, du premier jour d'entraînement
 * fourni jusqu'à `throughDate` (aujourd'hui par défaut) — y compris les jours
 * de repos, indispensables au calcul de la moyenne mobile exponentielle.
 *
 * @param {Array<{date: string, tss: number}>} dailyTss - TSS cumulé par date
 *   (YYYY-MM-DD, nombre déjà sommé si plusieurs sorties le même jour — les
 *   TSS non fiables doivent être filtrés ou marqués par l'appelant AVANT
 *   d'arriver ici, voir computeRideTSS().reliable).
 * @param {object} cfg - doit contenir CTL_TIME_CONSTANT (42 par défaut) et
 *   ATL_TIME_CONSTANT (7 par défaut).
 * @param {Date} [throughDate] - dernier jour de la courbe (par défaut : aujourd'hui).
 * @returns {Array<{date: string, tss: number, ctl: number, atl: number, tsb: number}>}
 */
export function computePMC(dailyTss, cfg, throughDate) {
  if (!dailyTss.length) return [];

  const ctlTc = cfg.CTL_TIME_CONSTANT || 42;
  const atlTc = cfg.ATL_TIME_CONSTANT || 7;

  const tssByDate = new Map(dailyTss.map((d) => [d.date, d.tss]));
  const sortedDates = dailyTss.map((d) => d.date).sort();
  const start = new Date(sortedDates[0] + "T00:00:00");
  const end = throughDate ? new Date(throughDate) : new Date();
  end.setHours(0, 0, 0, 0);

  const out = [];
  let ctl = 0, atl = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = isoDate(d);
    const tss = tssByDate.get(iso) || 0;
    // Le "form" (TSB) du jour reflète l'état accumulé AVANT l'entraînement du
    // jour même — on l'enregistre avant de mettre à jour CTL/ATL avec le TSS
    // du jour, sans quoi une grosse sortie ferait paraître la forme meilleure
    // le jour même où elle est justement la plus entamée.
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
