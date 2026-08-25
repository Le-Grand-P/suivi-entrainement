// Agrégation des sorties par semaine ISO ou par mois — alimente le tableau
// de bord. Travaille directement sur les stats déjà enregistrées par sortie
// (pas besoin de reparser les .fit), donc reste rapide même avec un long
// historique.

import { computeRideTSS } from "./trainingLoad.js";

/**
 * @param {Array} rides - résultat de db.listRides() (stats aplaties)
 * @param {"week"|"month"} period
 * @param {object} cfg
 * @returns {Array<{key, label, startDate, nRides, distanceKm, elevationM,
 *   movingTimeS, tss, tssUnreliable}>} trié du plus ancien au plus récent
 */
export function aggregateByPeriod(rides, period, cfg) {
  const buckets = new Map();

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
        tssUnreliable: false,
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

  return [...buckets.values()].sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((b) => ({
      ...b,
      distanceKm: round1(b.distanceKm),
      elevationM: Math.round(b.elevationM),
      tss: Math.round(b.tss),
    }));
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  // Jeudi de la semaine de d (lundi = jour 0) : l'année ISO est celle de ce jeudi.
  const dayNr = (d.getDay() + 6) % 7;
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - dayNr + 3);
  const isoYear = thursday.getFullYear();

  // Jeudi de la semaine 1 = jeudi de la semaine contenant le 4 janvier
  // (le 4 janvier appartient TOUJOURS à la semaine 1 par définition ISO 8601 —
  // le 4 janvier lui-même n'est pas forcément un jeudi, contrairement à ce
  // que suggérerait un calcul naïf).
  const jan4 = new Date(isoYear, 0, 4);
  const jan4DayNr = (jan4.getDay() + 6) % 7;
  const week1Thursday = new Date(jan4);
  week1Thursday.setDate(jan4.getDate() - jan4DayNr + 3);

  const week = 1 + Math.round((thursday - week1Thursday) / (7 * 86400000));
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
  return isoDate(start);
}

function isoWeekLabel(key) {
  const start = new Date(isoWeekStartDate(key) + "T00:00:00");
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")} – ${String(end.getDate()).padStart(2, "0")}/${String(end.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  const names = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                 "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  return `${names[month - 1]} ${year}`;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
