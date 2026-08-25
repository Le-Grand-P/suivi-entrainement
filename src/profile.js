// Profil altimétrique interactif — repris tel quel de l'appli desktop (pur
// JS/SVG, aucune dépendance à pywebview). Voir README pour le détail du
// mécanisme (glissement de bornes, aperçu en direct, id unique par instance
// pour éviter la collision de clipPath entre plusieurs graphiques affichés
// simultanément — bug réel rencontré et corrigé côté desktop).

"use strict";

/* ==========================================================================
   Coupe topographique interactive.

   Trace le profil altimétrique en SVG et, en mode édition, place deux bornes
   déplaçables délimitant une montée.

   Les indices manipulés ici sont des indices D'AFFICHAGE (dans les tableaux
   sous-échantillonnés). Le tableau `idx` fourni par le backend permet de
   retrouver l'indice réel dans le fichier .fit, seul valable pour recalculer
   les métriques à pleine résolution.
   ========================================================================== */

const NS = "http://www.w3.org/2000/svg";

// Compteur module-level : chaque instance d'ElevationProfile a besoin d'un
// clipPath avec un id UNIQUE dans le document. Deux graphiques affichés en
// même temps (le profil général de la sortie + l'éditeur d'une montée, par
// exemple) sont deux <svg> distincts mais partagent le MÊME document HTML :
// un id="plotclip" fixe entre en collision, et `url(#plotclip)` résout alors
// vers le premier clipPath trouvé dans le DOM, quelle que soit sa taille —
// c'est ce qui coupait le bas du profil dans l'éditeur de montée (l'altitude
// basse, proche de la ligne de base, correspond aux plus grandes coordonnées Y).
let _profileInstanceCounter = 0;

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

// Recherche de l'indice dont la distance est la plus proche de `target`.
// Dichotomie : appelée à chaque mouvement de pointeur, un balayage linéaire
// sur plusieurs milliers de points ferait ramer le glissement.
function nearestIndex(dist, target, lo, hi) {
  let a = lo, b = hi;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (dist[m] < target) a = m; else b = m;
  }
  return (Math.abs(dist[a] - target) <= Math.abs(dist[b] - target)) ? a : b;
}

function niceStep(span, targetTicks) {
  const raw = span / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return mult * mag;
}

class ElevationProfile {
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

  getBounds() { return [this.s, this.e]; }

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
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 10) { const c = (hi + lo) / 2; lo = c - 5; hi = c + 5; }
    const margin = (hi - lo) * 0.12;
    lo -= margin; hi += margin;

    const spanX = (x1 - x0) || 1;
    return {
      plotW, plotH, x0, x1, lo, hi,
      X: (km) => this.pad.l + ((km - x0) / spanX) * plotW,
      Y: (a) => this.pad.t + (1 - (a - lo) / (hi - lo)) * plotH,
      invX: (px) => x0 + ((px - this.pad.l) / plotW) * spanX,
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
      "aria-label": "Profil altimétrique",
    });

    /* Hachures de courbes de niveau sous la ligne de crête */
    const defs = el("defs");
    const pat = el("pattern", {
      id: `hatch-${this.uid}`, width: 6, height: 6, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    });
    pat.appendChild(el("rect", { width: 6, height: 6, fill: "#dedfd7" }));
    pat.appendChild(el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#c3bba6", "stroke-width": 1.1 }));
    defs.appendChild(pat);

    const clip = el("clipPath", { id: `plotclip-${this.uid}` });
    clip.appendChild(el("rect", {
      x: this.pad.l, y: this.pad.t, width: sc.plotW, height: sc.plotH,
    }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    /* Graduations d'altitude */
    const targetTicksY = Math.max(2, Math.round(sc.plotH / 55));
    const stepY = niceStep(sc.hi - sc.lo, targetTicksY);
    for (let a = Math.ceil(sc.lo / stepY) * stepY; a <= sc.hi; a += stepY) {
      const y = sc.Y(a);
      svg.appendChild(el("line", {
        class: "axis-line", x1: this.pad.l, y1: y, x2: width - this.pad.r, y2: y,
        opacity: .45,
      }));
      const t = el("text", { class: "axis-txt", x: this.pad.l - 7, y: y + 3, "text-anchor": "end" });
      t.textContent = Math.round(a);
      svg.appendChild(t);
    }

    /* Ligne de crête + remplissage hachuré.
       Dessinés run par run de points valides consécutifs : un trou de données
       (bord ou intérieur) laisse un vrai blanc, jamais une ligne droite
       trompeuse reliant deux points distants, et le polygone de remplissage
       se referme sur les bornes RÉELLES du run, pas sur les bornes de la
       fenêtre affichée (sinon un trou en bord de fenêtre dessine une
       diagonale nette qui n'existe pas dans les données). */
    const baseY = this.pad.t + sc.plotH;
    const runs = [];
    let cur = null;
    for (let i = this.i0; i <= this.i1; i++) {
      if (alt[i] === null) { cur = null; continue; }
      if (!cur) { cur = []; runs.push(cur); }
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

    /* Repères des autres montées détectées (contexte, non éditables) */
    if (this.opts.climbs && !this.editable) {
      for (const c of this.opts.climbs) {
        const a = this._displayIndexOf(c.start_idx);
        const b = this._displayIndexOf(c.end_idx);
        if (b < this.i0 || a > this.i1) continue;
        const xa = sc.X(dist_km[Math.max(a, this.i0)]);
        const xb = sc.X(dist_km[Math.min(b, this.i1)]);
        svg.appendChild(el("rect", {
          class: "climb-tick", x: xa, y: baseY - 4, width: Math.max(2, xb - xa), height: 4,
        }));
      }
    }

    /* Courbe de fréquence cardiaque */
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
        loH -= pad; hiH += pad;
        let dh = "";
        for (let i = this.i0; i <= this.i1; i++) {
          if (hr[i] === null) continue;
          const y = this.pad.t + (1 - (hr[i] - loH) / (hiH - loH)) * sc.plotH;
          dh += `${dh ? "L" : "M"}${sc.X(dist_km[i]).toFixed(1)} ${y.toFixed(1)}`;
        }
        if (dh) svg.appendChild(el("path", { class: "hr-line", d: dh, "clip-path": `url(#plotclip-${this.uid})` }));
      }
    }

    /* Bande sélectionnée + bornes */
    if (this.editable) {
      const xs = sc.X(dist_km[this.s]);
      const xe = sc.X(dist_km[this.e]);
      svg.appendChild(el("rect", {
        class: "sel-band", x: Math.min(xs, xe), y: this.pad.t,
        width: Math.abs(xe - xs), height: sc.plotH,
      }));
      this._handle(svg, "s", xs, sc, "A");
      this._handle(svg, "e", xe, sc, "B");
    }

    /* Graduations de distance : le nombre de crans s'adapte à la largeur
       réelle disponible. Un nombre fixe de graduations chevauche les
       libellés sur un écran étroit (mobile) et les éparpille inutilement
       sur un grand écran. */
    const targetTicksX = Math.max(2, Math.round(sc.plotW / 78));
    const stepX = niceStep(sc.x1 - sc.x0, targetTicksX);
    for (let km = Math.ceil(sc.x0 / stepX) * stepX; km <= sc.x1 + 1e-9; km += stepX) {
      const x = sc.X(km);
      const t = el("text", {
        class: "axis-txt", x, y: this.height - 8, "text-anchor": "middle",
      });
      t.textContent = (stepX < 1 ? km.toFixed(1) : Math.round(km)) + " km";
      svg.appendChild(t);
    }

    svg.appendChild(el("line", {
      class: "axis-line", x1: this.pad.l, y1: baseY, x2: width - this.pad.r, y2: baseY,
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
      const m = (a + b) >> 1;
      if (idx[m] < realIdx) a = m; else b = m;
    }
    return Math.abs(idx[a] - realIdx) <= Math.abs(idx[b] - realIdx) ? a : b;
  }

  _handle(svg, which, x, sc, letter) {
    const g = el("g", {
      class: "handle-grp",
      tabindex: 0,
      role: "slider",
      "aria-label": which === "s" ? "Début de la montée" : "Fin de la montée",
      "aria-valuemin": 0,
      "aria-valuemax": this.data.dist_km.length - 1,
      "aria-valuenow": which === "s" ? this.s : this.e,
      "data-h": which,
    });
    g.appendChild(el("line", {
      class: "handle-line", x1: x, y1: this.pad.t - 4, x2: x, y2: this.pad.t + sc.plotH,
    }));
    // Zone de saisie large : viser une ligne de 2 px à la souris est pénible.
    g.appendChild(el("rect", {
      class: "handle-hit", x: x - 13, y: this.pad.t - 10,
      width: 26, height: sc.plotH + 14,
    }));
    g.appendChild(el("rect", {
      class: "handle-cap", x: x - 10, y: this.pad.t - 12, width: 20, height: 15, rx: 2,
    }));
    const t = el("text", { class: "handle-cap-txt", x: x, y: this.pad.t - 1.5 });
    t.textContent = letter;
    g.appendChild(t);
    svg.appendChild(g);
  }

  _pointerToIndex(clientX) {
    const rect = this.svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * this.width;
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
        try { g.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (this.opts.onCommit) this.opts.onCommit(this.s, this.e);
      };
      g.addEventListener("pointerup", end);
      g.addEventListener("pointercancel", end);

      // Réglage fin au clavier : au pixel près, une borne est difficile à
      // placer exactement à la souris.
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
    // render() reconstruit tout le SVG : l'élément qui avait le focus clavier
    // est détruit, et le focus retomberait sur le document. Sans restauration
    // explicite, une seule pression de flèche suffit à perdre la main.
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
}

export { ElevationProfile };
