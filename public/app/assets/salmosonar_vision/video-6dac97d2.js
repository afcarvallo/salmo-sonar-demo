// Reproductor de video con detecciones en vivo: pide cada cuadro al servicio de visión
// (vía Rails), muestra el JPEG y dibuja las cajas con su probabilidad encima.
(() => {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  // Palitos del esqueleto: con 4 puntos (hocico, cola, dorso, vientre) = eje largo + eje alto + contorno;
  // con otro número, una polilínea por los puntos visibles.
  function palitos(svg, kps, color, sw) {
    const vis = (i) => kps[i] && kps[i][2] >= 0.3;
    const seg = (a, b, grueso) => {
      if (!vis(a) || !vis(b)) return;
      const ln = document.createElementNS(SVGNS, "line");
      ln.setAttribute("x1", kps[a][0]); ln.setAttribute("y1", kps[a][1]); ln.setAttribute("x2", kps[b][0]); ln.setAttribute("y2", kps[b][1]);
      ln.setAttribute("class", "kp-line live"); ln.setAttribute("style", `stroke:${color};stroke-width:${grueso ? sw * 2.2 : sw * 1.1}`);
      svg.appendChild(ln);
    };
    if (kps.length === 4) { seg(0, 1, true); seg(2, 3, true); seg(0, 2); seg(2, 1); seg(1, 3); seg(3, 0); }
    else for (let i = 1; i < kps.length; i++) seg(i - 1, i, false);
    kps.forEach(([x, y, k]) => {
      if (k < 0.3) return;
      const ci = document.createElementNS(SVGNS, "circle");
      ci.setAttribute("cx", x); ci.setAttribute("cy", y); ci.setAttribute("r", sw * 3.2); ci.setAttribute("class", "kp live");
      ci.setAttribute("style", `fill:${color}`); svg.appendChild(ci);
    });
  }

  const COLORS = ["#2ad4c8", "#ffb454", "#7fd0ff", "#ff7a8a", "#b8f06d", "#d9a6ff", "#ffd166", "#6dd3a8"];
  const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? "–" : v.toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });

  async function setup(root) {
    if (root.dataset.ssvWired) return;
    root.dataset.ssvWired = "1";
    const q = (s) => root.querySelector(s);
    const url = root.dataset.url, fps = parseFloat(root.dataset.fps) || 25, frames = parseInt(root.dataset.frames, 10) || 1;
    // Modo estático (demo exportada): cuadros y detecciones precomputados, descritos en un manifiesto
    const ESTATICO = document.querySelector('meta[name="salmo-static"]')?.content;
    const videoId = (url.match(/videos\/([\w-]+)\/frame/) || [])[1];
    let manifiesto = null;
    if (ESTATICO && videoId) {
      try { manifiesto = await (await fetch(`${ESTATICO}data/videos/${videoId}/manifiesto.json`)).json(); } catch (e) { manifiesto = null; }
    }
    const W0 = parseInt(root.dataset.width, 10), H0 = parseInt(root.dataset.height, 10);
    const img = q("[data-frame]"), svg = q("[data-overlay]"), hud = q("[data-hud]");
    const modelSel = q("[data-model]"), classesField = q("[data-classes-field]"), classesIn = q("input[data-classes]");
    const confIn = q("input[data-conf]"), confOut = q("[data-conf-out]"), stepSel = q("[data-step]");
    const play = q("[data-play]"), prev = q("[data-prev]"), next = q("[data-next]"), time = q("[data-time]"), clock = q("[data-clock]");
    const out = { n: q("[data-n]"), ms: q("[data-ms]"), fps: q("[data-fps-out]"), mean: q("[data-conf-mean]"), max: q("[data-conf-max]"), total: q("[data-total]") };
    const hist = q("[data-hist]"), dets = q("[data-dets]"), detsNote = q("[data-dets-note]"), legend = q("[data-legend]");
    const gtToggle = q("input[data-gt]"), gtN = q("[data-gt-n]"), gtHit = q("[data-gt-hit]");
    const figure = q("[data-viewer]");
    const iou = (a, b) => {
      const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
      const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
      return ua > 0 ? inter / ua : 0;
    };

    const st = { index: 0, playing: false, busy: false, total: 0, shown: [], classColor: new Map(), seq: 0 };
    const color = (cls) => {
      if (!st.classColor.has(cls)) st.classColor.set(cls, COLORS[st.classColor.size % COLORS.length]);
      return st.classColor.get(cls);
    };

    function syncModel() {
      const opt = modelSel.selectedOptions[0];
      const isWorld = opt && opt.value === "world";
      classesField.hidden = !isWorld;
      if (opt && opt.dataset.defConf && !confIn.dataset.touched) { confIn.value = opt.dataset.defConf; confOut.textContent = fmt(parseFloat(opt.dataset.defConf), 2); }
      if (opt && opt.dataset.defClasses && isWorld && classesIn.value.trim() === "") classesIn.value = opt.dataset.defClasses;
    }

    function draw(res) {
      img.src = res.jpeg_url || ("data:image/jpeg;base64," + res.jpeg_b64);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const W = res.width || W0, H = res.height || H0;
      if (svg.getAttribute("viewBox") !== `0 0 ${W} ${H}`) { svg.setAttribute("viewBox", `0 0 ${W} ${H}`); figure.style.aspectRatio = `${W} / ${H}`; }
      const list = res.detections || [];
      const dense = list.length > 60;
      const sw = Math.max(W, H) / 600, fs = Math.max(W, H) / 48;
      const gt = res.gt || [];
      if (gtToggle && gtToggle.checked) {
        for (const g of gt) {
          const r = document.createElementNS(SVGNS, "rect");
          const [x1, y1, x2, y2] = g.box;
          r.setAttribute("x", x1); r.setAttribute("y", y1); r.setAttribute("width", x2 - x1); r.setAttribute("height", y2 - y1);
          r.setAttribute("class", "gt live");
          svg.appendChild(r);
        }
      }
      if (gtN) {
        gtN.textContent = gt.length;
        const hits = gt.filter((g) => list.some((d) => iou(g.box, d.box) >= 0.5)).length;
        gtHit.textContent = gt.length ? `${hits} (${Math.round(100 * hits / gt.length)} %)` : "–";
      }
      list.forEach((d, i) => {
        const c = color(d.cls);
        let el;
        if (d.obb) {
          el = document.createElementNS(SVGNS, "polygon");
          el.setAttribute("points", d.obb.map((p) => p.join(",")).join(" "));
        } else {
          el = document.createElementNS(SVGNS, "rect");
          const [x1, y1, x2, y2] = d.box;
          el.setAttribute("x", x1); el.setAttribute("y", y1); el.setAttribute("width", x2 - x1); el.setAttribute("height", y2 - y1);
        }
        el.setAttribute("class", "pred live");
        el.setAttribute("style", `stroke:${c};stroke-opacity:${0.45 + 0.55 * d.conf}`);
        svg.appendChild(el);
        const kp = (d.keypoints || []).filter((q) => q[2] >= 0.3);
        if (d.keypoints && d.keypoints.length) palitos(svg, d.keypoints, c, sw);
        if (dense && d.conf < 0.5) return;
        const t = document.createElementNS(SVGNS, "text");
        const [x1, y1] = d.box;
        t.setAttribute("x", x1 + sw * 3); t.setAttribute("y", Math.max(fs, y1 - sw * 5)); t.setAttribute("font-size", fs);
        t.setAttribute("class", "lbl pred live"); t.setAttribute("style", `fill:${c}`);
        t.textContent = `${d.cls} ${Math.round(d.conf * 100)}%`;
        svg.appendChild(t);
      });
      if (window.parent !== window) {   // dentro de un iframe (estanque 3D): avisar al padre
        try { window.parent.postMessage({ ssv: "deteccion", n: list.length, model: res.model, kind: res.kind || "video", t: res.t }, location.origin); } catch (e) { /* sin padre accesible */ }
      }
      // estadísticas
      const confs = list.map((d) => d.conf);
      out.n.textContent = list.length;
      out.ms.textContent = res.ms != null ? fmt(res.ms, 0) : "–";
      out.mean.textContent = confs.length ? Math.round(100 * confs.reduce((a, b) => a + b, 0) / confs.length) + " %" : "–";
      out.max.textContent = confs.length ? Math.round(100 * Math.max(...confs)) + " %" : "–";
      st.total += list.length; out.total.textContent = st.total.toLocaleString("es-CL");
      hud.textContent = `${res.model || "sin modelo"} · cuadro ${res.index} · ${fmt(res.t, 1)} s · ${list.length} detecciones`;
      // histograma 10 clases
      const bins = new Array(10).fill(0);
      confs.forEach((c) => bins[Math.min(9, Math.floor(c * 10))]++);
      const m = Math.max(1, ...bins);
      hist.innerHTML = bins.map((b, i) => `<div class="bar" style="height:${Math.round(100 * b / m)}%" title="${i * 10}–${i * 10 + 10} %: ${b}"><span>${b || ""}</span></div>`).join("");
      // tabla
      const top = list.slice().sort((a, b) => b.conf - a.conf).slice(0, 40);
      detsNote.textContent = list.length > 40 ? `(las 40 más probables de ${list.length})` : "";
      dets.innerHTML = top.map((d, i) => `<tr><td class="mono">#${i + 1}</td><td><i class="sw" style="border:2px solid ${color(d.cls)}"></i>${d.cls}</td><td class="n mono">${Math.round(d.conf * 100)} %</td><td class="n mono">${Math.round(d.box[2] - d.box[0])}×${Math.round(d.box[3] - d.box[1])}</td><td>${d.edge_cut ? '<span class="pill warn">cortado</span>' : ""}</td></tr>`).join("");
      legend.innerHTML = (gtToggle ? '<span><i class="sw sw-gt"></i>etiqueta del dataset</span>' : "") + [...st.classColor].map(([k, c]) => `<span><i class="sw" style="border:2px solid ${c}"></i>${k} (modelo)</span>`).join("") + '<span class="muted">el trazo es más sólido cuanto mayor la probabilidad</span>';
    }

    async function load(index) {
      if (st.busy) return false;
      st.busy = true;
      const seq = ++st.seq;
      const p = new URLSearchParams({ index, model: modelSel.value, conf: confIn.value, max_w: parseInt(root.dataset.maxW, 10) || 1280 });
      if (modelSel.value === "world") p.set("classes", classesIn.value);
      const t0 = performance.now();
      try {
        let r, j;
        if (manifiesto) {   // estático: el cuadro precomputado más cercano del modelo elegido (o del primero disponible)
          const modelos = Object.keys(manifiesto.modelos || {});
          const mid = manifiesto.modelos[modelSel.value] ? modelSel.value : modelos[0];
          const lista = manifiesto.modelos[mid].cuadros;
          const cercano = lista.reduce((a, b) => (Math.abs(b - index) < Math.abs(a - index) ? b : a), lista[0]);
          r = await fetch(`${ESTATICO}data/videos/${videoId}/${mid}/${cercano}.json`);
          j = await r.json();
          j.jpeg_b64 = null; j.jpeg_url = `${ESTATICO}data/videos/${videoId}/${mid}/${cercano}.jpg`;
        } else {
          r = await fetch(`${url}?${p}`, { headers: { Accept: "application/json" } });
          j = await r.json();
        }
        if (!r.ok) throw new Error(j.error || j.detail || r.status);
        if (seq !== st.seq) return true;
        st.index = j.index; time.value = j.index; clock.textContent = `${fmt(j.t, 1)} s`;
        draw(j);
        st.shown.push(performance.now() - t0); if (st.shown.length > 10) st.shown.shift();
        const avg = st.shown.reduce((a, b) => a + b, 0) / st.shown.length;
        out.fps.textContent = fmt(1000 / avg, 1);
        return true;
      } catch (e) {
        hud.textContent = "No se pudo obtener el cuadro: " + e.message;
        return false;
      } finally { st.busy = false; }
    }

    async function loop() {
      while (st.playing) {
        const step = parseInt(stepSel.value, 10) || 1;
        let nextIdx = st.index + step;
        if (manifiesto) {   // estático: siguiente cuadro precomputado del modelo en uso
          const mid = manifiesto.modelos[modelSel.value] ? modelSel.value : Object.keys(manifiesto.modelos)[0];
          const lista = manifiesto.modelos[mid].cuadros;
          const pos = lista.findIndex((v) => v > st.index);
          nextIdx = pos === -1 ? lista[0] : lista[pos];
        }
        if (nextIdx >= frames) nextIdx = 0;          // al llegar al final vuelve a empezar (bucle continuo)
        const ok = await load(nextIdx);
        if (!ok) { stop(); break; }
      }
    }
    const compact = root.dataset.compact === "1";
    function start() { if (st.playing) return; st.playing = true; play.textContent = compact ? "❚❚" : "❚❚ Pausar"; loop(); }
    function stop() { st.playing = false; play.textContent = compact ? "▶" : "▶ Reproducir"; }

    play.addEventListener("click", () => (st.playing ? stop() : start()));
    prev.addEventListener("click", () => { stop(); load(Math.max(0, st.index - (parseInt(stepSel.value, 10) || 1))); });
    next.addEventListener("click", () => { stop(); load(Math.min(frames - 1, st.index + (parseInt(stepSel.value, 10) || 1))); });
    time.addEventListener("change", () => { stop(); load(parseInt(time.value, 10)); });
    time.addEventListener("input", () => { clock.textContent = `${fmt(parseInt(time.value, 10) / fps, 1)} s`; });
    confIn.addEventListener("input", () => { confIn.dataset.touched = "1"; confOut.textContent = fmt(parseFloat(confIn.value), 2); });
    confIn.addEventListener("change", () => { if (!st.playing) load(st.index); });
    modelSel.addEventListener("change", () => { delete confIn.dataset.touched; syncModel(); st.classColor.clear(); if (!st.playing) load(st.index); });
    classesIn.addEventListener("change", () => { if (!st.playing) load(st.index); });
    if (gtToggle) gtToggle.addEventListener("change", () => { if (!st.playing) load(st.index); });
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, select, textarea")) return;
      if (e.code === "Space") { e.preventDefault(); play.click(); }
      if (e.code === "ArrowLeft") prev.click();
      if (e.code === "ArrowRight") next.click();
    });

    // Pausar cuando la pestaña o el recuadro no se ven (no gastar GPU de fondo); reanudar al volver.
    const pausar = (motivo) => { if (st.playing) { st.reanudar = motivo; stop(); } };
    const reanudar = (motivo) => { if (st.reanudar === motivo) { st.reanudar = null; start(); } };
    document.addEventListener("visibilitychange", () => (document.hidden ? pausar("oculto") : reanudar("oculto")));
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? reanudar("fuera") : pausar("fuera"))), { threshold: 0.1 }).observe(root);
    }

    syncModel();
    load(0).then((ok) => { if (ok && root.dataset.autoplay === "1") start(); });
  }

  function init() { document.querySelectorAll(".ssv [data-video-player]").forEach(setup); }
  document.addEventListener("DOMContentLoaded", init);
  document.addEventListener("turbo:load", init);
  if (document.readyState !== "loading") init();
})();
