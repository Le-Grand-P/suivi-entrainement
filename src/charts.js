// Graphiques SVG (progression, VAM vs FC, comparaison de sorties).
// Équivalent web de backend/charts.py (matplotlib côté desktop), même
// contenu informatif, rendu vectoriel natif au lieu d'images PNG.

import { el, niceStep, nextUid } from "./svgUtils.js";

const COLOR_PRIMARY = "var(--forest)";
const SERIES_COLORS = ["#3a5a46", "#c2452d", "#6f97ad", "#b8862f", "#7c6a9c"];

function makeSvg(width, height) {
  const svg = el("svg", {
    class: "mini-chart",
    viewBox: `0 0 ${width} ${height}`,
    width: "100%",
    height,
    role: "img",
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

/* ------------------------------------------------------------------ */
/* Progression d'une métrique dans le temps                            */
/* ------------------------------------------------------------------ */

export function renderProgressionChart(host, dates, values, { ylabel, title } = {}) {
  host.innerHTML = "";
  if (!dates.length) { emptyState(host, "Pas encore assez de données."); return; }

  const width = Math.max(320, host.clientWidth || 640);
  const height = 260;
  const pad = { t: 42, r: 18, b: 40, l: 52 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const xMin = Math.min(...dates), xMax = Math.max(...dates);
  let yMin = Math.min(...values), yMax = Math.max(...values);
  if (yMax - yMin < 1e-6) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.15;
  yMin -= yPad; yMax += yPad;
  const spanX = xMax - xMin || 1;

  const X = (t) => pad.l + ((t - xMin) / spanX) * plotW;
  const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const svg = makeSvg(width, height);

  // Grille horizontale + graduations Y
  const stepY = niceStep(yMax - yMin, 5);
  for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
    const y = Y(v);
    svg.appendChild(el("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
    const t = el("text", { class: "chart-axis-txt", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
    t.textContent = Math.round(v * 10) / 10;
    svg.appendChild(t);
  }

  // Graduations X (dates)
  const targetTicksX = Math.max(2, Math.round(plotW / 90));
  const stepXms = Math.max(86400000, niceStep(spanX, targetTicksX));
  for (let t = xMin; t <= xMax + 1; t += stepXms) {
    const x = X(t);
    const label = el("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
    label.textContent = formatDateShort(new Date(t));
    svg.appendChild(label);
  }
  // Assure un dernier tick sur le point le plus récent si l'espacement l'a raté
  {
    const x = X(xMax);
    const label = el("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
    label.textContent = formatDateShort(new Date(xMax));
    svg.appendChild(label);
  }

  // Droite de tendance (régression linéaire simple), si assez de points
  if (dates.length >= 3) {
    const { slope, intercept } = linearRegression(dates, values);
    const y0 = slope * xMin + intercept;
    const y1 = slope * xMax + intercept;
    svg.appendChild(el("line", {
      class: "chart-trend", x1: X(xMin), y1: Y(y0), x2: X(xMax), y2: Y(y1),
    }));
  }

  // Ligne + points
  let d = "";
  dates.forEach((t, i) => {
    d += `${d ? "L" : "M"}${X(t).toFixed(1)} ${Y(values[i]).toFixed(1)}`;
  });
  svg.appendChild(el("path", { class: "chart-line", d }));
  dates.forEach((t, i) => {
    svg.appendChild(el("circle", { class: "chart-dot", cx: X(t), cy: Y(values[i]), r: 4 }));
  });

  if (title) {
    const t = el("text", { class: "chart-title", x: width / 2, y: 16, "text-anchor": "middle" });
    t.textContent = title;
    svg.appendChild(t);
  }
  if (ylabel) {
    const t = el("text", {
      class: "chart-axis-label", x: pad.l, y: pad.t - 12, "text-anchor": "start",
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
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

/* ------------------------------------------------------------------ */
/* VAM vs FC moyenne (nuage de points, couleur = ancienneté)           */
/* ------------------------------------------------------------------ */

export function renderHrVamChart(host, climbs) {
  host.innerHTML = "";
  const pts = climbs.filter((c) => c.avg_hr !== null && c.vam_mh !== null);
  if (!pts.length) { emptyState(host, "Aucune montée exploitable."); return; }

  const width = Math.max(320, host.clientWidth || 640);
  const height = 300;
  const pad = { t: 42, r: 18, b: 40, l: 52 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const hrs = pts.map((p) => p.avg_hr);
  const vams = pts.map((p) => p.vam_mh);
  let xMin = Math.min(...hrs), xMax = Math.max(...hrs);
  let yMin = Math.min(...vams), yMax = Math.max(...vams);
  if (xMax - xMin < 1e-6) { xMin -= 5; xMax += 5; }
  if (yMax - yMin < 1e-6) { yMin -= 20; yMax += 20; }
  const xPad = (xMax - xMin) * 0.1, yPad = (yMax - yMin) * 0.12;
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;

  const X = (v) => pad.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const svg = makeSvg(width, height);

  const stepY = niceStep(yMax - yMin, 5);
  for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
    const y = Y(v);
    svg.appendChild(el("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
    const t = el("text", { class: "chart-axis-txt", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
    t.textContent = Math.round(v);
    svg.appendChild(t);
  }
  const stepX = niceStep(xMax - xMin, 5);
  for (let v = Math.ceil(xMin / stepX) * stepX; v <= xMax; v += stepX) {
    const x = X(v);
    const t = el("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
    t.textContent = Math.round(v);
    svg.appendChild(t);
  }

  // Couleur = ancienneté (dates distinctes) : les montées récentes ressortent
  const dateSet = [...new Set(pts.map((p) => p.ride_date).filter(Boolean))].sort();
  const colorFor = (rideDate) => {
    if (dateSet.length <= 1) return COLOR_PRIMARY;
    const idx = dateSet.indexOf(rideDate);
    const t = idx / (dateSet.length - 1);
    // dégradé bistre -> vert forêt (ancien -> récent), cohérent avec la charte
    const from = [154, 152, 141], to = [58, 90, 70];
    const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * t));
    return `rgb(${rgb.join(",")})`;
  };

  pts.forEach((p) => {
    const dot = el("circle", {
      cx: X(p.avg_hr), cy: Y(p.vam_mh), r: 6,
      fill: colorFor(p.ride_date), class: "chart-scatter-dot",
    });
    svg.appendChild(dot);
    if (p.avg_grade_pct !== null && p.avg_grade_pct !== undefined) {
      const label = el("text", {
        class: "chart-point-label", x: X(p.avg_hr) + 8, y: Y(p.vam_mh) - 6,
      });
      label.textContent = `${p.avg_grade_pct}%`;
      svg.appendChild(label);
    }
  });

  const titleEl = el("text", { class: "chart-title", x: width / 2, y: 16, "text-anchor": "middle" });
  titleEl.textContent = "VAM vs FC moyenne (étiquette = pente)";
  svg.appendChild(titleEl);
  const yl = el("text", { class: "chart-axis-label", x: pad.l, y: pad.t - 12 });
  yl.textContent = "VAM (m/h)";
  svg.appendChild(yl);
  const xl = el("text", { class: "chart-axis-label", x: width - pad.r, y: height - 4, "text-anchor": "end" });
  xl.textContent = "FC moyenne (bpm)";
  svg.appendChild(xl);

  host.appendChild(svg);
}

/* ------------------------------------------------------------------ */
/* Charge d'entraînement (CTL/ATL/TSB)                                  */
/* ------------------------------------------------------------------ */

export function renderPmcChart(host, pmc) {
  host.innerHTML = "";
  if (!pmc.length) { emptyState(host, "Pas encore de données de charge."); return; }

  const width = Math.max(320, host.clientWidth || 640);
  const height = 280;
  const pad = { t: 42, r: 18, b: 40, l: 42 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const dates = pmc.map((p) => new Date(p.date + "T00:00:00").getTime());
  const xMin = Math.min(...dates), xMax = Math.max(...dates);
  const allVals = pmc.flatMap((p) => [p.ctl, p.atl, p.tsb]);
  let yMin = Math.min(...allVals, 0), yMax = Math.max(...allVals, 10);
  const yPad = (yMax - yMin) * 0.12 || 5;
  yMin -= yPad; yMax += yPad;

  const X = (t) => pad.l + ((t - xMin) / (xMax - xMin || 1)) * plotW;
  const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const svg = makeSvg(width, height);

  // Ligne du zéro (repère pour le TSB)
  if (yMin < 0 && yMax > 0) {
    svg.appendChild(el("line", {
      x1: pad.l, y1: Y(0), x2: width - pad.r, y2: Y(0),
      class: "chart-grid", "stroke-width": 1.4,
    }));
  }

  const stepY = niceStep(yMax - yMin, 5);
  for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
    const y = Y(v);
    svg.appendChild(el("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
    const t = el("text", { class: "chart-axis-txt", x: pad.l - 6, y: y + 4, "text-anchor": "end" });
    t.textContent = Math.round(v);
    svg.appendChild(t);
  }
  const targetTicksX = Math.max(2, Math.round(plotW / 90));
  const stepXms = Math.max(86400000, niceStep(xMax - xMin, targetTicksX));
  for (let t = xMin; t <= xMax + 1; t += stepXms) {
    const x = X(t);
    const label = el("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
    label.textContent = formatDateShort(new Date(t));
    svg.appendChild(label);
  }

  const series = [
    { key: "ctl", color: "#3a5a46", label: "CTL (forme)" },
    { key: "atl", color: "#c2452d", label: "ATL (fatigue)" },
    { key: "tsb", color: "#b8862f", label: "TSB (fraîcheur)" },
  ];
  series.forEach((s) => {
    let d = "";
    pmc.forEach((p, i) => {
      d += `${d ? "L" : "M"}${X(dates[i]).toFixed(1)} ${Y(p[s.key]).toFixed(1)}`;
    });
    svg.appendChild(el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2 }));
  });

  // Légende
  let lx = pad.l;
  const legendY = 30;
  series.forEach((s) => {
    svg.appendChild(el("rect", { x: lx, y: legendY - 8, width: 10, height: 10, fill: s.color, rx: 2 }));
    const label = el("text", { class: "chart-legend-txt", x: lx + 15, y: legendY + 1 });
    label.textContent = s.label;
    svg.appendChild(label);
    lx += 15 + s.label.length * 6.4 + 16;
  });

  host.appendChild(svg);
}

/* ------------------------------------------------------------------ */
/* Volume hebdo/mensuel (barres)                                       */
/* ------------------------------------------------------------------ */

export function renderVolumeBarChart(host, buckets, valueKey, ylabel, title) {
  host.innerHTML = "";
  if (!buckets.length) { emptyState(host, "Pas encore de données."); return; }

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

  const stepY = niceStep(yMax, 5);
  for (let v = 0; v <= yMax; v += stepY) {
    const y = Y(v);
    svg.appendChild(el("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
    const t = el("text", { class: "chart-axis-txt", x: pad.l - 6, y: y + 4, "text-anchor": "end" });
    t.textContent = Math.round(v);
    svg.appendChild(t);
  }

  buckets.forEach((b, i) => {
    const x = pad.l + i * barW;
    const v = b[valueKey] || 0;
    const barColor = b.tssUnreliable && valueKey === "tss" ? "#b8862f" : "var(--forest)";
    svg.appendChild(el("rect", {
      x: x + barW * 0.14, y: Y(v), width: barW * 0.72, height: Math.max(0, Y(0) - Y(v)),
      fill: barColor, rx: 2,
    }));
    const label = el("text", {
      class: "chart-axis-txt", x: x + barW / 2, y: height - pad.b + 16, "text-anchor": "middle",
    });
    label.textContent = b.label.length > 10 ? b.label.split(" ")[0] : b.label;
    svg.appendChild(label);
  });

  const titleEl = el("text", { class: "chart-title", x: width / 2, y: 18, "text-anchor": "middle" });
  titleEl.textContent = title;
  svg.appendChild(titleEl);
  const yl = el("text", { class: "chart-axis-label", x: pad.l, y: pad.t - 14 });
  yl.textContent = ylabel;
  svg.appendChild(yl);

  host.appendChild(svg);
}

export function renderCompareChart(host, seriesList, { ylabel, title } = {}) {
  host.innerHTML = "";
  if (!seriesList.length) { emptyState(host, "Rien à comparer."); return; }

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
  if (!Number.isFinite(xMin)) { emptyState(host, "Aucune donnée exploitable."); return; }
  const yPad = (yMax - yMin) * 0.1 || 1;
  yMin -= yPad; yMax += yPad;

  const X = (v) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const svg = makeSvg(width, height);

  const stepY = niceStep(yMax - yMin, 5);
  for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
    const y = Y(v);
    svg.appendChild(el("line", { class: "chart-grid", x1: pad.l, y1: y, x2: width - pad.r, y2: y }));
    const t = el("text", { class: "chart-axis-txt", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
    t.textContent = Math.round(v);
    svg.appendChild(t);
  }
  const stepX = niceStep(xMax - xMin, 6);
  for (let v = Math.ceil(xMin / stepX) * stepX; v <= xMax; v += stepX) {
    const x = X(v);
    const t = el("text", { class: "chart-axis-txt", x, y: height - pad.b + 18, "text-anchor": "middle" });
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
    svg.appendChild(el("path", { d, fill: "none", stroke: color, "stroke-width": 1.8, opacity: 0.9 }));
  });

  // Légende
  const legendY = height - pad.b + 40;
  let lx = pad.l;
  seriesList.forEach((s, i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length];
    svg.appendChild(el("rect", { x: lx, y: legendY - 8, width: 10, height: 10, fill: color, rx: 2 }));
    const label = el("text", { class: "chart-legend-txt", x: lx + 15, y: legendY + 1 });
    const text = s.label.length > 30 ? s.label.slice(0, 28) + "…" : s.label;
    label.textContent = text;
    svg.appendChild(label);
    lx += 15 + text.length * 6.2 + 18;
  });

  if (title) {
    const t = el("text", { class: "chart-title", x: width / 2, y: 18, "text-anchor": "middle" });
    t.textContent = title;
    svg.appendChild(t);
  }
  if (ylabel) {
    const t = el("text", { class: "chart-axis-label", x: pad.l, y: pad.t - 14 });
    t.textContent = ylabel;
    svg.appendChild(t);
  }

  host.appendChild(svg);
}
