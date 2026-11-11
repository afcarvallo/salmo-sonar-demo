// Visor de SalmoSonar: capas (etiquetas, predicciones, puntos), atención EigenCAM coloreada
// y predicción en vivo contra el servicio de visión.
(() => {
  "use strict";
  const STOPS = [[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]];
  const LUT = Array.from({ length: 256 }, (_, i) => {
    const t = i / 255 * (STOPS.length - 1), k = Math.min(Math.floor(t), STOPS.length - 2), f = t - k;
    return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
  });

  function colorize(canvas, img, alpha = 0.6) {
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = d.data[i], c = LUT[v];
      d.data[i] = c[0]; d.data[i + 1] = c[1]; d.data[i + 2] = c[2];
      d.data[i + 3] = Math.round(255 * alpha * Math.pow(v / 255, 0.7));
    }
    ctx.putImageData(d, 0, 0);
  }

  function loadAttention(canvas, src) {
    if (canvas.dataset.loaded) return;
    const img = new Image();
    img.onload = () => { colorize(canvas, img); canvas.dataset.loaded = "1"; };
    img.src = src;
  }

  function wire(root) {
    if (root.dataset.ssvWired) return;
    root.dataset.ssvWired = "1";
    const viewer = root.querySelector("[data-viewer]");
    const controls = root.querySelector("[data-controls]");
    if (!viewer || !controls) return;
    controls.querySelectorAll("input[data-layer]").forEach((input) => {
      const apply = () => {
        const layer = input.dataset.layer;
        if (layer === "attention") {
          const c = viewer.querySelector("canvas.attention");
          if (!c) return;
          c.hidden = !input.checked;
          if (input.checked && c.dataset.attentionSrc) loadAttention(c, c.dataset.attentionSrc);
        } else {
          viewer.classList.toggle("hide-" + layer, !input.checked);
        }
      };
      input.addEventListener("change", apply);
      apply();
    });
  }

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

  function drawLive(viewer, res) {
    const svg = viewer.querySelector("svg.overlay");
    svg.querySelectorAll(".live").forEach((n) => n.remove());
    const vb = (svg.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
    const W = vb[2] || res.width || 1, H = vb[3] || res.height || 1;
    const sw = Math.max(W, H) / 600, fs = Math.max(W, H) / 48;
    const list = res.detections || [];
    const dense = list.length > 60;
    for (const d of list) {
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
      el.setAttribute("style", `stroke-opacity:${0.45 + 0.55 * d.conf}`);
      svg.appendChild(el);
      if (d.keypoints && d.keypoints.length) palitos(svg, d.keypoints, "#c7fbf9", sw);
      if (dense && d.conf < 0.5) continue;
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("x", d.box[0] + sw * 3); t.setAttribute("y", Math.max(fs, d.box[1] - sw * 5)); t.setAttribute("font-size", fs);
      t.setAttribute("class", "lbl pred live");
      t.textContent = `${d.cls} ${Math.round(d.conf * 100)}%`;
      svg.appendChild(t);
    }
    if (res.attention && res.attention.heatmap_png) {
      let c = viewer.querySelector("canvas.attention");
      if (!c) { c = document.createElement("canvas"); c.className = "attention"; viewer.insertBefore(c, svg); }
      const img = new Image();
      img.onload = () => { colorize(c, img); c.hidden = false; };
      img.src = "data:image/png;base64," + res.attention.heatmap_png;
    }
  }

  function wirePredict(panel) {
    const btn = panel.querySelector("[data-predict]"), msg = panel.querySelector("[data-predict-msg]");
    const viewer = panel.closest(".ssv")?.querySelector("[data-viewer]");
    if (!btn || !viewer || panel.dataset.ssvWired) return;
    panel.dataset.ssvWired = "1";
    if (document.querySelector('meta[name="salmo-static"]')) { btn.disabled = true; msg.textContent = "Demo estática: la predicción en vivo necesita el servicio con GPU; los resultados guardados sí se muestran."; return; }
    const modelSel = panel.querySelector("[data-predict-model]"), confIn = panel.querySelector("[data-predict-conf]");
    const confOut = panel.querySelector("[data-predict-conf-out]"), classesField = panel.querySelector("[data-predict-classes-field]");
    const classesIn = panel.querySelector("[data-predict-classes]"), attIn = panel.querySelector("[data-predict-attention]");
    const fmt2 = (v) => Number(v).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (modelSel) {
      modelSel.addEventListener("change", () => {
        const o = modelSel.selectedOptions[0];
        if (classesField) classesField.hidden = o.value !== "world";
        if (o.dataset.defConf && confIn) { confIn.value = o.dataset.defConf; if (confOut) confOut.textContent = fmt2(o.dataset.defConf); }
      });
    }
    if (confIn && confOut) confIn.addEventListener("input", () => { confOut.textContent = fmt2(confIn.value); });
    btn.addEventListener("click", async () => {
      btn.disabled = true; msg.textContent = "Enviando la imagen al servicio de visión…";
      try {
        const token = document.querySelector('meta[name="csrf-token"]')?.content;
        const body = new FormData();
        if (modelSel) { body.set("model", modelSel.value); body.set("conf", confIn ? confIn.value : ""); if (modelSel.value === "world" && classesIn) body.set("classes", classesIn.value); }
        body.set("attention", attIn && !attIn.checked ? "0" : "1");
        const r = await fetch(panel.dataset.url, { method: "POST", body, headers: { "X-CSRF-Token": token, Accept: "application/json" } });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        drawLive(viewer, j);
        viewer.classList.remove("hide-pred");
        const share = j.attention ? ` · ${Math.round(j.attention.share_in_boxes * 100)} % de la atención dentro de las cajas` : "";
        const confs = j.detections.map((d) => d.conf);
        const mean = confs.length ? ` · probabilidad media ${Math.round(100 * confs.reduce((a, b) => a + b, 0) / confs.length)} %, máxima ${Math.round(100 * Math.max(...confs))} %` : "";
        msg.textContent = `${j.detections.length} detecciones con ${j.model} en ${Math.round(j.ms)} ms${mean}${share}.`;
      } catch (e) {
        msg.textContent = "No se pudo predecir: " + e.message;
      } finally { btn.disabled = false; }
    });
  }

  // Funciona con carga normal y con Turbo (la app anfitriona puede usarlo).
  function init() {
    document.querySelectorAll(".ssv .col, .ssv.embed").forEach(wire);
    document.querySelectorAll(".ssv [data-live-predict]").forEach(wirePredict);
  }
  document.addEventListener("DOMContentLoaded", init);
  document.addEventListener("turbo:load", init);
  if (document.readyState !== "loading") init();
})();
