import * as d3 from "d3"
import { Sonar3D } from "viz/sonar3d"
import * as G from "viz/graficos"
import { ESTADOS } from "viz/colores"
import { fmtN, fmtFecha } from "viz/formato"

// Variables cruzables (agua promediada en las 3 h previas a cada escaneo)
const VARS = {
  oxigeno_mg_l: { titulo: "Oxígeno disuelto", corto: "O₂", unidad: "mg/L", dec: 1 },
  temperatura_c: { titulo: "Temperatura", corto: "Temperatura", unidad: "°C", dec: 1 },
  ph: { titulo: "pH", corto: "pH", unidad: "", dec: 2 },
  nh3_mg_l: { titulo: "NH₃ no ionizado", corto: "NH₃", unidad: "mg/L", dec: 4 },
  co2_mg_l: { titulo: "CO₂", corto: "CO₂", unidad: "mg/L", dec: 1 },
  turbidez_ntu: { titulo: "Turbidez", corto: "Turbidez", unidad: "NTU", dec: 1 },
  no_consumido_pct: { titulo: "Alimento no consumido", corto: "% no consumido", unidad: "%", dec: 1 },
  alimento_fondo_kg: { titulo: "Alimento en el fondo", corto: "Alim. en fondo", unidad: "kg", dec: 1 },
  profundidad_media_m: { titulo: "Profundidad del cardumen", corto: "Prof. cardumen", unidad: "m", dec: 2 },
}
// Métricas diarias (filas) y agua diaria (columnas) del análisis por día
const DIA_PECES = {
  sgr: { titulo: "Tasa de crecimiento (SGR)", corto: "SGR %/día", unidad: "%/día", dec: 2 },
  crec_g: { titulo: "Crecimiento", corto: "Crecimiento g/día", unidad: "g/día", dec: 2 },
  fcr: { titulo: "Conversión de alimento (FCR)", corto: "FCR", unidad: "kg/kg", dec: 2 },
  nc_pct: { titulo: "Alimento no consumido", corto: "% no consumido", unidad: "%", dec: 1 },
  fondo_kg: { titulo: "Alimento en el fondo (media)", corto: "Alim. en fondo kg", unidad: "kg", dec: 1 },
  prof: { titulo: "Profundidad del cardumen", corto: "Prof. cardumen m", unidad: "m", dec: 2 },
  peso: { titulo: "Peso medio", corto: "Peso medio g ⚠", unidad: "g", dec: 1 },
}
const DIA_AGUA = {
  o2_med: { titulo: "O₂ medio", corto: "O₂ medio", unidad: "mg/L", dec: 2, base: "oxigeno_mg_l", f: d3.mean },
  o2_min: { titulo: "O₂ mínimo", corto: "O₂ mín", unidad: "mg/L", dec: 2, base: "oxigeno_mg_l", f: d3.min },
  t_med: { titulo: "Temperatura media", corto: "T° media", unidad: "°C", dec: 2, base: "temperatura_c", f: d3.mean },
  t_max: { titulo: "Temperatura máxima", corto: "T° máx", unidad: "°C", dec: 2, base: "temperatura_c", f: d3.max },
  ph_med: { titulo: "pH medio", corto: "pH medio", unidad: "", dec: 2, base: "ph", f: d3.mean },
  ph_min: { titulo: "pH mínimo", corto: "pH mín", unidad: "", dec: 2, base: "ph", f: d3.min },
  nh3_max: { titulo: "NH₃ máximo", corto: "NH₃ máx", unidad: "mg/L", dec: 4, base: "nh3_mg_l", f: d3.max },
  co2_med: { titulo: "CO₂ medio", corto: "CO₂ medio", unidad: "mg/L", dec: 1, base: "co2_mg_l", f: d3.mean },
  turb_med: { titulo: "Turbidez media", corto: "Turbidez", unidad: "NTU", dec: 2, base: "turbidez_ntu", f: d3.mean },
}

// Agrega por día calendario. La SGR sale de la pendiente de ln(peso) en una ventana
// centrada de 3 días (24 escaneos), que filtra el ruido de cada escaneo.
function agregarDias(esc, agua) {
  const dia = d3.timeDay.floor
  const aguaDia = d3.group(agua, (a) => +dia(a.t))
  const dias = []
  for (const [k, lecturas] of aguaDia) {
    if (lecturas.length < 20) continue
    const t0 = new Date(k), centro = +t0 + 12 * 3600e3
    const enDia = esc.filter((s) => s.t >= t0 && s.t < +t0 + 86400e3)
    const ventana = esc.filter((s) => Math.abs(s.t - centro) <= 36 * 3600e3)
    if (enDia.length < 6 || ventana.length < 20) continue
    const pts = ventana.map((s) => ({ x: (s.t - centro) / 86400e3, y: Math.log(s.peso_medio_g) }))
    const mx = d3.mean(pts, (p) => p.x), my = d3.mean(pts, (p) => p.y)
    const pend = d3.sum(pts, (p) => (p.x - mx) * (p.y - my)) / d3.sum(pts, (p) => (p.x - mx) ** 2)
    const sgr = 100 * pend
    const peso = d3.mean(enDia, (s) => s.peso_medio_g)
    const biomasa = d3.mean(enDia, (s) => s.biomasa_kg)
    const entregado = d3.sum(enDia, (s) => s.alimento_entregado_kg)
    const noCom = d3.sum(enDia, (s) => s.no_consumido_kg)
    const ganancia = (biomasa * sgr) / 100
    const fcr = ganancia > 0 ? (entregado - noCom) / ganancia : null
    const fila = {
      t: new Date(centro), t0, sgr, peso, crec_g: (peso * sgr) / 100,
      fcr: fcr != null && fcr < 6 ? fcr : null,
      nc_pct: entregado > 0 ? (100 * noCom) / entregado : null,
      fondo_kg: d3.mean(enDia, (s) => s.alimento_fondo_kg),
      prof: d3.mean(enDia, (s) => s.profundidad_media_m),
      iScan: d3.minIndex(esc, (s) => Math.abs(s.t - centro)),
    }
    for (const [clave, v] of Object.entries(DIA_AGUA)) fila[clave] = v.f(lecturas, (a) => a[v.base])
    dias.push(fila)
  }
  return dias.sort((a, b) => a.t - b.t)
}

// Une la métrica de peces del día d con el agua del día d − desfase
function conDesfase(dias, desfase) {
  const porDia = new Map(dias.map((d) => [+d.t0, d]))
  return dias.map((d) => {
    const a = porDia.get(+d3.timeDay.offset(d.t0, -desfase))
    if (!a) return null
    const fila = { ...d }
    for (const clave of Object.keys(DIA_AGUA)) fila[clave] = a[clave]
    return fila
  }).filter(Boolean)
}

const AGUA = ["ph", "oxigeno_mg_l", "temperatura_c", "co2_mg_l", "tan_mg_l", "nh3_mg_l", "turbidez_ntu", "salinidad_ppt"]

export function montarEstanque(raiz) {
  const serie = JSON.parse(document.getElementById("datos-serie").textContent)
  const umbrales = JSON.parse(document.getElementById("datos-umbrales").textContent)
  const urlNube = raiz.dataset.nubeUrl
  // Modo estático (demo exportada): los JSON vienen precomputados y comprimidos; no hay servidor
  const ESTATICO = document.querySelector('meta[name="salmo-static"]')?.content
  const leerGz = (r) => new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json()
  const E = serie.estanque
  const volumen = E.volumen_m3

  // ── preparar datos
  const agua = serie.agua.map((a) => ({ ...a, t: new Date(a.tomado_en) }))
  const esc = serie.escaneos.map((s, i) => {
    const t = new Date(s.tomado_en)
    const ventana = agua.filter((a) => a.t < t && a.t >= new Date(t - 3 * 3600e3))
    const prom = Object.fromEntries(AGUA.map((k) => [k, d3.mean(ventana, (a) => a[k])]))
    const nc = s.alimento_entregado_kg >= 0.5 ? Math.min(100, (100 * s.no_consumido_kg) / s.alimento_entregado_kg) : null
    return { ...s, ...prom, i, t, no_consumido_pct: nc, densidad: s.biomasa_kg / volumen, ultimaAgua: ventana.at(-1) }
  })
  const kgM2Max = E.kg_m2_max
  const dias = agregarDias(esc, agua)
  let selDiaria = ["sgr", "o2_min"]
  const pesoDominio = [d3.min(esc, (s) => s.histograma[2].desde), d3.max(esc, (s) => s.histograma.at(-3).hasta)]

  // ── componentes
  const $ = (id) => document.getElementById(id)
  const sonar = new Sonar3D($("sonar3d"), $("tip3d"), $("leyenda3d"))
  window.__sonar = sonar   // para depuración y pruebas automáticas
  const slider = $("escaneo")
  slider.max = esc.length - 1
  slider.value = esc.length - 1
  let iSel = esc.length - 1
  const cache = new Map()
  let nubeActual = null

  const banda = (clave) => {
    const r = umbrales[clave]?.reglas.filter(([e]) => e === "ok")
    return r?.length ? [r[0][1], r[0][2]] : null
  }
  const defsSeries = [
    { clave: "biomasa", titulo: "Biomasa", unidad: "t", dec: 1, datos: esc.map((s) => ({ t: s.t, v: s.biomasa_kg / 1000 })) },
    { clave: "peso", titulo: "Peso medio", unidad: "g", dec: 0, datos: esc.map((s) => ({ t: s.t, v: s.peso_medio_g })) },
    { clave: "sgr", titulo: "Tasa de crecimiento (SGR, ventana 3 días)", unidad: "%/día", dec: 2, datos: dias.map((d) => ({ t: d.t, v: d.sgr })) },
    { clave: "fcr", titulo: "Conversión de alimento (FCR)", unidad: "kg/kg", dec: 2, datos: dias.map((d) => ({ t: d.t, v: d.fcr })) },
    { clave: "fondo", titulo: "Alimento en el fondo", unidad: "kg", dec: 1, datos: esc.map((s) => ({ t: s.t, v: s.alimento_fondo_kg })) },
    { clave: "nc", titulo: "Alimento no consumido", unidad: "%", dec: 0, banda: banda("no_consumido_pct"), datos: esc.map((s) => ({ t: s.t, v: s.no_consumido_pct })) },
    { clave: "o2", titulo: "Oxígeno disuelto", unidad: "mg/L", dec: 1, banda: banda("oxigeno_mg_l"), datos: agua.map((a) => ({ t: a.t, v: a.oxigeno_mg_l })) },
    { clave: "t", titulo: "Temperatura", unidad: "°C", dec: 1, banda: banda("temperatura_c"), datos: agua.map((a) => ({ t: a.t, v: a.temperatura_c })) },
    { clave: "ph", titulo: "pH", unidad: "", dec: 2, banda: banda("ph"), datos: agua.map((a) => ({ t: a.t, v: a.ph })) },
    { clave: "nh3", titulo: "NH₃ no ionizado", unidad: "mg/L", dec: 4, banda: banda("nh3_mg_l"), datos: agua.map((a) => ({ t: a.t, v: a.nh3_mg_l })) },
  ]
  let seriesApi = null

  function estado(clave, v) {
    if (v == null) return null
    const r = umbrales[clave]?.reglas.find(([, a, b]) => (a == null || v >= a) && (b == null || v < b))
    return r?.[0]
  }
  function estadoDensidad(d) {
    const max = umbrales.densidad_max[E.etapa] ?? 60
    return d > max ? "critico" : d > 0.85 * max ? "aviso" : "ok"
  }
  const chip = (e) => (e ? `<span class="estado estado-${e}"><b aria-hidden="true">${ESTADOS[e].icono}</b>${ESTADOS[e].texto}</span>` : "")

  function kpis(s) {
    const ref = esc[Math.max(0, s.i - 8 * 7)] // 7 días antes (8 escaneos por día)
    const a = s.ultimaAgua || {}
    const delta = (v, v0, dec, u = "") => {
      const d = v - v0
      return `${d >= 0 ? "▲" : "▼"} ${fmtN(Math.abs(d), dec)}${u} en 7 días`
    }
    const tiles = [
      ["Peces estimados", fmtN(s.peces_estimados, 0), "", delta(s.peces_estimados, ref.peces_estimados, 0)],
      ["Peso medio", fmtN(s.peso_medio_g, 1), "g", `CV ${fmtN(s.cv_peso_pct, 0)} % · ${delta(s.peso_medio_g, ref.peso_medio_g, 1, " g")}`],
      ["Biomasa", fmtN(s.biomasa_kg / 1000, 1), "t", delta(s.biomasa_kg / 1000, ref.biomasa_kg / 1000, 1, " t")],
      ["Densidad", fmtN(s.densidad, 1), "kg/m³", chip(estadoDensidad(s.densidad)) + ` máx. ${umbrales.densidad_max[E.etapa]}`],
      ["Alimento en el fondo", fmtN(s.alimento_fondo_kg, 1), "kg", `entregado 3 h: ${fmtN(s.alimento_entregado_kg, 1)} kg`],
      ["No consumido", s.no_consumido_pct == null ? "—" : fmtN(s.no_consumido_pct, 0), s.no_consumido_pct == null ? "" : "%", s.no_consumido_pct == null ? "sin comida en el intervalo" : chip(estado("no_consumido_pct", s.no_consumido_pct))],
      ["Oxígeno", fmtN(a.oxigeno_mg_l, 1), "mg/L", chip(estado("oxigeno_mg_l", a.oxigeno_mg_l))],
      ["pH", fmtN(a.ph, 2), "", chip(estado("ph", a.ph))],
      ["Temperatura", fmtN(a.temperatura_c, 1), "°C", chip(estado("temperatura_c", a.temperatura_c))],
      ["NH₃ no ionizado", fmtN(a.nh3_mg_l, 4), "mg/L", chip(estado("nh3_mg_l", a.nh3_mg_l))],
    ]
    $("kpis").innerHTML = tiles.map(([et, val, u, sub]) =>
      `<div class="kpi"><div class="et">${et}</div><div class="val">${val} <small>${u}</small></div><div class="delta">${sub}</div></div>`).join("")
  }

  async function nube(s) {
    const res = $("res-fondo").value
    const clave = `${s.id}:${res}`
    if (!cache.has(clave)) cache.set(clave, ESTATICO
      ? fetch(`${ESTATICO}data/nube/${E.codigo}-${s.id}.json.gz`).then(leerGz)
      : fetch(`${urlNube}?escaneo_id=${s.id}&res=${res}`).then((r) => r.json()))
    return cache.get(clave)
  }

  async function seleccionar(i, { desdeSlider = false } = {}) {
    iSel = i
    const s = esc[i]
    const regEl = document.getElementById("registro-vivo"); if (regEl) regEl.__escaneo = () => esc[iSel]
    if (!desdeSlider) slider.value = i
    $("escaneo-fecha").textContent = fmtFecha(s.t)
    kpis(s)
    G.histograma($("g-hist"), s)
    $("sub-hist").textContent = `${fmtN(s.peces_estimados, 0)} peces · media ${fmtN(s.peso_medio_g, 0)} g · CV ${fmtN(s.cv_peso_pct, 0)} %`
    seriesApi?.seleccionar(i)
    dibujarCruce()
    const n = await nube(s)
    if (iSel !== i) return
    nubeActual = n
    const o2 = s.ultimaAgua?.oxigeno_mg_l ?? 9
    const mortalidadDia = s.peces_estimados * (0.0002 + (o2 < 5.5 ? 0.0004 : 0))
    sonar.setDatos(n, { kgM2Max, pesoDominio, contexto: { inicio: s.t, o2, mortalidadDia } })
    $("ppe").textContent = fmtN(n.peces_por_eco, 0)
    notaEcos()
    G.fondoSuperior($("g-fondo"), n, kgM2Max, { alClic })
    G.perfil($("g-perfil"), n)
  }

  function notaEcos() {
    const n = nubeActual
    if (!n) return
    const mostrados = Math.round(n.peces.length * sonar.fraccion)
    $("nota-ecos").textContent = `${fmtN(mostrados, 0)} de ${fmtN(n.peces.length, 0)} ecos resueltos (1 eco ≈ ${fmtN(n.peces_por_eco, 0)} peces reales) · arrastra para girar · rueda para acercar`
  }

  const alClic = (x, y) => { $("giro").checked = false; sonar.girar = false; sonar.enfocar(x, y) }

  function dibujarDiario() {
    const desfase = +$("desfase").value
    const filas = conDesfase(dias, desfase)
    const filasVars = Object.entries(DIA_PECES).map(([clave, v]) => ({ clave, ...v }))
    const colVars = Object.entries(DIA_AGUA).map(([clave, v]) => ({ clave, ...v }))
    G.correlacionCruzada($("g-cruzada"), filasVars, colVars, filas, selDiaria, (f, c) => { selDiaria = [f, c]; dibujarDiario() })
    const [fy, cx] = selDiaria
    const puntos = filas.map((d) => ({ x: d[cx], y: d[fy], t: d.t, i: d.iScan }))
    const r = G.dispersion($("g-disp-diaria"), puntos, DIA_AGUA[cx], DIA_PECES[fy], null, (i) => seleccionar(i))
    const txtDesfase = desfase ? ` · agua de ${desfase} día${desfase > 1 ? "s" : ""} antes` : ""
    $("sub-diaria").innerHTML = `<b>${DIA_PECES[fy].titulo} × ${DIA_AGUA[cx].titulo}</b>${txtDesfase}` +
      (r ? ` · r = ${fmtN(r.r, 2)} · ${r.n} días` : "") +
      (fy === "peso" ? `<br>⚠ El peso crece día a día; su correlación con el agua refleja la tendencia de ambas, no un efecto. Usa SGR o crecimiento.` : "")
  }

  function dibujarCruce() {
    const vx = $("var-x").value, vy = $("var-y").value
    const filas = esc.filter((s) => s.no_consumido_pct != null)
    const puntos = filas.map((s) => ({ x: s[vx], y: s[vy], t: s.t, i: s.i }))
    const r = G.dispersion($("g-disp"), puntos, { ...VARS[vx], banda: banda(vx) }, VARS[vy], iSel, (i) => seleccionar(i))
    $("sub-disp").textContent = r ? `r = ${fmtN(r.r, 2)} · pendiente ${fmtN(r.b, 3)} ${VARS[vy].unidad}/${VARS[vx].unidad || "unidad"} · ${r.n} escaneos con comida` : ""
  }

  function dibujarTodo() {
    seriesApi = G.series($("series"), defsSeries, esc.map((s) => s.t), iSel, (i) => seleccionar(i))
    const vars = ["no_consumido_pct", "alimento_fondo_kg", "profundidad_media_m", "oxigeno_mg_l", "temperatura_c", "ph", "nh3_mg_l", "co2_mg_l"]
      .map((k) => ({ clave: k, ...VARS[k] }))
    G.correlaciones($("g-corr"), vars, esc.filter((s) => s.no_consumido_pct != null))
    tabla()
    dibujarDiario()
    if (nubeActual) { G.fondoSuperior($("g-fondo"), nubeActual, kgM2Max, { alClic }); G.perfil($("g-perfil"), nubeActual) }
    G.histograma($("g-hist"), esc[iSel])
    dibujarCruce()
  }

  function tabla() {
    const cols = [["Escaneo", (s) => fmtFecha(s.t)], ["Peces", (s) => fmtN(s.peces_estimados, 0)], ["Peso g", (s) => fmtN(s.peso_medio_g, 1)],
      ["Biomasa t", (s) => fmtN(s.biomasa_kg / 1000, 2)], ["Entregado kg", (s) => fmtN(s.alimento_entregado_kg, 1)],
      ["No consumido %", (s) => fmtN(s.no_consumido_pct, 0)], ["Fondo kg", (s) => fmtN(s.alimento_fondo_kg, 1)],
      ["O₂ mg/L", (s) => fmtN(s.oxigeno_mg_l, 1)], ["T °C", (s) => fmtN(s.temperatura_c, 1)], ["pH", (s) => fmtN(s.ph, 2)], ["NH₃ mg/L", (s) => fmtN(s.nh3_mg_l, 4)]]
    $("tabla").innerHTML = `<thead><tr>${cols.map(([c]) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${
      esc.slice(-24).reverse().map((s) => `<tr>${cols.map(([, f]) => `<td>${f(s)}</td>`).join("")}</tr>`).join("")}</tbody>`
  }

  // ── controles
  slider.addEventListener("input", () => seleccionar(+slider.value, { desdeSlider: true }))
  let reproduciendo = null
  $("btn-play").addEventListener("click", (ev) => {
    if (reproduciendo) { clearInterval(reproduciendo); reproduciendo = null; ev.target.textContent = "▶"; return }
    ev.target.textContent = "❚❚"
    if (iSel >= esc.length - 1) seleccionar(0)
    reproduciendo = setInterval(() => {
      if (iSel >= esc.length - 1) { clearInterval(reproduciendo); reproduciendo = null; ev.target.textContent = "▶"; return }
      seleccionar(iSel + 1)
    }, 450)
  })
  for (const capa of ["peces", "fondo", "pellets", "relieve"]) {
    $(`capa-${capa}`).addEventListener("change", (ev) => { sonar.capas[capa] = ev.target.checked; sonar.pedirRender() })
  }
  $("giro").addEventListener("change", (ev) => { sonar.girar = ev.target.checked })
  document.querySelectorAll("[data-vista]").forEach((b) => b.addEventListener("click", () => { $("giro").checked = false; sonar.girar = false; sonar.vista(b.dataset.vista) }))
  const corte = () => {
    let a = +$("corte-min").value, b = +$("corte-max").value
    if (a > b) [a, b] = [b, a]
    sonar.corte = [a, b]
    $("corte-txt").textContent = `${fmtN(a, 1)} y ${fmtN(b, 1)} m de profundidad`
    sonar.pedirRender()
  }
  $("corte-min").addEventListener("input", corte)
  $("corte-max").addEventListener("input", corte)
  corte()
  $("desfase").addEventListener("change", dibujarDiario)
  // movimiento
  sonar.girar = false
  sonar.velocidad = +$("velocidad").value
  $("animar").checked = sonar.animar
  $("animar").addEventListener("change", (ev) => { sonar.animar = ev.target.checked; sonar.pedirRender() })
  $("velocidad").addEventListener("change", (ev) => { sonar.velocidad = +ev.target.value })
  // cámaras simuladas del piloto: capa, ángulo de la lente y alcance útil
  $("capa-camaras").addEventListener("change", (ev) => { sonar.capas.camaras = ev.target.checked; sonar.pedirRender() })
  $("cam-fov").addEventListener("change", (ev) => { const h = +ev.target.value; sonar.camCfg.hfov = h; sonar.camCfg.vfov = Math.round(h * 0.75); sonar.pedirRender() })
  $("cam-alcance").addEventListener("change", (ev) => { sonar.camCfg.alcance = +ev.target.value; sonar.pedirRender() })
  $("cam-n").addEventListener("change", (ev) => { sonar.camCfg.n = +ev.target.value; sonar.pedirRender() })
  $("cam-filas").addEventListener("change", (ev) => { sonar.camCfg.filas = +ev.target.value; sonar.pedirRender() })
  $("cam-fondo").addEventListener("change", (ev) => { sonar.camCfg.fondoAltura = +ev.target.value; sonar.pedirRender() })
  $("res-fondo").addEventListener("change", () => seleccionar(iSel))
  $("fraccion").addEventListener("change", (ev) => { sonar.fraccion = +ev.target.value; sonar.pedirRender(); notaEcos() })
  setInterval(() => {
    const s = esc[iSel]
    if (!s || !sonar.datos) return
    const seg = Math.floor(sonar.reloj)
    const mmss = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`
    const st = sonar.estado()
    const partes = [`Escaneo ${fmtFecha(s.t)} + ${mmss} simulado`]
    if (st.alimentando) partes.push(`alimentando · ${st.comiendo} comiendo · ${st.comidos} pellets comidos`)
    else partes.push("sin alimentación en este intervalo")
    if (st.noche) partes.push("noche: nado lento y profundo")
    if (st.o2Bajo) partes.push("⚠ O₂ bajo: peces en superficie, boqueando")
    partes.push(`mortalidad desde la limpieza de 7:00: ${st.muertos}`)
    if (sonar.capas.camaras && st.enCamara) partes.push(`cámaras: ${fmtN(100 * (st.enCamara.lateral || 0) / Math.max(1, st.enCamara.visibles || 1), 0)} % del cardumen en cono · ${st.enCamara.cenital_pellets || 0} pellets en cuadro`)
    if (st.saltos) partes.push(`saltos: ${st.saltos}`)
    $("reloj3d").textContent = partes.join(" · ")
  }, 250)
  // navegación 3D
  const canvas = $("sonar3d")
  canvas.addEventListener("interaccion", () => { $("giro").checked = false; sonar.girar = false })
  $("zoom-mas").addEventListener("click", () => sonar.zoomHacia(1.3))
  $("zoom-menos").addEventListener("click", () => sonar.zoomHacia(1 / 1.3))
  $("zoom-reset").addEventListener("click", () => sonar.vista("iso"))
  const panel3d = document.querySelector(".panel-3d")
  $("btn-pantalla").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else panel3d.requestFullscreen?.().then(() => canvas.focus())
  })
  document.addEventListener("fullscreenchange", () => {
    $("btn-pantalla").textContent = document.fullscreenElement ? "✕ Salir de pantalla completa" : "⛶ Pantalla completa"
  })
  $("var-x").addEventListener("change", dibujarCruce)
  $("var-y").addEventListener("change", dibujarCruce)

  let t
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(dibujarTodo, 200) })
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { dibujarTodo(); seleccionar(iSel) })

  dibujarTodo()
  seleccionar(iSel)
}

// Cámaras con detección YOLO junto al 3D: apagar descarga los iframes (no consume GPU ni red).
const vivo = document.getElementById("camaras-vivo");
if (vivo) {
  vivo.addEventListener("change", () => {
    const aside = document.getElementById("camaras");
    aside.classList.toggle("apagadas", !vivo.checked);
    aside.querySelectorAll("iframe").forEach((f) => { f.src = vivo.checked ? f.dataset.src : "about:blank"; });
  });
}

// Registro en tiempo real bajo las cámaras: N de peces, peso medio y alimento en el fondo
// avanzan con el reloj de la simulación 3D; la cámara aporta sus peces detectados por cuadro.
import("viz/registro").then(({ crearRegistro }) => {
  const raiz = document.getElementById("registro-vivo")
  if (!raiz || !window.__sonar) return
  const sonar = window.__sonar
  const estilo = getComputedStyle(document.documentElement)
  const azul = estilo.getPropertyValue("--series-1").trim() || "#2a78d6"
  const naranjo = estilo.getPropertyValue("--series-2").trim() || "#eb6834"
  const reg = crearRegistro(raiz, [
    { clave: "n", titulo: "Peces estimados", corto: "peces", unidad: "", dec: 0, color: azul },
    { clave: "peso", titulo: "Peso medio", corto: "g", unidad: "g", dec: 1, color: azul },
    { clave: "fondo", titulo: "Alimento en el fondo", corto: "kg", unidad: "kg", dec: 2, color: naranjo },
    { clave: "camara", titulo: "Peces detectados por la cámara (video real)", corto: "en cámara", unidad: "", dec: 0, color: azul },
    { clave: "campo", titulo: "Peces medibles por la cámara (simulación)", corto: "medibles", unidad: "", dec: 0, color: estilo.getPropertyValue("--camara").trim() || "#8a4fd0" },
  ])
  const sgrDia = { smolt: 1.25, alevin: 2.3, alevín: 2.3 }
  let ultimaCamara = null, fondoExtra = 0, relojPrev = null, escaneoPrev = null
  window.addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || !ev.data || ev.data.ssv !== "deteccion") return
    if (ev.data.kind !== "secuencia") ultimaCamara = ev.data.n      // el video de peces, no la secuencia de pellets
  })
  const rnd = (sd) => 1 + sd * (Math.random() + Math.random() + Math.random() - 1.5) / 0.75
  setInterval(() => {
    const s = raiz.__escaneo?.()
    if (!s || !sonar.datos) return
    const st = sonar.estado()
    const reloj = sonar.reloj
    if (escaneoPrev !== s) { fondoExtra = 0; relojPrev = reloj; escaneoPrev = s }
    const dt = Math.max(0, reloj - (relojPrev ?? reloj)); relojPrev = reloj
    // alimento: mientras se alimenta decanta lo no consumido (repartido en ~2 min); el dren saca 14 %/h
    if (st.alimentando) fondoExtra += (s.no_consumido_kg ?? 0) / 120 * dt
    fondoExtra *= Math.exp(-0.15 * dt / 3600)
    const ppe = sonar.datos.peces_por_eco || 1
    const etapa = (sonar.datos.estanque?.etapa || raiz.dataset.etapa || "smolt").toLowerCase()
    const sgr = (sgrDia[etapa] ?? 1.25) * Math.pow(s.apetito ?? 1, 1.6)
    const valores = {
      n: Math.round((s.peces_estimados - st.muertos * ppe) * rnd(0.002)),
      peso: s.peso_medio_g * Math.exp(sgr / 100 * reloj / 86400) * rnd(0.003),
      fondo: Math.max(0, (s.alimento_fondo_kg + fondoExtra) * rnd(0.02)),
    }
    if (ultimaCamara != null) valores.camara = ultimaCamara
    if (st.enCamara && sonar.capas.camaras) valores.campo = Math.round((st.enCamara.lateral_medibles || 0) * ppe)
    const seg = Math.floor(reloj)
    reg.agregar(`+${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`, valores)
  }, 2000)
})
