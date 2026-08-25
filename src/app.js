"use strict";

import * as api from "./localApi.js";
import { ElevationProfile } from "./profile.js";
import { renderProgressionChart, renderHrVamChart, renderCompareChart,
         renderPmcChart, renderVolumeBarChart } from "./charts.js";
import { renderRouteMap, destroyRouteMap } from "./mapView.js";
import { registerServiceWorker, setupInstallPrompt } from "./pwa.js";

/* ------------------------------------------------------------------ Outils */

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const nf = (v, d = 0) =>
  (v === null || v === undefined || Number.isNaN(v)) ? "—"
    : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

function num(v, unit = "", d = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${nf(v, d)}${unit ? `<small>${esc(unit)}</small>` : ""}`;
}

function signed(v, unit = "", d = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${nf(v, d)}${unit ? `<small>${esc(unit)}</small>` : ""}`;
}

function dur(sec) {
  if (sec === null || sec === undefined) return "—";
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h}<small>h</small>${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m}<small>min</small>`;
  return `${s}<small>s</small>`;
}

function frDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

const metric = (k, v) => `<div class="metric"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
const spinner = (t = "Chargement") => `<div class="loading"><span class="spin"></span>${esc(t)}</div>`;
const notice = (m, ok = false) => `<div class="notice${ok ? " ok" : ""}">${esc(m)}</div>`;

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Enveloppe un appel à l'API locale : lève une Error si la réponse contient
 * un champ `error` (même convention que le pont pywebview desktop, pour
 * garder le même code d'affichage try/catch partout). */
async function call(method, ...args) {
  const r = await api[method](...args);
  if (r && typeof r === "object" && r.error) throw new Error(r.error);
  return r;
}

/* ------------------------------------------------------------- Navigation */

let activeProfile = null;
let activeMap = null;

function showTab(name) {
  document.querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-content").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById("tab-" + name);
  if (el) el.classList.add("active");
  window.scrollTo(0, 0);

  if (name !== "detail" && activeProfile) { activeProfile.destroy(); activeProfile = null; }
  if (name !== "detail" && activeMap) { destroyRouteMap(activeMap); activeMap = null; }
  if (name === "rides") loadRides();
  if (name === "progression") loadProgression();
  if (name === "compare") loadCompare();
}

document.querySelectorAll(".tab-btn")
  .forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
document.getElementById("btn-back").addEventListener("click", () => showTab("rides"));

/* ----------------------------------------------------------------- Import */

const filePicker = document.getElementById("file-picker");
const btnPick = document.getElementById("btn-pick");
btnPick.addEventListener("click", () => filePicker.click());

filePicker.addEventListener("change", async () => {
  const files = Array.from(filePicker.files || []);
  filePicker.value = ""; // permet de resélectionner le même fichier plus tard
  if (!files.length) return;

  const out = document.getElementById("import-out");
  btnPick.disabled = true;
  out.innerHTML = spinner(`Analyse de ${files.length} fichier(s)`);
  try {
    const res = await call("import_files", files);
    const ok = res.filter((r) => r.status === "ok").length;

    out.innerHTML = `<div class="card" style="margin-top:18px">` +
      res.map((r) => {
        if (r.status === "ok") {
          return `<div class="import-line st-ok">${esc(r.filename)} — ${esc(r.ride_date)}, ${esc(r.n_climbs)} montée(s)</div>`;
        }
        if (r.status === "skipped") {
          return `<div class="import-line st-skip">${esc(r.filename)} — ${esc(r.reason)}</div>`;
        }
        return `<div class="import-line st-err">${esc(r.filename)} — ${esc(r.reason)}</div>`;
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

/* ------------------------------------------------------------ Liste sorties */

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
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(ev); }
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

/* ------------------------------------------------------------ Détail sortie */

let currentRide = null;
let currentSeries = null;
let currentSegments = [];

async function openRide(id) {
  showTab("detail");
  const out = document.getElementById("detail-out");
  out.innerHTML = spinner();
  try {
    const [ride, series, profile] = await Promise.all([
      call("get_ride_detail", id),
      call("get_ride_series", id).catch(() => null),
      call("get_profile").catch(() => ({ flat_max_grade_pct: null })),
    ]);
    if (!ride) { out.innerHTML = notice("Sortie introuvable."); return; }
    currentRide = ride;
    currentSeries = series;
    const FLAT_MAX_GRADE = profile.flat_max_grade_pct;

    const s = ride.stats;
    let html = `<p class="eyebrow">${frDate(ride.ride_date)}</p>
      <h1>${esc(ride.filename)}</h1>`;

    html += `<div class="metrics">
      ${metric("Distance", num(s.distance_km, "km", 1))}
      ${metric("Dénivelé +", num(s.elevation_gain_m, "m"))}
      ${metric("Dénivelé −", num(s.elevation_loss_m, "m"))}
      ${metric("Temps mobile", dur(s.moving_time_s))}
      ${metric("Temps total", dur(s.duration_s))}
      ${metric("Vitesse moy.", num(s.avg_speed_kmh, "km/h", 1))}
      ${metric("Vitesse max", num(s.max_speed_kmh, "km/h", 1))}
      ${metric("FC moyenne", num(s.avg_hr, "bpm"))}
      ${metric("FC max", num(s.max_hr, "bpm"))}
      ${metric("Cadence", num(s.avg_cadence, "rpm"))}
      ${metric("Puissance est.", num(s.avg_power_est_w, "W"))}
      ${metric("Puiss. normalisée", num(s.norm_power_est_w, "W"))}
      ${metric("% FTP", num(s.avg_power_est_pct_ftp, "%"))}
      ${metric("Découplage", s.aerobic_decoupling_pct === null ? "—" : num(s.aerobic_decoupling_pct, "%", 1))}
    </div>`;

    if (series && series.alt) {
      html += `<h2>Profil de la sortie</h2>
        <div class="card"><div id="ride-profile" class="profile-wrap"></div>
        <div class="readout" id="ride-readout"></div></div>`;
    }

    if (series && series.lat) {
      html += `<h2>Tracé</h2>
        <p class="lede">Nécessite une connexion Internet (fond de carte OpenStreetMap) — le reste de l'appli continue de fonctionner hors ligne.</p>
        <div class="card"><div id="ride-map"></div></div>`;
    }

    html += `<h2>Segment plat de référence</h2>
      <p class="lede">
        Portion plate d'au moins 5 min repérée automatiquement (pente ≤ ${nf(FLAT_MAX_GRADE, 1)} %,
        plafonnée à 20 min) — vitesse et FC comparables d'une sortie à l'autre à effort similaire.
      </p>`;
    if (ride.flatSegment) {
      const fs = ride.flatSegment;
      html += `<div class="metrics">
        ${metric("Vitesse moy.", num(fs.avg_speed_kmh, "km/h", 1))}
        ${metric("FC moyenne", num(fs.avg_hr, "bpm"))}
        ${metric("Durée", dur(fs.duration_s))}
        ${metric("Longueur", num(fs.distance_m / 1000, "km", 1))}
        ${metric("Intervient au km", num(fs.start_km, "km", 1))}
        ${metric("D+ déjà grimpé", num(fs.elevation_gain_before_m, "m"))}
      </div>`;
      if (fs.truncated) {
        html += `<p class="muted" style="margin-top:8px">Ce tronçon plat continuait au-delà de 20 min — le calcul s'arrête là pour rester comparable aux autres sorties.</p>`;
      }
    } else if (ride.flatSegmentComputed) {
      html += `<div class="empty"><div class="big">Pas de plat assez long sur cette sortie</div>
        <p>Il faut au moins 5 minutes continues sous ${nf(FLAT_MAX_GRADE, 1)} % de pente.</p></div>`;
    } else {
      html += `<div class="empty"><div class="big">Pas encore analysé</div>
        <p>Cette sortie a été importée avant l'ajout de cette fonction — réimporte-la pour vérifier si elle contient un segment plat.</p></div>`;
    }

    if (s.hr_zones_pct) {
      html += `<h2>Temps par zone cardiaque</h2><div class="card zones">` +
        Object.entries(s.hr_zones_pct).map(([z, p], i) => `
          <div class="zone">
            <span class="zone-k">${esc(z)}</span>
            <span class="zone-bar"><span class="${i === 3 ? "z4" : i === 4 ? "z5" : ""}"
              style="width:${Math.max(0, Math.min(100, p))}%"></span></span>
            <span class="zone-v">${nf(p, 1)} %</span>
          </div>`).join("") + `</div>`;
    }

    if (ride.climbs && ride.climbs.length) {
      html += `<h2>Montées <span class="muted">(${ride.climbs.length})</span></h2>
        <p class="lede">Ouvre une montée pour ajuster son début et sa fin sur le profil.</p>`;
      html += ride.climbs.map((c, i) => climbCard(c, i)).join("");
      html += `<div class="btn-row" style="margin-top:16px">
        <button class="btn-quiet" id="reset-climbs">Revenir à la détection automatique</button></div>`;
      if (ride.climbs.length > 1) {
        html += `<h2>VAM et fréquence cardiaque</h2><div class="card" id="hr-vam-chart"></div>`;
      }
    } else {
      html += `<h2>Montées</h2>
        <div class="empty"><div class="big">Aucune montée détectée</div>
        <p>Seuils actuels : pente ≥ 3 %, longueur ≥ 400 m, D+ ≥ 25 m.
        Réglables dans l'onglet Profil (bientôt).</p></div>`;
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
      if (!confirm("Recalculer les montées automatiquement ? Tes ajustements manuels seront perdus.")) return;
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
        <span class="t">${nf(c.distance_m / 1000, 1)} km à ${nf(c.avg_grade_pct, 1)} %</span>
        ${c.user_adjusted ? `<span class="tag">Ajustée</span>` : ""}
        <span class="s">${nf(c.elevation_gain_m)} m D+ · ${dur(c.duration_s).replace(/<\/?small>/g, "")}</span>
      </span>
      <span class="climb-vam">${nf(c.vam_mh)}<small> m/h</small></span>
      <span class="chev">▸</span>
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
    start_idx: sc.start_idx, end_idx: sc.end_idx,
  }));
  activeProfile = new ElevationProfile(host, series, {
    editable: false,
    height: 190,
    climbs: tickClimbs,
    onHover: (i) => {
      if (i === null) { readout.innerHTML = ""; return; }
      readout.innerHTML =
        `<span>km <b>${nf(series.dist_km[i], 1)}</b></span>` +
        `<span>alt <b>${nf(series.alt[i])} m</b></span>` +
        (series.hr[i] !== null ? `<span>FC <b>${nf(series.hr[i])} bpm</b></span>` : "") +
        (series.grade[i] !== null ? `<span>pente <b>${nf(series.grade[i], 1)} %</b></span>` : "");
    },
  });
}

function renderRideMap(series, climbs) {
  const host = document.getElementById("ride-map");
  if (!host) return;
  if (activeMap) { destroyRouteMap(activeMap); activeMap = null; }
  const tickClimbs = (series.climbs || []).map((sc) => ({
    start_idx: sc.start_idx, end_idx: sc.end_idx,
  }));
  try {
    activeMap = renderRouteMap(host, series, tickClimbs);
  } catch (e) {
    host.innerHTML = notice("Carte indisponible : " + e.message);
  }
}

/* --------------------------------------------- Éditeur de bornes de montée */

const climbEditors = {};

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
    while (b - a > 1) { const m = (a + b) >> 1; if (idx[m] < real) a = m; else b = m; }
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
        <span class="sp-v">${nf(m.distance_m / 1000, 2)}<small>km</small></span></div>
      <div class="sp"><span class="sp-k">Dénivelé</span>
        <span class="sp-v">${nf(m.elevation_gain_m)}<small>m</small></span></div>
      <div class="sp"><span class="sp-k">Pente moy.</span>
        <span class="sp-v">${nf(m.avg_grade_pct, 1)}<small>%</small></span></div>
      <div class="sp"><span class="sp-k">VAM</span>
        <span class="sp-v">${nf(m.vam_mh)}<small>m/h</small></span></div>
      <div class="sp"><span class="sp-k">FC moy.</span>
        <span class="sp-v">${m.avg_hr === null ? "—" : nf(m.avg_hr)}<small>bpm</small></span></div>
      <div class="sp"><span class="sp-k">Dérive FC</span>
        <span class="sp-v">${m.hr_drift_bpm === null ? "—" : (m.hr_drift_bpm > 0 ? "+" : "") + nf(m.hr_drift_bpm, 1)}<small>bpm</small></span></div>
      <div class="sp"><span class="sp-k">Puiss. est.</span>
        <span class="sp-v">${m.est_power_w === null ? "—" : nf(m.est_power_w)}<small>W</small></span></div>`;
  };
  paint(climb);

  const localPreview = (a, b) => {
    const dm = (series.dist_km[b] - series.dist_km[a]) * 1000;
    const dp = (series.alt[b] ?? 0) - (series.alt[a] ?? 0);
    const g = dm > 0 ? (dp / dm) * 100 : 0;
    ro.innerHTML = `<span>Segment <b>${nf(dm / 1000, 2)} km</b></span>` +
      `<span>D+ <b>${nf(dp)} m</b></span>` +
      `<span>pente <b>${nf(g, 1)} %</b></span>` +
      `<span class="muted">relâche pour recalculer</span>`;
  };

  const commit = debounce(async (a, b) => {
    try {
      msg.textContent = "";
      const res = await call("preview_climb", currentRide.id, series.idx[a], series.idx[b]);
      paint(res.metrics);
      ro.innerHTML = `<span class="muted">Bornes modifiées — enregistre pour conserver.</span>`;
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
    onCommit: commit,
  });
  climbEditors[i] = prof;

  btnSave.addEventListener("click", async () => {
    const [ra, rb] = prof.getRealBounds();
    btnSave.disabled = true;
    msg.textContent = "Enregistrement…";
    try {
      const res = await call("save_climb_bounds", currentRide.id, i, ra, rb);
      currentRide.climbs[i] = res.metrics;
      paint(res.metrics);
      ro.innerHTML = "";
      msg.textContent = "Bornes enregistrées.";
      btnUndo.disabled = true;
      refreshClimbHeader(i, res.metrics);
    } catch (e) {
      msg.textContent = "";
      ro.innerHTML = `<span class="st-err">${esc(e.message)}</span>`;
      btnSave.disabled = false;
    }
  });

  btnUndo.addEventListener("click", () => {
    prof.s = s0; prof.e = e0;
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
    btnZoom.textContent = zoomed ? "Recentrer sur la montée" : "Voir toute la sortie";
  });
}

function refreshClimbHeader(i, m) {
  const head = document.querySelector(`.climb-head[data-i="${i}"]`);
  if (!head) return;
  head.querySelector(".t").textContent =
    `${nf(m.distance_m / 1000, 1)} km à ${nf(m.avg_grade_pct, 1)} %`;
  head.querySelector(".s").textContent =
    `${nf(m.elevation_gain_m)} m D+ · ${dur(m.duration_s).replace(/<\/?small>/g, "")}`;
  head.querySelector(".climb-vam").innerHTML = `${nf(m.vam_mh)}<small> m/h</small>`;
  if (!head.querySelector(".tag")) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "Ajustée";
    head.querySelector(".climb-title").insertBefore(
      tag, head.querySelector(".climb-title .s"));
  }
}

/* ------------------------------------------------------------- Progression */

async function loadProgression() {
  const sel = document.getElementById("metric-select");
  if (!sel.dataset.loaded) {
    try {
      const m = await call("get_progression_metrics");
      sel.innerHTML = Object.entries(m)
        .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
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

/* ------------------------------------------------------------- Objectifs */

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
              ${overdue ? "passé" : `<b>${esc(g.days_remaining)}</b><small>jours</small>`}
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
        <input type="text" id="goal-name" placeholder="Ex : Traversée des Alpes" required></div>
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
    addBtn.addEventListener("click", () => { addBtn.style.display = "none"; form.style.display = "flex"; });
    document.getElementById("btn-cancel-goal").addEventListener("click", () => {
      form.style.display = "none"; addBtn.style.display = "";
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        await call("add_goal", {
          name: document.getElementById("goal-name").value.trim(),
          event_date: document.getElementById("goal-date").value,
          target_distance_km: parseFloat(document.getElementById("goal-dist").value) || null,
          target_elevation_m: parseFloat(document.getElementById("goal-elev").value) || null,
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

/* ------------------------------------------------------- Charge d'entraînement */

async function loadTrainingLoad() {
  const summary = document.getElementById("pmc-summary");
  const chart = document.getElementById("pmc-chart");
  summary.innerHTML = ""; chart.innerHTML = spinner();
  try {
    const data = await call("get_training_load");
    if (!data.pmc || !data.pmc.length) {
      chart.innerHTML = `<div class="empty"><div class="big">Pas encore de charge calculable</div>
        <p>Il faut au moins une sortie avec une FTP configurée dans <code>config.local.js</code>.</p></div>`;
      return;
    }
    const latest = data.latest;
    summary.innerHTML = `
      ${metric("CTL (forme)", num(latest.ctl))}
      ${metric("ATL (fatigue)", num(latest.atl))}
      ${metric("TSB (fraîcheur)", signed(latest.tsb))}`;
    renderPmcChart(chart, data.pmc);
    if (data.pmc.length < 21) {
      chart.innerHTML += notice(
        `Historique encore court (${data.pmc.length} jour(s)) : CTL/ATL/TSB partent de zéro et ` +
        `mettent plusieurs semaines à devenir représentatifs. Ne tire pas de conclusion sur le TSB tant que l'historique est court.`
      );
    }
    if (data.nUnreliable > 0) {
      chart.innerHTML += notice(
        `${data.nUnreliable} sortie(s) sur ${data.nRidesWithTss} ont un TSS jugé peu fiable ` +
        `(intensité moyenne implausible sur la durée — vérifie ton FTP dans config.local.js).`
      );
    }
  } catch (e) {
    chart.innerHTML = notice(e.message);
  }
}

/* ------------------------------------------------------------- Tableau de bord */

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
  chart.innerHTML = spinner(); table.innerHTML = "";
  try {
    const data = await call("get_dashboard", period);
    if (!data.buckets || !data.buckets.length) {
      chart.innerHTML = `<div class="empty"><div class="big">Pas encore de données</div></div>`;
      return;
    }
    renderVolumeBarChart(chart, data.buckets, "distanceKm", "Distance (km)",
      period === "week" ? "Distance par semaine" : "Distance par mois");
    table.innerHTML = `<div class="card" style="margin-top:14px"><div class="table-scroll"><table><thead><tr>
        <th>${period === "week" ? "Semaine" : "Mois"}</th><th>Sorties</th><th>Distance</th>
        <th>D+</th><th>Temps</th><th>TSS</th>
      </tr></thead><tbody>` + data.buckets.slice().reverse().map((b) => `<tr>
        <td>${esc(b.label)}</td>
        <td class="num">${esc(b.nRides)}</td>
        <td class="num">${nf(b.distanceKm, 1)} km</td>
        <td class="num">${nf(b.elevationM)} m</td>
        <td class="num">${dur(b.movingTimeS).replace(/<\/?small>/g, "")}</td>
        <td class="num">${nf(b.tss)}${b.tssUnreliable ? " ⚠" : ""}</td>
      </tr>`).join("") + `</tbody></table></div></div>`;
  } catch (e) {
    chart.innerHTML = notice(e.message);
  }
}

/* ------------------------------------------------------------- Montées répétées */

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
        ylabel: "Vitesse (km/h)", title: "Vitesse sur le segment plat de référence",
      });
    } else {
      chart.innerHTML = `<p class="muted">Une seule sortie avec segment plat pour l'instant —
        le graphique apparaîtra à partir de la deuxième.</p>`;
    }

    table.innerHTML = `<div class="card" style="margin-top:14px"><div class="table-scroll"><table><thead><tr>
        <th>Date</th><th>Sortie</th><th>Vitesse</th><th>FC</th><th>Durée</th><th>Longueur</th>
        <th>Km sortie</th><th>D+ avant</th>
      </tr></thead><tbody>` + segs.slice().reverse().map((s) => `<tr>
        <td class="date-cell">${frDate(s.ride_date)}</td>
        <td class="fname">${esc(s.ride_filename)}</td>
        <td class="num"><b>${nf(s.avg_speed_kmh, 1)}</b> km/h</td>
        <td class="num">${nf(s.avg_hr)} bpm</td>
        <td class="num">${dur(s.duration_s).replace(/<\/?small>/g, "")}${s.truncated ? " ⚠" : ""}</td>
        <td class="num">${nf(s.distance_m / 1000, 1)} km</td>
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
      out.innerHTML = `<div class="empty"><div class="big">Aucune montée répétée pour l'instant</div>
        <p>Regrimpe une montée déjà vue sur une autre sortie pour voir apparaître ta progression dessus.
        ${data.skippedNoGps ? `(${data.skippedNoGps} montée(s) sans coordonnées GPS ignorée(s) — réimporte ces sorties pour les inclure.)` : ""}</p></div>`;
      return;
    }
    out.innerHTML = currentSegments.map((s, i) => `
      <div class="climb" id="segment-${i}">
        <div class="climb-head" data-seg="${i}">
          <span class="climb-no">${s.n_occurrences}×</span>
          <span class="climb-title">
            <span class="t">${esc(s.name || s.label)}</span>
            <span class="s">${s.name ? `${esc(s.label)} · ` : ""}${frDate(s.first_date)} → ${frDate(s.last_date)}
              ${s.vam_trend_pct !== null ? ` · VAM ${signed(s.vam_trend_pct, " %", 1).replace(/<\/?small>/g, "")}` : ""}
              <button class="btn-rename" data-rename="${i}" title="Renommer" aria-label="Renommer cette montée">✎ renommer</button></span>
          </span>
          <span class="climb-vam">${nf(s.best_vam_mh)}<small> m/h max</small></span>
          <span class="chev">▸</span>
        </div>
        <div class="climb-body" id="segment-body-${i}">
          <div class="table-scroll"><table><thead><tr>
            <th>Date</th><th>Sortie</th><th>VAM</th><th>FC</th><th>Dérive</th><th>Puiss.</th>
          </tr></thead><tbody>${s.occurrences.slice().reverse().map((o) => `<tr>
            <td class="date-cell">${frDate(o.ride_date)}</td>
            <td class="fname">${esc(o.ride_filename)}</td>
            <td class="num"><b>${nf(o.vam_mh)}</b></td>
            <td class="num">${nf(o.avg_hr)}</td>
            <td class="num">${o.hr_drift_bpm === null ? "—" : (o.hr_drift_bpm > 0 ? "+" : "") + nf(o.hr_drift_bpm, 1)}</td>
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
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
      });
    });

    out.querySelectorAll("[data-rename]").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const i = parseInt(btn.dataset.rename, 10);
        const seg = currentSegments[i];
        const current = seg.name || "";
        const input = prompt(
          `Nom de cette montée (${seg.label}) :\nLaisse vide pour revenir au nom automatique.`,
          current
        );
        if (input === null) return; // annulé
        try {
          await call("rename_climb_segment", {
            anchor_lat: seg.anchor_lat, anchor_lon: seg.anchor_lon,
            avg_distance_m: seg.avg_distance_m, avg_elevation_m: seg.avg_elevation_m,
          }, input, seg.name_id);
          loadClimbSegments();
        } catch (e) {
          alert(e.message);
        }
      });
    });

    if (data.skippedNoGps) {
      out.innerHTML += notice(
        `${data.skippedNoGps} montée(s) sans coordonnées GPS n'ont pas pu être comparées ` +
        `(sorties importées avant l'ajout de cette fonction — réimporte-les pour les inclure).`
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
      out.innerHTML = `<div class="empty"><div class="big">Pas assez de données</div>
        <p>Il faut au moins deux sorties comportant cette métrique.</p></div>`;
      return;
    }
    const dates = d.table.map((row) => new Date(row.date).getTime());
    const values = d.table.map((row) => row.value);
    const metrics = await call("get_progression_metrics");
    renderProgressionChart(out, dates, values, { ylabel: metrics[m], title: `Progression — ${metrics[m]}` });

    const a = d.table[0].value, b = d.table[d.table.length - 1].value;
    if (typeof a === "number" && typeof b === "number" && a !== 0) {
      const pct = ((b - a) / Math.abs(a)) * 100;
      out.innerHTML += `<p class="muted" style="margin-top:12px">
        De la première à la dernière sortie : <b>${signed(Math.round(pct * 10) / 10, " %").replace(/<\/?small>/g, "")}</b>
        (${nf(a, 1)} → ${nf(b, 1)}). Écart brut entre deux sorties, sans
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
      chartHost.innerHTML = `<div class="empty"><div class="big">Aucune montée</div>
         <p>Importe une sortie comportant du dénivelé.</p></div>`;
      return;
    }
    renderHrVamChart(chartHost, d.climbs);
    table.innerHTML = `<div class="card" style="margin-top:14px"><div class="table-scroll"><table><thead><tr>
        <th>Date</th><th>Sortie</th><th>Pente</th><th>Long.</th><th>D+</th>
        <th>VAM</th><th>FC</th><th>Dérive</th><th>Puiss.</th>
      </tr></thead><tbody>` + d.climbs.slice().reverse().map((c) => `<tr>
        <td class="date-cell">${frDate(c.ride_date)}</td>
        <td class="fname">${esc(c.ride_filename)}</td>
        <td class="num">${nf(c.avg_grade_pct, 1)} %</td>
        <td class="num">${nf(c.distance_m / 1000, 1)} km</td>
        <td class="num">${nf(c.elevation_gain_m)} m</td>
        <td class="num"><b>${nf(c.vam_mh)}</b></td>
        <td class="num">${nf(c.avg_hr)}</td>
        <td class="num">${c.hr_drift_bpm === null ? "—" : (c.hr_drift_bpm > 0 ? "+" : "") + nf(c.hr_drift_bpm, 1)}</td>
        <td class="num">${nf(c.est_power_w)} W</td>
      </tr>`).join("") + `</tbody></table></div></div>`;
  } catch (e) {
    chartHost.innerHTML = notice(e.message);
  }
}

/* --------------------------------------------------------------- Comparer */

async function loadCompare() {
  const picker = document.getElementById("compare-picker");
  const sel = document.getElementById("compare-metric");
  picker.innerHTML = spinner();
  try {
    if (!sel.dataset.loaded) {
      const m = await call("get_compare_metrics");
      sel.innerHTML = Object.entries(m)
        .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
      sel.dataset.loaded = "1";
    }
    const rides = await call("list_rides");
    if (!rides.length) {
      picker.innerHTML = `<div class="empty"><div class="big">Aucune sortie</div></div>`;
      return;
    }
    picker.innerHTML = rides.map((r) => `
      <label class="pick"><input type="checkbox" class="cmp" value="${esc(r.id)}">
        <span><b>${frDate(r.ride_date)}</b> · ${esc(r.filename)}
        <span class="muted">${nf(r.distance_km, 1)} km · ${nf(r.elevation_gain_m)} m D+</span></span>
      </label>`).join("");
  } catch (e) {
    picker.innerHTML = notice(e.message);
  }
}

document.getElementById("btn-compare").addEventListener("click", async () => {
  const ids = Array.from(document.querySelectorAll(".cmp:checked"))
    .map((c) => parseInt(c.value, 10));
  const out = document.getElementById("compare-out");
  if (ids.length < 2) { out.innerHTML = notice("Sélectionne au moins 2 sorties."); return; }
  if (ids.length > 5) { out.innerHTML = notice("5 sorties au maximum : au-delà le graphique devient illisible."); return; }
  out.innerHTML = spinner("Génération du graphique");
  try {
    const r = await call("compare_rides", ids, document.getElementById("compare-metric").value);
    out.innerHTML = "";
    renderCompareChart(out, r.seriesList, { ylabel: r.metricLabel, title: `Comparaison — ${r.metricLabel}` });
    if (r.warning) out.innerHTML += notice(r.warning);
  } catch (e) {
    out.innerHTML = notice(e.message);
  }
});

/* ------------------------------------------------------------------------ */

registerServiceWorker();
setupInstallPrompt();
loadRides();
