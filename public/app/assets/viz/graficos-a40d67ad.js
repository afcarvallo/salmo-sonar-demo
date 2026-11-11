import * as d3 from "d3"
import { rampaAlimento, rampaDivergente, tintaSobre, token } from "viz/colores"
import { fmtN, fmtFecha, fmtDia } from "viz/formato"

// ── utilidades ──────────────────────────────────────────────────────────────
function lienzo(el, alto, m = { t: 10, r: 12, b: 26, l: 44 }) {
  const ancho = el.clientWidth || 320
  d3.select(el).selectAll("svg, .tooltip").remove()
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${ancho} ${alto}`).attr("height", alto)
  const tip = d3.select(el).append("div").attr("class", "tooltip").attr("hidden", true)
  return { svg, tip, ancho, alto, m, iw: ancho - m.l - m.r, ih: alto - m.t - m.b, g: svg.append("g").attr("transform", `translate(${m.l},${m.t})`) }
}

function mostrarTip(tip, el, ev, html) {
  const [x, y] = d3.pointer(ev, el)
  tip.attr("hidden", null).html(html)
  const w = tip.node().offsetWidth
  tip.style("left", `${Math.min(Math.max(0, x + 12), el.clientWidth - w)}px`).style("top", `${Math.max(0, y - 46)}px`)
}

const loc = (n) => (v) => fmtN(v, n)

// ── histograma de peso (una serie) ──────────────────────────────────────────
export function histograma(el, escaneo) {
  const { svg, tip, g, iw, ih } = lienzo(el, 190, { t: 12, r: 10, b: 30, l: 44 })
  const bins = escaneo.histograma
  const N = escaneo.peces_estimados
  const x = d3.scaleLinear().domain([bins[0].desde, bins.at(-1).hasta]).range([0, iw])
  const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.frac * N)]).nice().range([ih, 0])
  g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(4).tickSize(-iw).tickFormat((v) => fmtN(v / 1000, 0) + " mil"))
  g.append("g").attr("class", "eje").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickFormat(loc(0)))
  g.append("text").attr("x", iw).attr("y", ih + 26).attr("text-anchor", "end").text("peso (g)")
  const color = token("--series-1")
  g.selectAll("path.barra").data(bins).join("path").attr("class", "barra")
    .attr("fill", color)
    .attr("d", (b) => {
      const x0 = x(b.desde) + 1, x1 = x(b.hasta) - 1, y0 = y(b.frac * N), r = Math.min(3, (x1 - x0) / 2, ih - y0)
      return `M${x0},${ih}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x1 - r}Q${x1},${y0} ${x1},${y0 + r}V${ih}Z`
    })
  // zonas de hover más grandes que la barra
  g.selectAll("rect.hit").data(bins).join("rect").attr("class", "hit")
    .attr("x", (b) => x(b.desde)).attr("width", (b) => x(b.hasta) - x(b.desde)).attr("y", 0).attr("height", ih).attr("fill", "transparent")
    .on("mousemove", (ev, b) => mostrarTip(tip, el, ev, `<div class="t">${fmtN(b.desde, 0)}–${fmtN(b.hasta, 0)} g</div><b>${fmtN(b.frac * N, 0)}</b> peces (${fmtN(b.frac * 100, 1)} %)`))
    .on("mouseleave", () => tip.attr("hidden", true))
  const xm = x(escaneo.peso_medio_g)
  g.append("line").attr("x1", xm).attr("x2", xm).attr("y1", 0).attr("y2", ih).attr("stroke", token("--text-primary")).attr("stroke-dasharray", "3 3")
  g.append("text").attr("class", "valor").attr("x", xm + 4).attr("y", 8).text(`media ${fmtN(escaneo.peso_medio_g, 0)} g`)
}

// ── fondo visto desde arriba ────────────────────────────────────────────────
export function fondoSuperior(el, nube, kgM2Max, { mini = false, alClic = null } = {}) {
  const lado = mini ? el.clientWidth || 180 : Math.min(el.clientWidth || 320, 320)
  const { svg, tip, g } = lienzo(el, lado, { t: 0, r: 0, b: 0, l: 0 })
  svg.attr("viewBox", `0 0 ${lado} ${lado}`).attr("width", lado)
  const R = nube.estanque.radio_m
  const s = d3.scaleLinear().domain([-R, R]).range([4, lado - 4])
  const k = (lado - 8) / (2 * R)
  const color = rampaAlimento(kgM2Max)
  const a = nube.fondo.lado_m * k
  const hexPath = (c) => d3.range(6).map((i) => {
    const ang = Math.PI / 6 + (i * Math.PI) / 3
    return `${i ? "L" : "M"}${s(c.x) + a * Math.cos(ang)},${s(-c.y) - a * Math.sin(ang)}`
  }).join("") + "Z"
  const clip = `c${Math.random().toString(36).slice(2)}`
  svg.append("clipPath").attr("id", clip).append("circle").attr("cx", s(0)).attr("cy", s(0)).attr("r", R * k)
  g.append("circle").attr("cx", s(0)).attr("cy", s(0)).attr("r", R * k).attr("fill", token("--surface-2"))
  g.append("g").attr("clip-path", `url(#${clip})`).selectAll("path.hex").data(nube.fondo.celdas).join("path").attr("class", "hex")
    .attr("d", hexPath).attr("fill", (c) => color(c.kg_m2)).attr("stroke", token("--surface-1")).attr("stroke-width", mini ? 0.3 : 0.6)
    .on("mousemove", mini ? null : (ev, c) => mostrarTip(tip, el, ev, `<div class="t">x ${fmtN(c.x, 1)} m · y ${fmtN(c.y, 1)} m · r ${fmtN(Math.hypot(c.x, c.y), 1)} m</div><b>${fmtN(c.kg_m2 * 1000, 0)} g/m²</b> de pellet`))
    .on("mouseleave", mini ? null : () => tip.attr("hidden", true))
    .on("click", alClic ? (ev, c) => alClic(c.x, c.y) : null)
    .style("cursor", alClic ? "pointer" : null)
  g.append("circle").attr("cx", s(0)).attr("cy", s(0)).attr("r", R * k).attr("fill", "none").attr("stroke", token("--axis"))
  g.append("circle").attr("cx", s(0)).attr("cy", s(0)).attr("r", 3).attr("fill", "none").attr("stroke", token("--text-secondary")).attr("stroke-width", 1.5)
  if (!mini) {
    g.append("text").attr("x", s(0) + 6).attr("y", s(0) - 6).text("dren")
    const total = d3.sum(nube.fondo.celdas, (c) => c.kg_m2) * nube.fondo.area_m2
    g.append("text").attr("class", "titulo").attr("x", 2).attr("y", 14).text(`${fmtN(total, 1)} kg en total`)
    g.append("text").attr("x", lado - 2).attr("y", lado - 4).attr("text-anchor", "end").text(`Ø ${fmtN(2 * R, 0)} m`)
  }
}

// ── perfil vertical de ecos ────────────────────────────────────────────────
export function perfil(el, nube) {
  const D = nube.estanque.z_centro_m
  const { tip, g, iw, ih } = lienzo(el, 170, { t: 8, r: 14, b: 26, l: 40 })
  const paso = D > 4 ? 0.25 : 0.15
  const bins = d3.bin().domain([0, D]).thresholds(d3.range(0, D, paso))(nube.peces.map((f) => f.z))
  const factor = nube.peces_por_eco
  const y = d3.scaleLinear().domain([0, D]).range([0, ih])
  const x = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.length * factor)]).nice().range([0, iw])
  g.append("g").attr("class", "grid").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(4).tickSize(-ih).tickFormat((v) => fmtN(v / 1000, 0) + " mil"))
  g.append("g").attr("class", "eje").call(d3.axisLeft(y).ticks(D > 4 ? 5 : 3).tickFormat((v) => `${fmtN(v, 0)} m`))
  g.selectAll("path.barra").data(bins).join("path").attr("fill", token("--series-1"))
    .attr("d", (b) => {
      const y0 = y(b.x0) + 1, y1 = y(b.x1) - 1, w = x(b.length * factor), r = Math.min(3, w, (y1 - y0) / 2)
      return `M0,${y0}H${w - r}Q${w},${y0} ${w},${y0 + r}V${y1 - r}Q${w},${y1} ${w - r},${y1}H0Z`
    })
  g.selectAll("rect.hit").data(bins).join("rect").attr("x", 0).attr("width", iw).attr("y", (b) => y(b.x0)).attr("height", (b) => y(b.x1) - y(b.x0)).attr("fill", "transparent")
    .on("mousemove", (ev, b) => mostrarTip(tip, el, ev, `<div class="t">${fmtN(b.x0, 2)}–${fmtN(b.x1, 2)} m</div>≈ <b>${fmtN(b.length * factor, 0)}</b> peces`))
    .on("mouseleave", () => tip.attr("hidden", true))
  const zm = d3.mean(nube.peces, (f) => f.z)
  g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(zm)).attr("y2", y(zm)).attr("stroke", token("--text-primary")).attr("stroke-dasharray", "3 3")
  g.append("text").attr("class", "valor").attr("x", iw).attr("y", y(zm) - 4).attr("text-anchor", "end").text(`centro ${fmtN(zm, 1)} m`)
}

// ── small multiples con cursor sincronizado ────────────────────────────────
// defs: [{clave, titulo, unidad, dec, datos:[{t, v}], banda:[a,b]|null}]
export function series(el, defs, tEscaneos, iSel, alSeleccionar) {
  d3.select(el).selectAll("*").remove()
  const dominio = d3.extent(tEscaneos)
  const conts = defs.map(() => d3.select(el).append("div").attr("class", "grafico").node())
  const charts = defs.map((def, n) => {
    const cont = conts[n]
    const { svg, tip, g, iw, ih } = lienzo(cont, 128, { t: 22, r: 12, b: 22, l: 46 })
    const x = d3.scaleTime().domain(dominio).range([0, iw])
    const vals = def.datos.filter((d) => d.v != null)
    const ext = d3.extent([...vals.map((d) => d.v), ...(def.banda || []).filter((v) => v != null && Math.abs(v) < 1e6)])
    const y = d3.scaleLinear().domain(ext).nice(4).range([ih, 0])
    svg.append("text").attr("class", "titulo").attr("x", 46).attr("y", 13).text(`${def.titulo}${def.unidad ? ` (${def.unidad})` : ""}`)
    if (def.banda) {
      const [a, b] = def.banda.map((v, i) => (v == null ? y.domain()[i] : Math.max(y.domain()[0], Math.min(y.domain()[1], v))))
      g.append("rect").attr("x", 0).attr("width", iw).attr("y", y(b)).attr("height", Math.max(0, y(a) - y(b))).attr("fill", token("--band"))
    }
    g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(3).tickSize(-iw).tickFormat(loc(def.dec)))
    g.append("g").attr("class", "eje").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickFormat(fmtDia))
    g.append("path").datum(def.datos).attr("fill", "none").attr("stroke", token("--series-1")).attr("stroke-width", 2).attr("stroke-linejoin", "round")
      .attr("d", d3.line().defined((d) => d.v != null).x((d) => x(d.t)).y((d) => y(d.v)))
    const sel = g.append("line").attr("class", "sel").attr("y1", 0).attr("y2", ih).attr("stroke", token("--text-primary")).attr("stroke-width", 1)
    const cruz = g.append("line").attr("y1", 0).attr("y2", ih).attr("stroke", token("--muted")).attr("stroke-dasharray", "2 3").attr("visibility", "hidden")
    const punto = g.append("circle").attr("r", 4).attr("fill", token("--series-1")).attr("stroke", token("--surface-1")).attr("stroke-width", 2).attr("visibility", "hidden")
    const bis = d3.bisector((d) => d.t).center
    g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent").style("cursor", "pointer")
      .on("mousemove", (ev) => moverCursor(x.invert(d3.pointer(ev)[0]), ev))
      .on("mouseleave", () => charts.forEach((c) => c.ocultar()))
      .on("click", (ev) => alSeleccionar(d3.bisector((t) => t).center(tEscaneos, x.invert(d3.pointer(ev)[0]))))
    return {
      x, mover(t, ev) {
        const d = def.datos[bis(def.datos, t)]
        cruz.attr("x1", x(t)).attr("x2", x(t)).attr("visibility", "visible")
        if (!d || d.v == null) { punto.attr("visibility", "hidden"); tip.attr("hidden", true); return }
        punto.attr("cx", x(d.t)).attr("cy", y(d.v)).attr("visibility", "visible")
        tip.attr("hidden", null).html(`<div class="t">${fmtFecha(d.t)}</div><b>${fmtN(d.v, def.dec)}</b> ${def.unidad}`)
        const w = tip.node().offsetWidth
        tip.style("left", `${Math.min(cont.clientWidth - w, Math.max(0, 46 + x(d.t) + 10))}px`).style("top", "0px")
      },
      ocultar() { cruz.attr("visibility", "hidden"); punto.attr("visibility", "hidden"); tip.attr("hidden", true) },
      seleccionar(t) { sel.attr("x1", x(t)).attr("x2", x(t)) },
    }
  })
  function moverCursor(t) { charts.forEach((c) => c.mover(t)) }
  const api = { seleccionar: (i) => charts.forEach((c) => c.seleccionar(tEscaneos[i])) }
  api.seleccionar(iSel)
  return api
}

// ── dispersión con recta de regresión ──────────────────────────────────────
export function dispersion(el, puntos, defX, defY, iSel, alSeleccionar) {
  const { svg, tip, g, iw, ih } = lienzo(el, 300, { t: 24, r: 16, b: 38, l: 50 })
  const pts = puntos.filter((p) => p.x != null && p.y != null)
  const x = d3.scaleLinear().domain(d3.extent(pts, (p) => p.x)).nice().range([0, iw])
  const y = d3.scaleLinear().domain(d3.extent(pts, (p) => p.y)).nice().range([ih, 0])
  g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(loc(defY.dec)))
  g.append("g").attr("class", "eje").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickFormat(loc(defX.dec)))
  g.append("text").attr("x", iw).attr("y", ih + 32).attr("text-anchor", "end").text(`${defX.titulo}${defX.unidad ? ` (${defX.unidad})` : ""}`)
  g.append("text").attr("x", -40).attr("y", -12).text(`${defY.titulo}${defY.unidad ? ` (${defY.unidad})` : ""}`)
  if (defX.banda) {
    const [a, b] = defX.banda.map((v, i) => (v == null ? x.domain()[i] : Math.max(x.domain()[0], Math.min(x.domain()[1], v))))
    g.insert("rect", ":first-child").attr("x", x(a)).attr("width", Math.max(0, x(b) - x(a))).attr("y", 0).attr("height", ih).attr("fill", token("--band"))
  }
  const r = regresion(pts)
  if (r) {
    const [x0, x1] = x.domain()
    const id = `r${Math.random().toString(36).slice(2)}`
    svg.append("clipPath").attr("id", id).append("rect").attr("width", iw).attr("height", ih)
    g.append("line").attr("clip-path", `url(#${id})`).attr("x1", x(x0)).attr("x2", x(x1)).attr("y1", y(r.a + r.b * x0)).attr("y2", y(r.a + r.b * x1))
      .attr("stroke", token("--text-secondary")).attr("stroke-width", 1.5).attr("stroke-dasharray", "5 4")
  }
  g.selectAll("circle.p").data(pts).join("circle").attr("class", "p")
    .attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y)).attr("r", 4)
    .attr("fill", token("--series-1")).attr("fill-opacity", 0.55).attr("stroke", token("--surface-1")).attr("stroke-width", 1)
  if (pts.some((p) => p.i === iSel)) {
    const p = pts.find((q) => q.i === iSel)
    g.append("circle").attr("cx", x(p.x)).attr("cy", y(p.y)).attr("r", 7).attr("fill", "none").attr("stroke", token("--text-primary")).attr("stroke-width", 2)
  }
  const delaunay = d3.Delaunay.from(pts, (p) => x(p.x), (p) => y(p.y))
  g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent").style("cursor", "pointer")
    .on("mousemove", (ev) => {
      const [mx, my] = d3.pointer(ev)
      const p = pts[delaunay.find(mx, my)]
      if (!p || Math.hypot(x(p.x) - mx, y(p.y) - my) > 20) return tip.attr("hidden", true)
      mostrarTip(tip, el, ev, `<div class="t">${fmtFecha(p.t)}</div>${defX.titulo}: <b>${fmtN(p.x, defX.dec)}</b> ${defX.unidad}<br>${defY.titulo}: <b>${fmtN(p.y, defY.dec)}</b> ${defY.unidad}`)
    })
    .on("mouseleave", () => tip.attr("hidden", true))
    .on("click", (ev) => {
      const [mx, my] = d3.pointer(ev)
      const p = pts[delaunay.find(mx, my)]
      if (p) alSeleccionar(p.i)
    })
  return r
}

export function regresion(pts) {
  if (pts.length < 3) return null
  const mx = d3.mean(pts, (p) => p.x), my = d3.mean(pts, (p) => p.y)
  let sxy = 0, sxx = 0, syy = 0
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2 }
  if (!sxx || !syy) return null
  const b = sxy / sxx
  return { a: my - b * mx, b, r: sxy / Math.sqrt(sxx * syy), n: pts.length }
}

// ── matriz de correlación (divergente) ─────────────────────────────────────
export function correlaciones(el, vars, filas) {
  const n = vars.length
  const ancho = el.clientWidth || 360
  const m = { t: 8, r: 8, b: 8, l: 120 }
  const celda = Math.min(46, (ancho - m.l - m.r) / n)
  const { tip, g } = lienzo(el, m.t + celda * n + 92, m)
  const color = rampaDivergente()
  const datos = []
  vars.forEach((a, i) => vars.forEach((b, j) => {
    const pts = filas.map((f) => ({ x: f[a.clave], y: f[b.clave] })).filter((p) => p.x != null && p.y != null)
    datos.push({ i, j, a, b, r: i === j ? 1 : regresion(pts)?.r ?? 0 })
  }))
  g.selectAll("rect").data(datos).join("rect")
    .attr("x", (d) => d.j * celda + 1).attr("y", (d) => d.i * celda + 1).attr("width", celda - 2).attr("height", celda - 2).attr("rx", 3)
    .attr("fill", (d) => color(d.r))
    .on("mousemove", (ev, d) => mostrarTip(tip, el, ev, `<div class="t">${d.a.titulo} × ${d.b.titulo}</div>r = <b>${fmtN(d.r, 2)}</b>`))
    .on("mouseleave", () => tip.attr("hidden", true))
  g.selectAll("text.v").data(datos).join("text").attr("class", "v")
    .attr("x", (d) => d.j * celda + celda / 2).attr("y", (d) => d.i * celda + celda / 2 + 4).attr("text-anchor", "middle")
    .style("fill", (d) => tintaSobre(color(d.r))).style("font-size", celda < 36 ? "9.5px" : "11px").style("pointer-events", "none")
    .text((d) => fmtN(d.r, 2))
  g.selectAll("text.f").data(vars).join("text").attr("class", "f")
    .attr("x", -6).attr("y", (_, i) => i * celda + celda / 2 + 4).attr("text-anchor", "end").text((v) => v.corto)
  g.selectAll("text.c").data(vars).join("text").attr("class", "c")
    .attr("transform", (_, j) => `translate(${j * celda + celda / 2},${n * celda + 6}) rotate(-50)`).attr("text-anchor", "end").text((v) => v.corto)
}

// ── correlación cruzada: filas = métricas de peces/alimento, columnas = agua ──
// Clic en una celda → alSeleccionar(fila, columna). La celda elegida va con anillo.
export function correlacionCruzada(el, filasVars, colVars, datos, sel, alSeleccionar) {
  const ancho = el.clientWidth || 600
  const m = { t: 8, r: 8, b: 8, l: 150 }
  const celda = Math.max(30, Math.min(64, (ancho - m.l - m.r) / colVars.length))
  const alto = celda * 0.72
  const { tip, g } = lienzo(el, m.t + alto * filasVars.length + 90, m)
  const color = rampaDivergente()
  const cel = []
  filasVars.forEach((f, i) => colVars.forEach((c, j) => {
    const pts = datos.map((d) => ({ x: d[c.clave], y: d[f.clave] })).filter((p) => p.x != null && p.y != null && isFinite(p.x) && isFinite(p.y))
    const r = regresion(pts)
    cel.push({ i, j, f, c, r: r?.r ?? 0, n: pts.length })
  }))
  g.selectAll("rect").data(cel).join("rect")
    .attr("x", (d) => d.j * celda + 1).attr("y", (d) => d.i * alto + 1).attr("width", celda - 2).attr("height", alto - 2).attr("rx", 3)
    .attr("fill", (d) => color(d.r)).style("cursor", "pointer")
    .attr("stroke", (d) => (sel && d.f.clave === sel[0] && d.c.clave === sel[1] ? token("--text-primary") : "none")).attr("stroke-width", 2)
    .on("mousemove", (ev, d) => mostrarTip(tip, el, ev, `<div class="t">${d.f.titulo} × ${d.c.titulo}</div>r = <b>${fmtN(d.r, 2)}</b> · ${d.n} días`))
    .on("mouseleave", () => tip.attr("hidden", true))
    .on("click", (ev, d) => alSeleccionar(d.f.clave, d.c.clave))
  g.selectAll("text.v").data(cel).join("text").attr("class", "v")
    .attr("x", (d) => d.j * celda + celda / 2).attr("y", (d) => d.i * alto + alto / 2 + 4).attr("text-anchor", "middle")
    .style("fill", (d) => tintaSobre(color(d.r))).style("font-size", celda < 40 ? "9.5px" : "11px").style("pointer-events", "none")
    .text((d) => fmtN(d.r, 2))
  g.selectAll("text.f").data(filasVars).join("text").attr("class", "f")
    .attr("x", -6).attr("y", (_, i) => i * alto + alto / 2 + 4).attr("text-anchor", "end").text((v) => v.corto)
  g.selectAll("text.c").data(colVars).join("text").attr("class", "c")
    .attr("transform", (_, j) => `translate(${j * celda + celda / 2},${filasVars.length * alto + 6}) rotate(-45)`).attr("text-anchor", "end").text((v) => v.corto)
}
