import * as d3 from "d3"
import { rampaPeso, rampaAlimento, token } from "viz/colores"
import { fmtN } from "viz/formato"

// Visor 3D de la nube de sonar sobre canvas. D3 aporta escalas, arrastre y zoom;
// la proyección (giro + inclinación + perspectiva débil) se hace a mano.
export class Sonar3D {
  constructor(canvas, tip, leyenda) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d")
    this.tip = tip
    this.leyenda = leyenda
    this.yaw = -0.6
    this.pitch = 0.42
    this.zoom = 1
    this.panX = 0
    this.panY = 0
    this.capas = { peces: true, fondo: true, pellets: true, relieve: true, camaras: true }
    // cámaras del piloto (simuladas): ángulo horizontal/vertical en grados y alcance útil en metros
    // n: pares estéreo laterales repartidos en la pared; filas: 1 o 2 profundidades; fondoAltura: metros sobre el fondo (0 = bajo la superficie)
    this.camCfg = { hfov: 70, vfov: 52, alcance: 2, rango: [0.3, 1.5], fondoAltura: 1.5, n: 4, filas: 1 }
    this._enCam = {}
    this.corte = [0, Infinity]
    this.fraccion = 0.5      // fracción de ecos dibujados (los datos no cambian)
    this.girar = true
    this.proyectados = []
    this.arrastrando = false

    const ro = new ResizeObserver(() => this.redimensionar())
    ro.observe(canvas)

    // Navegación:
    //   arrastrar = girar · shift+arrastrar o clic derecho = mover · rueda = zoom hacia el cursor
    //   doble clic = vista inicial · teclado: flechas giran, WASD mueven, +/− zoom, R reinicia
    d3.select(canvas).call(
      d3.drag()
        .filter((ev) => ev.button === 0 || ev.button === 2)
        .on("start", (ev) => {
          const se = ev.sourceEvent
          this.modo = se.button === 2 || se.shiftKey ? "mover" : "girar"
          this.arrastrando = true
          this.ocultarTip()
          this.interaccion()
        })
        .on("drag", (ev) => {
          if (this.modo === "mover") { this.panX += ev.dx; this.panY += ev.dy }
          else {
            this.yaw += ev.dx * 0.008
            this.pitch = Math.max(-0.35, Math.min(Math.PI / 2, this.pitch + ev.dy * 0.006))
          }
          this.pedirRender()
        })
        .on("end", () => { this.arrastrando = false })
    )
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault())
    canvas.addEventListener("wheel", (ev) => {
      ev.preventDefault()
      const r = canvas.getBoundingClientRect()
      this.zoomHacia(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top)
    }, { passive: false })
    canvas.addEventListener("dblclick", () => this.vista("iso"))
    canvas.addEventListener("keydown", (ev) => this.tecla(ev))
    canvas.addEventListener("mousemove", (ev) => this.hover(ev))
    canvas.addEventListener("mouseleave", () => this.ocultarTip())

    this.animar = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.velocidad = 1   // 1 = tiempo real
    this.reloj = 0       // segundos simulados desde el último escaneo
    let previo = performance.now()
    const bucle = () => {
      const ahora = performance.now()
      const dt = Math.max(0, Math.min(0.1, (ahora - previo) / 1000))
      previo = ahora
      if (this.datos) {
        if (this.animar) this.paso(dt * this.velocidad)
        if (this.girar && !this.arrastrando) this.yaw += 0.15 * dt
        if (this.animar || this.girar) this.render()
      }
      requestAnimationFrame(bucle)
    }
    requestAnimationFrame(bucle)
  }

  vista(nombre) {
    const v = { iso: [-0.6, 0.38, 1.22], lado: [0, 0.02, 1.25], arriba: [0, Math.PI / 2, 1.05] }[nombre]
    ;[this.yaw, this.pitch, this.zoom] = v
    this.panX = this.panY = 0
    this.pedirRender()
  }

  interaccion() {
    this.canvas.dispatchEvent(new CustomEvent("interaccion"))
  }

  // Zoom manteniendo fijo el punto bajo (mx, my)
  zoomHacia(factor, mx = this.w / 2, my = this.h / 2) {
    const z = this.zoom
    const z2 = Math.max(0.4, Math.min(16, z * factor))
    const cx = this.w / 2, cy = this.h / 2 + 0.02 * this.h
    this.panX = mx - cx - (mx - cx - this.panX) * (z2 / z)
    this.panY = my - cy - (my - cy - this.panY) * (z2 / z)
    this.zoom = z2
    this.interaccion()
    this.pedirRender()
  }

  // Centra la cámara sobre un punto del fondo (x, y en metros) y acerca
  enfocar(x, y, zoom = 3.5) {
    this.zoom = zoom
    this.panX = this.panY = 0
    const [px, py] = this.proyector()(x, y, this.zFondo(Math.hypot(x, y)))
    this.panX = this.w / 2 - px
    this.panY = this.h / 2 - py
    this.interaccion()
    this.pedirRender()
  }

  tecla(ev) {
    const paso = ev.shiftKey ? 60 : 25
    const acciones = {
      ArrowLeft: () => (this.yaw -= 0.08), ArrowRight: () => (this.yaw += 0.08),
      ArrowUp: () => (this.pitch = Math.min(Math.PI / 2, this.pitch + 0.06)),
      ArrowDown: () => (this.pitch = Math.max(-0.35, this.pitch - 0.06)),
      a: () => (this.panX += paso), d: () => (this.panX -= paso), w: () => (this.panY += paso), s: () => (this.panY -= paso),
      "+": () => this.zoomHacia(1.2), "=": () => this.zoomHacia(1.2), "-": () => this.zoomHacia(1 / 1.2),
      r: () => this.vista("iso"),
    }
    const f = acciones[ev.key.length === 1 ? ev.key.toLowerCase() : ev.key]
    if (!f) return
    ev.preventDefault()
    f()
    this.interaccion()
    this.pedirRender()
  }

  // kgM2Max fija la escala del alimento para todo el estanque (comparable entre escaneos)
  setDatos(nube, { kgM2Max, pesoDominio, contexto }) {
    this.datos = nube
    this.contexto = contexto || {}
    this.escalaPeso = rampaPeso(pesoDominio)
    this.escalaAlim = rampaAlimento(kgM2Max)
    this.kgM2Max = kgM2Max
    this.prepararFondo()
    this.prepararMovimiento()
    this.dibujarLeyenda(pesoDominio)
    this.pedirRender()
  }

  // ── Comportamiento entre escaneos ────────────────────────────────────────
  // El sonar entrega una foto cada escaneo; entre fotos se simula el comportamiento:
  //   nado: circular contra la corriente (~0,6–1,2 largos/s); de noche más lento y profundo;
  //         con O₂ bajo suben a la superficie, nadan lento y boquean
  //   comida: los peces cerca del alimentador se lanzan a los pellets y se los comen
  //   pellet: cae a 8–14 cm/s; lo que no se come llega al fondo y va al dren
  //   fecas: partículas finas que caen a 2–4 cm/s, más en las 1–3 h después de comer
  //   mortalidad: según la tasa del día; el pez se hunde, queda de lado y la corriente
  //               lo lleva al dren; se retiran en la limpieza de las 7:00
  //   saltos: de vez en cuando un pez rompe la superficie
  prepararMovimiento() {
    const rnd = d3.randomLcg(this.datos.escaneo_id)
    const e = this.datos.estanque
    const R = e.radio_m, D = e.profundidad_m
    this.reloj = 0
    this.rnd = rnd
    const nc0 = Math.max(0.03, Math.min(0.95, this.datos.fraccion_no_consumida ?? 0.1))
    for (const f of this.datos.peces) {
      f.orden = rnd()
      f.r0 = Math.hypot(f.x, f.y); f.z0 = f.z; f.zc = f.z
      const th = Math.atan2(f.y, f.x)
      f.phi = th - Math.PI / 2 + (rnd() - 0.5) * 0.4       // rumbo: tangente horaria con dispersión
      f.v = (0.6 + 0.6 * rnd()) * f.l / 100                // m/s de crucero
      f.az = 0.08 + 0.25 * rnd(); f.wz = 0.08 + 0.3 * rnd(); f.fz = rnd() * 6.28
      f.ar = 0.1 + 0.3 * rnd(); f.wr = 0.03 + 0.08 * rnd(); f.fr = rnd() * 6.28
      f.modo = "nadar"; f.obj = null; f.salto = -9; f.comio = 0
      f.hambre = rnd() < 1 - nc0 ? 0.6 + 0.4 * rnd() : 0   // los saciados no acuden
      f.tModo = 0; f.wander = rnd() * 6.28; f.traga = 0
    }
    // pellet en la columna: los del JSON son la posición inicial
    this.pellets = this.datos.pellets.map((p) => this.nuevoPellet(rnd, p))
    const nc = Math.max(0.03, Math.min(0.95, this.datos.fraccion_no_consumida ?? 0.1))
    this.apetito = 1 - nc
    const tCaida = D / 0.11
    this.pComer = -Math.log(nc) / tCaida                // prob/s de ser comido mientras cae
    // partículas del fondo, muestreadas según kg/m² (más donde hay más pellet)
    const celdas = this.datos.fondo.celdas
    const acum = d3.cumsum(celdas, (c) => c.kg_m2)
    const total = acum.at(-1) || 1
    const p = this.datos.fondo.lado_m * 1.5
    this.muestrearFondo = () => {
      const c = celdas[d3.bisectLeft(acum, rnd() * total)] || celdas[0]
      const x = c.x + (rnd() - 0.5) * p, y = c.y + (rnd() - 0.5) * p
      const r = Math.hypot(x, y)
      // movilidad: cerca del dren y en zonas limpias se mueve; donde se acumula (zona muerta), casi nada
      const mov = r < 0.3 * R ? 1 : Math.max(0.04, 1 - 1.6 * Math.sqrt(c.kg_m2 / this.kgM2Max))
      return { r, th: Math.atan2(y, x), mov, vida: 6 + 18 * rnd() }
    }
    const areaCelda = this.datos.fondo.area_m2
    const n = Math.min(900, Math.round(120 + 4000 * total * areaCelda / Math.max(1, this.kgM2Max * Math.PI * R * R)))
    this.particulas = d3.range(n).map(() => this.muestrearFondo())

    // fecas en la columna y en el fondo
    this.fecas = []
    this.fecasFondo = []
    // mortalidades acumuladas desde la limpieza de las 7:00
    const ctx = this.contexto || {}
    const inicio = ctx.inicio ? new Date(ctx.inicio) : null
    const horaInicio = inicio ? inicio.getHours() + inicio.getMinutes() / 60 : 12
    const desdeLimpieza = (horaInicio - 7 + 24) % 24
    const nMuertos = Math.round((ctx.mortalidadDia || 0) * desdeLimpieza / 24)
    const lRef = d3.median(this.datos.peces, (f) => f.l) || 15
    this.muertos = d3.range(nMuertos).map(() => {
      const q = this.muestrearFondo()
      return { r: q.r, th: q.th, z: this.zFondo(q.r) - 0.03, l: lRef * (0.8 + 0.4 * rnd()), ang: rnd() * 6.28, fase: "fondo" }
    })
    this.ondas = []          // anillos en la superficie (saltos, boqueo)
    this.nSaltos = 0
    this.nComidos = 0
    this.duracionComida = 20 * 60   // s simulados: cuánto dura la caída de pellet desde que parte el escaneo; después los peces se dispersan
  }

  nuevoPellet(rnd, base) {
    const e = this.datos.estanque
    const R = e.radio_m
    if (base) return { r: Math.hypot(base.x, base.y), th: Math.atan2(base.y, base.x), z: base.z, v: 0.08 + 0.06 * rnd() }
    // cae desde el alimentador (a 0,35 R del centro), con dispersión del lanzamiento
    const fx = 0.35 * R, d = Math.abs(d3.randomNormal.source(rnd)(0, 0.12 * R)()), a = rnd() * 6.28
    const x = fx + d * Math.cos(a), y = d * Math.sin(a)
    return { r: Math.hypot(x, y), th: Math.atan2(y, x), z: 0.02, v: 0.08 + 0.06 * rnd() }
  }

  // hora del día simulada (0–24) y condiciones derivadas
  get horaSim() {
    const ctx = this.contexto || {}
    const inicio = ctx.inicio ? new Date(ctx.inicio) : null
    const h0 = inicio ? inicio.getHours() + inicio.getMinutes() / 60 : 12
    return (h0 + this.reloj / 3600) % 24
  }
  get esNoche() { const h = this.horaSim; return h >= 21 || h < 6 }
  get o2Bajo() { return (this.contexto?.o2 ?? 9) < 6 }

  estado() {
    return {
      comiendo: this.datos ? this.datos.peces.filter((f) => (f.modo === "comer" || f.modo === "acudir") && f.orden <= this.fraccion).length : 0,
      comidos: this.nComidos, muertos: this.muertos?.length || 0, saltos: this.nSaltos,
      fecas: (this.fecas?.length || 0) + (this.fecasFondo?.length || 0),
      noche: this.esNoche, o2Bajo: this.o2Bajo, hora: this.horaSim, alimentando: !!this.pellets?.length,
      enCamara: { ...this._enCam },
    }
  }

  paso(dt) {
    if (dt <= 0) return
    this.reloj += dt
    const t = this.reloj
    const e = this.datos.estanque
    const R = e.radio_m, D = e.profundidad_m
    const rnd = this.rnd
    const corrienteAgua = 0.12   // m/s, sentido antihorario
    const noche = this.esNoche, o2Bajo = this.o2Bajo
    const factorNado = o2Bajo ? 0.45 : noche ? 0.6 : 1
    const alimentando = this.pellets.length > 0
    const fxAlim = 0.35 * R
    // actividad digestiva: pico 1–3 h después de una comida (horas 8, 11, 14, 17)
    const h = this.horaSim
    const desdeComida = Math.min(...[8, 11, 14, 17].map((c) => (h - c + 24) % 24))
    const digestion = desdeComida < 4 ? Math.exp(-(((desdeComida - 1.5) / 1.3) ** 2)) : 0.05

    let nMostrados = 0
    const ctxPez = { t, dt, R, D, rnd, noche, o2Bajo, factorNado, alimentando, fxAlim }
    for (const f of this.datos.peces) {
      const visible = f.orden <= this.fraccion
      if (visible) nMostrados++
      this.moverPez(f, ctxPez, visible)
    }
    // ── pellets
    for (let i = 0; i < this.pellets.length; i++) {
      const p = this.pellets[i]
      if (p.comido) {                      // ya comido: espera su turno para "caer" de nuevo
        p.tRespawn -= dt
        if (p.tRespawn <= 0) { if (this.reloj < this.duracionComida) this.pellets[i] = this.nuevoPellet(rnd); else { this.pellets.splice(i, 1); i--; continue } }
        continue
      }
      p.z += p.v * dt
      p.th += (corrienteAgua / Math.max(0.5, p.r)) * dt
      // comidos por los peces no dibujados (la mayoría), según la fracción no consumida
      if (p.z < this.zFondo(p.r) - 0.3 && rnd() < this.pComer * dt) { p.comido = true; p.tRespawn = 1 + 3 * rnd(); continue }
      if (p.z >= this.zFondo(p.r)) { if (this.reloj < this.duracionComida) this.pellets[i] = this.nuevoPellet(rnd); else { this.pellets.splice(i, 1); i--; continue } }
    }
    // ── fecas: se generan desde los peces dibujados, más durante la digestión
    const tasaFecas = nMostrados * (0.0006 + 0.004 * digestion)
    let nNuevas = Math.floor(tasaFecas * dt + rnd())
    const peces = this.datos.peces
    while (nNuevas-- > 0 && this.fecas.length < 1500) {
      const f = peces[Math.floor(rnd() * peces.length)]
      if (f.orden > this.fraccion) continue
      this.fecas.push({ r: Math.hypot(f.x, f.y), th: Math.atan2(f.y, f.x), z: f.z + 0.05, v: 0.02 + 0.02 * rnd() })
    }
    for (let i = this.fecas.length - 1; i >= 0; i--) {
      const q = this.fecas[i]
      q.z += q.v * dt
      q.th += (corrienteAgua / Math.max(0.5, q.r)) * dt
      if (q.z >= this.zFondo(q.r)) {
        this.fecas.splice(i, 1)
        this.fecasFondo.push({ r: q.r, th: q.th, vida: 40 + 40 * rnd() })
      }
    }
    for (let i = this.fecasFondo.length - 1; i >= 0; i--) {
      const q = this.fecasFondo[i]
      q.vida -= dt
      q.th += (0.5 * corrienteAgua / Math.max(0.4, q.r)) * dt
      q.r -= 0.03 * dt
      if (q.vida <= 0 || q.r < 0.12) this.fecasFondo.splice(i, 1)
    }
    // ── partículas de pellet en el fondo
    for (let i = 0; i < this.particulas.length; i++) {
      const q = this.particulas[i]
      q.vida -= dt
      q.th += (0.5 * corrienteAgua * q.mov / Math.max(0.4, q.r)) * dt
      q.r -= 0.03 * q.mov * dt
      if (q.vida <= 0 || q.r < 0.12) this.particulas[i] = this.muestrearFondo()
    }
    // ── mortalidad: tasa del día (×3 con O₂ bajo); limpieza a las 7:00
    const tasa = (this.contexto?.mortalidadDia || 0) * (o2Bajo ? 3 : 1) / 86400
    if (rnd() < tasa * dt) {
      const f = peces[Math.floor(rnd() * peces.length)]
      this.muertos.push({ r: Math.hypot(f.x, f.y), th: Math.atan2(f.y, f.x), z: f.z, l: f.l, ang: rnd() * 6.28, fase: "hundiendo" })
    }
    if (Math.floor((h - dt / 3600 + 24) % 24) === 6 && Math.floor(h) === 7) this.muertos = []   // limpieza de las 7:00
    for (const m of this.muertos) {
      if (m.fase === "hundiendo") {
        m.z += 0.12 * dt; m.ang += 0.6 * dt
        if (m.z >= this.zFondo(m.r) - 0.03) { m.z = this.zFondo(m.r) - 0.03; m.fase = "fondo" }
      } else {
        m.th += (0.25 * corrienteAgua / Math.max(0.4, m.r)) * dt
        m.r = Math.max(0.25, m.r - 0.008 * dt)
      }
    }
    // ── ondas en superficie
    this.ondas = this.ondas.filter((o) => t - o.t0 < 1.2)
  }

  // Modelo de dirección: cada pez tiene un rumbo phi y vira hacia la dirección deseada
  // con una tasa de giro limitada, así los cambios son graduales. Modos:
  //   nadar  → circular contra la corriente manteniendo su radio preferido
  //   acudir → al caer la comida, los peces con hambre van hacia el alimentador y suben
  //   comer  → en la zona del alimentador persiguen pellets; cada pellet baja el hambre
  //   volver → saciados, se alejan del alimentador y retoman el nado circular
  moverPez(f, c, visible) {
    const { t, dt, R, D, rnd, noche, o2Bajo, factorNado, alimentando, fxAlim } = c
    const r = Math.hypot(f.x, f.y)
    const ux = r > 1e-6 ? f.x / r : 1, uy = r > 1e-6 ? f.y / r : 0   // radial hacia afuera
    const tx = uy, ty = -ux                                            // tangente horaria
    let dx, dy, vel = f.v * factorNado, giro = 2.0, zObj
    f.tModo += dt

    // ── transición a "acudir" cuando cae la comida
    if (alimentando && f.hambre > 0 && (f.modo === "nadar" || f.modo === "volver") && f.tModo > 10 && rnd() < 0.008 * dt) {
      f.modo = "acudir"; f.tModo = 0
    }
    if (!alimentando && (f.modo === "acudir" || f.modo === "comer")) { f.modo = "volver"; f.tModo = 0; f.obj = null }

    if (f.modo === "acudir") {
      // hacia el alimentador, subiendo; al llegar, a comer
      const ax = fxAlim - f.x, ay = -f.y, da = Math.hypot(ax, ay)
      dx = ax / da + 0.25 * Math.sin(f.wander + 1.7 * t); dy = ay / da + 0.25 * Math.cos(f.wander + 1.3 * t)
      vel = 1.3 * f.v * factorNado; giro = 1.4
      zObj = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(f.fz))
      if (da < 0.3 * R) { f.modo = "comer"; f.tModo = 0 }
    } else if (f.modo === "comer") {
      let p = f.obj
      if (f.traga > 0) { f.traga -= dt; p = null }
      else if (!p || p.comido) {
        // elige un pellet cercano (muestreo cada 2 para no recorrerlos todos)
        p = null; let dmin = 1.6
        for (let i = (f.comio % 2); i < this.pellets.length; i += 2) {
          const q = this.pellets[i]
          if (q.comido) continue
          const d = Math.hypot(q.r * Math.cos(q.th) - f.x, q.r * Math.sin(q.th) - f.y, q.z - f.z)
          if (d < dmin) { dmin = d; p = q }
        }
        f.obj = p
      }
      if (p) f.sinPellet = 0; else f.sinPellet = (f.sinPellet || 0) + dt
      if (p) {
        const px = p.r * Math.cos(p.th), py = p.r * Math.sin(p.th)
        const ex = px - f.x, ey = py - f.y, ez = p.z - f.z
        const dist = Math.hypot(ex, ey, ez)
        if (dist < 0.12) {
          p.comido = true; p.tRespawn = 2 + 6 * rnd(); f.comio++; this.nComidos++
          f.hambre -= 0.035 + 0.02 * rnd()
          f.traga = 2 + 2 * rnd()          // tiempo de manejo antes de buscar otro
          f.obj = null
          if (f.z < 0.3 && visible) this.ondas.push({ x: f.x, y: f.y, t0: t, chica: true })
        }
        dx = ex; dy = ey; zObj = p.z; vel = 1.6 * f.v * factorNado; giro = 2.5
      } else {
        // sin pellet a mano: merodea alrededor del alimentador sin alejarse de él
        f.wander += (rnd() - 0.5) * 1.2 * dt
        const ax = fxAlim - f.x, ay = -f.y, da = Math.hypot(ax, ay) || 1
        const lejos = Math.min(1.5, da / (0.25 * R))         // cuanto más lejos, más tira el alimentador
        dx = 0.6 * Math.cos(f.wander) + lejos * ax / da; dy = 0.6 * Math.sin(f.wander) + lejos * ay / da
        vel = 1.0 * f.v * factorNado; giro = 1.6; zObj = 0.3 + 0.2 * Math.sin(f.fz + 0.5 * t)
        // si lleva un rato sin conseguir pellet, cede el lugar (volverá si sigue con hambre)
        if (f.sinPellet > 15 + 15 * rnd()) { f.modo = "volver"; f.tModo = 0; f.sinPellet = 0; f.r0 = 0.5 * R + 0.4 * R * rnd() }
      }
      if (f.hambre <= 0 || f.tModo > 150 + 90 * rnd()) { f.modo = "volver"; f.tModo = 0; f.obj = null; f.r0 = 0.45 * R + 0.45 * R * rnd() }
    } else if (f.modo === "volver") {
      // se aleja del alimentador hacia su radio preferido, retomando el giro
      const err = f.r0 - r
      dx = tx + 0.9 * Math.max(-1, Math.min(1, err)) * ux; dy = ty + 0.9 * Math.max(-1, Math.min(1, err)) * uy
      vel = 1.0 * f.v * factorNado; giro = 1.2
      zObj = f.z0
      if (f.tModo > 25 + 20 * rnd()) { f.modo = "nadar"; f.tModo = 0 }
    } else {
      // nado circular: tangente + corrección suave hacia el radio preferido (que oscila)
      const rPref = Math.min(R * 0.95, Math.max(0.3, f.r0 + f.ar * Math.sin(f.fr + t * f.wr)))
      const err = (rPref - r) / R
      dx = tx + 2.5 * err * ux; dy = ty + 2.5 * err * uy
      giro = 1.2
      zObj = o2Bajo ? 0.15 + 0.3 * (0.5 + 0.5 * Math.sin(f.fz)) : f.z0 + (noche ? 0.2 * D : 0)
      zObj += f.az * factorNado * Math.sin(f.fz + t * f.wz)
    }
    // pared: empuje hacia adentro
    if (r > 0.95 * R) { dx -= 3 * ux * (r - 0.95 * R) / (0.05 * R); dy -= 3 * uy * (r - 0.95 * R) / (0.05 * R) }
    // ── viraje limitado hacia la dirección deseada
    const deseado = Math.atan2(dy, dx)
    let dphi = deseado - f.phi
    dphi = Math.atan2(Math.sin(dphi), Math.cos(dphi))
    const maxGiro = giro * dt
    f.phi += Math.max(-maxGiro, Math.min(maxGiro, dphi))
    // más lento al virar fuerte
    const vEf = vel * (1 - 0.5 * Math.min(1, Math.abs(dphi) / Math.PI))
    f.x += Math.cos(f.phi) * vEf * dt
    f.y += Math.sin(f.phi) * vEf * dt
    const r2 = Math.hypot(f.x, f.y)
    if (r2 > 0.98 * R) { f.x *= 0.98 * R / r2; f.y *= 0.98 * R / r2 }
    // ── vertical: hacia zObj con velocidad limitada
    const zMax = this.zFondo(Math.min(r2, R)) - 0.12
    const zT = Math.max(0.08, Math.min(zMax, zObj))
    const vz = Math.max(-0.25, Math.min(0.25, (zT - f.z) * 0.6))
    f.z = Math.max(0.08, Math.min(zMax, f.z + vz * dt))
    // ── salto (solo nadando)
    if (t - f.salto < 0.7) {
      const fase = (t - f.salto) / 0.7
      f.z = Math.min(f.z, 0.3) - 0.45 * Math.sin(Math.PI * fase)
      if (fase > 0.95) this.ondas.push({ x: f.x, y: f.y, t0: t })
    } else if (visible && !noche && f.modo === "nadar" && f.z < 0.7 && rnd() < 0.0003 * dt) {
      f.salto = t; this.nSaltos++
      this.ondas.push({ x: f.x, y: f.y, t0: t })
    }
    // ── boqueo en superficie con O₂ bajo
    if (o2Bajo && visible && f.z < 0.3 && rnd() < 0.05 * dt) this.ondas.push({ x: f.x, y: f.y, t0: t, chica: true })
  }

  // Fondo hexagonal: cada celda es una columna hexagonal; su altura sobre el fondo cónico
  // es proporcional al pellet acumulado (kg/m²). Se precalculan los 6 vértices en el plano.
  prepararFondo() {
    const { lado_m: a, celdas } = this.datos.fondo
    this.hexVerts = celdas.map((c) => d3.range(6).map((k) => {
      const ang = Math.PI / 6 + (k * Math.PI) / 3
      return [c.x + a * Math.cos(ang), c.y + a * Math.sin(ang)]
    }))
  }

  redimensionar() {
    const dpr = window.devicePixelRatio || 1
    const { width, height } = this.canvas.getBoundingClientRect()
    this.w = width; this.h = height
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.pedirRender()
  }

  pedirRender() {
    if (this._pendiente) return
    this._pendiente = true
    requestAnimationFrame(() => { this._pendiente = false; this.render() })
  }

  zFondo(r) {
    const e = this.datos.estanque
    return e.profundidad_m + (e.radio_m - r) * e.pendiente_fondo
  }

  // mundo (x, y, z=profundidad) → pantalla; devuelve [sx, sy, profundidadCámara, factorPerspectiva]
  // Cámaras del piloto dentro del estanque: una lateral estéreo para los peces (en la pared,
  // mirando al centro) y una cenital para el alimento del fondo (bajo la superficie, mirando al dren).
  camaras() {
    const e = this.datos.estanque
    const R = e.radio_m, D = e.profundidad_m
    const c = this.camCfg
    const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map((q) => q / n) }
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const base = (f) => {
      let r = cross(f, [0, 0, -1])
      if (Math.hypot(...r) < 1e-6) r = [0, 1, 0]
      r = norm(r)
      return { f, r, u: norm(cross(r, f)) }
    }
    // pares estéreo laterales, repartidos en la pared y mirando al centro; con 2 filas alternan profundidad
    const laterales = []
    const n = Math.max(1, c.n | 0)
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 2 * Math.PI
      const fila = c.filas === 2 ? i % 2 : 0
      const z = c.filas === 2 ? (fila ? Math.min(D * 0.7, D - 0.6) : Math.max(0.5, D * 0.3)) : Math.min(D * 0.45, 1.6)
      const cam = { id: i === 0 ? "lateral" : `lateral${i}`, grupo: "lateral", nombre: "Estéreo peces", pos: [(R - 0.12) * Math.cos(th), (R - 0.12) * Math.sin(th), z],
                    hfov: c.hfov, vfov: c.vfov, near: 0.15, far: Math.min(c.alcance, 2 * R - 0.3), rango: c.rango }
      cam.f = norm([-Math.cos(th), -Math.sin(th), 0.12]); Object.assign(cam, base(cam.f))
      laterales.push(cam)
    }
    const xc = 0.2 * R   // cámara del alimento: mirando al fondo entre el dren y el alimentador
    const zc = c.fondoAltura > 0 ? Math.max(0.12, this.zFondo(xc) - c.fondoAltura) : 0.12
    const dz = this.zFondo(xc) - zc
    const cenital = { id: "cenital", nombre: "Cámara fondo", pos: [xc, 0, zc], hfov: Math.max(50, c.hfov - 10), vfov: Math.round(Math.max(50, c.hfov - 10) * 0.75),
                      near: 0.3, far: dz, rango: [dz - 0.5, dz] }
    cenital.f = norm([-0.12, 0, 1]); Object.assign(cenital, base(cenital.f))
    // tamaño aparente de un pellet de 5 mm con un sensor de 2448 px de ancho (5 MP), a la distancia del fondo
    cenital.pxPellet = (0.005 / (2 * dz * Math.tan((cenital.hfov * Math.PI) / 360))) * 2448
    cenital.grupo = "cenital"
    return [...laterales, cenital]
  }

  // Distancia a lo largo del eje óptico si el punto cae dentro del cono (hasta el alcance); null si no.
  enCampo(cam, x, y, z) {
    const v = [x - cam.pos[0], y - cam.pos[1], z - cam.pos[2]]
    const d = v[0] * cam.f[0] + v[1] * cam.f[1] + v[2] * cam.f[2]
    if (d < cam.near || d > cam.far) return null
    const th = Math.tan((cam.hfov * Math.PI) / 360), tv = Math.tan((cam.vfov * Math.PI) / 360)
    const a = Math.abs(v[0] * cam.r[0] + v[1] * cam.r[1] + v[2] * cam.r[2])
    const b = Math.abs(v[0] * cam.u[0] + v[1] * cam.u[1] + v[2] * cam.u[2])
    return a <= d * th && b <= d * tv ? d : null
  }

  // Cono de visión: cuatro aristas desde la cámara, plano lejano, y la franja de medición útil.
  dibujarCamaras(P, cams, { cuerpo = false } = {}) {
    const ctx = this.ctx
    const color = token("--camara")
    const esquinas = (cam, dist) => {
      const th = Math.tan((cam.hfov * Math.PI) / 360) * dist, tv = Math.tan((cam.vfov * Math.PI) / 360) * dist
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
        [0, 1, 2].map((i) => cam.pos[i] + cam.f[i] * dist + cam.r[i] * th * a + cam.u[i] * tv * b))
    }
    for (const cam of cams) {
      const o = P(...cam.pos)
      const far = esquinas(cam, cam.far).map((q) => P(...q))
      if (!cuerpo) {
        // caras laterales translúcidas (el "triángulo" del ángulo visto de lado o desde arriba)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.07
        for (let i = 0; i < 4; i++) {
          const a = far[i], b = far[(i + 1) % 4]
          ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.closePath(); ctx.fill()
        }
        ctx.globalAlpha = 0.08
        ctx.beginPath(); far.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill()
        // aristas
        ctx.globalAlpha = 0.75
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4, 3])
        for (const [x, y] of far) { ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(x, y); ctx.stroke() }
        ctx.setLineDash([])
        ctx.beginPath(); far.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke()
        // franja donde la medición es confiable (rango útil)
        ctx.lineWidth = 1.5
        for (const dist of cam.rango) {
          if (dist <= cam.near || dist > cam.far + 1e-6) continue
          const q = esquinas(cam, dist).map((v) => P(...v))
          ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke()
        }
        ctx.globalAlpha = 1
      } else {
        // cuerpo de la cámara (todas) y rótulo (solo la primera lateral y la del fondo)
        ctx.fillStyle = color; ctx.strokeStyle = token("--surface-1"); ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(o[0], o[1], 5.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()
        const mira = P(cam.pos[0] + cam.f[0] * 0.35, cam.pos[1] + cam.f[1] * 0.35, cam.pos[2] + cam.f[2] * 0.35)
        ctx.lineWidth = 3; ctx.strokeStyle = color
        ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(mira[0], mira[1]); ctx.stroke()
        if (Math.floor(this.reloj * 1.5) % 2 === 0) { ctx.fillStyle = "#e5484d"; ctx.beginPath(); ctx.arc(o[0] + 7, o[1] - 7, 3, 0, 2 * Math.PI); ctx.fill() }
        if (cam.grupo === "lateral" && cam.id !== "lateral") continue   // las demás laterales: solo cuerpo y REC
        const med = this._enCam.lateral_medibles || 0, cono = this._enCam.lateral || 0, vis = this._enCam.visibles || 1
        const real = Math.round(med * (this.datos.peces_por_eco || 1))
        const nLat = cams.filter((q) => q.grupo === "lateral").length
        ctx.font = "600 11px system-ui, sans-serif"
        const texto = cam.id === "lateral"
          ? `${nLat} ${nLat === 1 ? "par estéreo" : "pares estéreo"} · ${cam.hfov}° · ${fmtN(cam.far, 1)} m · cobertura ${fmtN(100 * cono / vis, 0)} % del cardumen, ${fmtN(100 * med / vis, 0)} % en rango útil ≈ ${fmtN(real, 0)} peces medibles`
          : `Cámara fondo · ${cam.hfov}° · a ${fmtN(cam.far, 1)} m del fondo · pellet de 5 mm ≈ ${fmtN(cam.pxPellet, 0)} px ${cam.pxPellet >= 6 ? "✓" : "✗ muy lejos"} · ${this._enCam.cenital_pellets || 0} en cuadro`
        const tw = ctx.measureText(texto).width
        const tx = Math.min(Math.max(o[0] + 22, 16), this.w - tw - 8)
        const ty = cam.id === "lateral" ? Math.max(14, o[1] - 10) : Math.min(this.h - 6, o[1] + 20)
        ctx.fillStyle = token("--surface-1"); ctx.globalAlpha = 0.85
        ctx.fillRect(tx - 16, ty - 11, tw + 20, 15)
        ctx.globalAlpha = 1
        if (Math.floor(this.reloj * 1.5) % 2 === 0) {   // REC: punto rojo parpadeante
          ctx.fillStyle = "#e5484d"; ctx.beginPath(); ctx.arc(tx - 8, ty - 4, 3.5, 0, 2 * Math.PI); ctx.fill()
        }
        ctx.fillStyle = token("--text-primary")
        ctx.fillText(texto, tx, ty)
      }
    }
  }

  proyector() {
    const e = this.datos.estanque
    const R = e.radio_m, D = e.profundidad_m
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw)
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch)
    const alto = D * cp + 2 * R * sp
    // encuadre: el estanque llena el lienzo en la vista inicial (margen mínimo para el borde)
    const s = this.zoom * Math.min(this.w / (2.04 * R), this.h / (alto * 1.04 + 0.08 * R))
    const camDist = 5 * R
    const cx = this.w / 2 + this.panX, cyS = this.h / 2 + 0.02 * this.h + this.panY
    return (x, y, z) => {
      const H = D / 2 - z
      const xr = x * cy - y * sy
      const yr = x * sy + y * cy
      const v = H * cp + yr * sp
      const d = yr * cp - H * sp
      const k = camDist / (camDist + d)
      return [cx + xr * s * k, cyS - v * s * k, d, k * Math.sqrt(this.zoom)]
    }
  }

  render() {
    if (!this.datos || !this.w) return
    const ctx = this.ctx
    const P = this.proyector()
    const e = this.datos.estanque
    const R = e.radio_m, D = e.profundidad_m
    ctx.clearRect(0, 0, this.w, this.h)
    const wire = token("--wire"), muted = token("--muted")
    // luz del día: oscurece el agua de noche y en el amanecer/atardecer
    const hs = this.horaSim
    const luz = Math.max(0, Math.min(1, (hs - 5.5) / 1.5)) * Math.max(0, Math.min(1, (21.5 - hs) / 1.5))
    if (luz < 1) { ctx.fillStyle = `rgba(8, 18, 40, ${0.45 * (1 - luz)})`; ctx.fillRect(0, 0, this.w, this.h) }

    // ── estructura del estanque: anillos de profundidad y verticales
    ctx.lineWidth = 1
    const anillo = (z, rad, dash) => {
      ctx.beginPath()
      for (let a = 0; a <= 72; a++) {
        const t = (a / 72) * 2 * Math.PI
        const [x, y] = P(rad * Math.cos(t), rad * Math.sin(t), z)
        a ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      }
      ctx.setLineDash(dash); ctx.strokeStyle = wire; ctx.stroke(); ctx.setLineDash([])
    }
    for (let z = 1; z < D; z++) anillo(z, R, [2, 4])
    anillo(D, R, [])
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * 2 * Math.PI
      const [x1, y1] = P(R * Math.cos(t), R * Math.sin(t), 0)
      const [x2, y2] = P(R * Math.cos(t), R * Math.sin(t), D)
      const [x3, y3] = P(0, 0, e.z_centro_m)
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3)
      ctx.strokeStyle = wire; ctx.stroke()
    }

    // ── fondo con alimento (malla con relieve), de atrás hacia adelante
    if (this.capas.fondo) this.dibujarFondo(P)
    // ── cámaras del piloto: conos de visión (detrás de los peces)
    const cams = this.capas.camaras ? this.camaras() : []
    this._enCam = {}
    if (cams.length) this.dibujarCamaras(P, cams)
    const camFondo = cams.find((c) => c.id === "cenital")
    if (camFondo) {   // pellets que la cámara del fondo tiene en cuadro (en el fondo y cayendo)
      let n = 0
      for (const q of this.particulas || []) if (this.enCampo(camFondo, q.r * Math.cos(q.th), q.r * Math.sin(q.th), this.zFondo(q.r) - 0.03) != null) n++
      for (const q of this.pellets || []) if (!q.comido && this.enCampo(camFondo, q.r * Math.cos(q.th), q.r * Math.sin(q.th), q.z) != null) n++
      this._enCam.cenital_pellets = n
    }

    // ── pellet cayendo bajo el alimentador
    const items = []
    const naranja = token("--series-2")
    const cFecas = token("--muted")
    if (this.capas.pellets) {
      for (const q of this.fecas || []) {
        const [sx, sy, d, k] = P(q.r * Math.cos(q.th), q.r * Math.sin(q.th), q.z)
        items.push({ sx, sy, d, r: k * 0.8, c: cFecas, a: 0.7 })
      }
      for (const q of this.fecasFondo || []) {
        const [sx, sy, d, k] = P(q.r * Math.cos(q.th), q.r * Math.sin(q.th), this.zFondo(q.r) - 0.02)
        items.push({ sx, sy, d, r: k * 0.8, c: cFecas, a: 0.6 })
      }
    }
    // mortalidades: pálidos, de lado, sin batir la cola
    const cMuerto = token("--axis")
    for (const m of this.muertos || []) {
      const [sx, sy, d, k] = P(m.r * Math.cos(m.th), m.r * Math.sin(m.th), m.z)
      items.push({ sx, sy, d, r: k * (0.9 + 1.1 * Math.min(2, m.l / 15)), c: cMuerto, a: 0.95, pez: true, ang: m.ang, f: { k: 1.05, wz: 0, fz: 0 }, muerto: true })
    }
    if (this.capas.pellets) {
      for (const p of this.pellets || []) {
        if (p.comido) continue
        const [sx, sy, d, k] = P(p.r * Math.cos(p.th), p.r * Math.sin(p.th), p.z)
        items.push({ sx, sy, d, r: k * 1.5, c: naranja, a: 0.9 })
      }
    }
    if (this.capas.fondo && this.animar) {
      const exag = this.capas.relieve ? 0.03 * e.profundidad_m : 0
      for (const q of this.particulas || []) {
        const [sx, sy, d, k] = P(q.r * Math.cos(q.th), q.r * Math.sin(q.th), this.zFondo(q.r) - 0.03 - exag)
        items.push({ sx, sy, d, r: k * 1.1, c: naranja, a: 0.75 })
      }
    }
    // ── ecos de peces
    this.proyectados = []
    if (this.capas.peces) {
      const [zmin, zmax] = this.corte
      for (const f of this.datos.peces) {
        if (f.z < zmin || f.z > zmax || f.orden > this.fraccion) continue
        const [sx, sy, d, k] = P(f.x, f.y, f.z)
        // rumbo real del pez (phi), proyectado a pantalla
        const phi = f.phi ?? Math.atan2(f.y, f.x) - Math.PI / 2
        const [hx, hy] = P(f.x + 0.3 * Math.cos(phi), f.y + 0.3 * Math.sin(phi), f.z)
        const it = { sx, sy, d, r: k * (0.9 + 1.1 * Math.min(2, f.w / this.pesoRef)), c: this.escalaPeso(f.w), a: 0.9, f,
                     ang: Math.atan2(hy - sy, hx - sx), pez: true }
        let enCono = false, dMin = null, farRef = 1
        for (const cam of cams) {
          if (cam.grupo !== "lateral") continue
          const d = this.enCampo(cam, f.x, f.y, f.z)
          if (d == null) continue
          enCono = true
          if (d >= cam.rango[0] && d <= cam.rango[1] && (dMin == null || d < dMin)) { dMin = d; farRef = cam.far }
        }
        if (enCono) this._enCam.lateral = (this._enCam.lateral || 0) + 1
        if (dMin != null) {
          this._enCam.lateral_medibles = (this._enCam.lateral_medibles || 0) + 1
          it.enCam = true
          // confianza simulada del detector: baja con la distancia y un poco de ruido estable por pez
          it.conf = Math.min(0.97, Math.max(0.35, 0.98 - 0.4 * (dMin / farRef) - 0.1 * ((Math.sin(f.x * 12.9898 + f.y * 78.233) * 43758.5453) % 1 + 1) % 1))
        }
        this._enCam.visibles = (this._enCam.visibles || 0) + 1
        items.push(it)
        this.proyectados.push(it)
        if (this.hoverIt && this.hoverIt.f === f) this.hoverIt = it
      }
    }
    items.sort((a, b) => b.d - a.d)
    const reloj = this.reloj
    const cCam = token("--camara")
    ctx.font = "600 9px system-ui, sans-serif"
    for (const it of items) {
      ctx.globalAlpha = it.a
      ctx.fillStyle = it.c
      if (it.pez) this.dibujarPez(it, it.muerto ? 0 : reloj)
      else { ctx.beginPath(); ctx.arc(it.sx, it.sy, it.r, 0, 2 * Math.PI); ctx.fill() }
      if (it.enCam) {   // predicción YOLO (simulada) discreta: caja fina y, si el pez se ve grande, su %
        const hw = it.r * 2.3 + 2, hh = it.r * 1.3 + 2
        ctx.globalAlpha = 0.45; ctx.strokeStyle = cCam; ctx.lineWidth = 1
        ctx.strokeRect(it.sx - hw, it.sy - hh, 2 * hw, 2 * hh)
        if (it.r > 5.5) { ctx.globalAlpha = 0.85; ctx.fillStyle = cCam; ctx.fillText(`${Math.round(it.conf * 100)}%`, it.sx - hw, it.sy - hh - 2) }
      }
    }
    ctx.globalAlpha = 1
    if (cams.length) this.dibujarCamaras(P, cams, { cuerpo: true })

    // ── ondas en la superficie (saltos y boqueo)
    ctx.lineWidth = 1.2
    for (const o of this.ondas || []) {
      const edad = (this.reloj - o.t0) / 1.2
      const rad = (o.chica ? 0.08 : 0.15) + (o.chica ? 0.15 : 0.45) * edad
      ctx.globalAlpha = 0.7 * (1 - edad)
      ctx.strokeStyle = token("--text-secondary")
      ctx.beginPath()
      for (let a = 0; a <= 24; a++) {
        const tt = (a / 24) * 2 * Math.PI
        const [x, y] = P(o.x + rad * Math.cos(tt), o.y + rad * Math.sin(tt), 0)
        a ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    // ── borde de superficie, encima de todo
    anillo(0, R, [])
    // escala de profundidad sobre una vertical visible
    const t = -this.yaw - Math.PI / 2 + 0.35
    ctx.fillStyle = muted
    ctx.font = "11px system-ui, sans-serif"
    for (let z = 0; z <= D; z++) {
      const [x, y] = P(R * 1.03 * Math.cos(t), R * 1.03 * Math.sin(t), z)
      ctx.fillText(`${z} m`, x + 4, y + 3)
    }
    if (this.hoverIt) {
      this.marcarHover(this.hoverIt)
      this.ubicarTip(this.hoverIt)
    }
  }

  // Recuadro "lo que ve la cámara": proyección pinhole desde la cámara, con los peces (o pellets)
  // que caen dentro del cono dibujados y encerrados en cajas de detección con una confianza simulada.
  dibujarVistaCamara(cam, target) {
    const ctx = target.getContext("2d")
    const W = target.width, H = target.height
    const x0 = 0, y0 = 0
    ctx.clearRect(0, 0, W, H)
    const color = token("--camara")
    const th = Math.tan((cam.hfov * Math.PI) / 360), tv = Math.tan((cam.vfov * Math.PI) / 360)
    const proj = (x, y, z) => {
      const v = [x - cam.pos[0], y - cam.pos[1], z - cam.pos[2]]
      const d = v[0] * cam.f[0] + v[1] * cam.f[1] + v[2] * cam.f[2]
      if (d <= 0.05) return null
      const a = (v[0] * cam.r[0] + v[1] * cam.r[1] + v[2] * cam.r[2]) / (d * th)
      const b = (v[0] * cam.u[0] + v[1] * cam.u[1] + v[2] * cam.u[2]) / (d * tv)
      return { sx: x0 + W / 2 + (a * W) / 2, sy: y0 + H / 2 - (b * H) / 2, d, dentro: Math.abs(a) <= 1 && Math.abs(b) <= 1 && d >= cam.near && d <= cam.far }
    }
    // agua (más turbia hacia el fondo del alcance)
    ctx.save()
    ctx.beginPath(); ctx.rect(x0, y0, W, H); ctx.clip()
    const agua = ctx.createLinearGradient(0, y0, 0, y0 + H)
    const esCenital = cam.id === "cenital"
    agua.addColorStop(0, esCenital ? "#3b5f6e" : "#355f72"); agua.addColorStop(1, esCenital ? "#6f6a55" : "#1c3540")
    ctx.fillStyle = agua; ctx.fillRect(x0, y0, W, H)
    if (!esCenital) {  // franja de luz de la superficie
      const luz = ctx.createLinearGradient(0, y0, 0, y0 + H * 0.35)
      luz.addColorStop(0, "rgba(200,230,240,0.35)"); luz.addColorStop(1, "rgba(200,230,240,0)")
      ctx.fillStyle = luz; ctx.fillRect(x0, y0, W, H * 0.35)
    }
    const seed = (n) => { const q = Math.sin(n * 12.9898) * 43758.5453; return q - Math.floor(q) }
    const dets = []
    const azul = token("--series-1"), naranja = token("--series-2")
    if (!esCenital) {
      const [zmin, zmax] = this.corte
      for (const f of this.datos.peces) {
        if (f.z < zmin || f.z > zmax || f.orden > this.fraccion) continue
        const q = proj(f.x, f.y, f.z)
        if (!q || !q.dentro) continue
        const L = (f.l || 15) / 100                      // largo en metros
        const phi = f.phi ?? 0
        const cab = proj(f.x + 0.5 * L * Math.cos(phi), f.y + 0.5 * L * Math.sin(phi), f.z)
        const px = (L / q.d) * (W / 2) / th              // largo en píxeles del recuadro
        const ang = cab ? Math.atan2(cab.sy - q.sy, cab.sx - q.sx) : 0
        const vis = Math.max(0.15, 1 - q.d / (cam.far * 1.15))   // se desvanece con la distancia (turbidez)
        const conf = Math.min(0.97, Math.max(0.3, 0.98 - 0.45 * (q.d / cam.far) - 0.12 * seed(f.x * 7 + f.y * 3 + Math.floor(this.reloj / 1.5))))
        dets.push({ ...q, px, ang, vis, conf, f, etiqueta: "pez" })
      }
    } else {
      for (const pt of [...(this.particulas || []), ...(this.pellets || []).filter((p) => !p.comido)]) {
        const x = pt.r * Math.cos(pt.th), y = pt.r * Math.sin(pt.th)
        const z = pt.z ?? this.zFondo(pt.r) - 0.03
        const q = proj(x, y, z)
        if (!q || !q.dentro) continue
        const conf = Math.min(0.95, Math.max(0.3, 0.9 - 0.35 * (q.d / cam.far) - 0.1 * seed(x * 11 + y * 5 + Math.floor(this.reloj / 1.5))))
        dets.push({ ...q, px: (0.02 / q.d) * (W / 2) / th + 2, ang: 0, vis: 1, conf, etiqueta: "pellet" })
      }
    }
    dets.sort((a, b) => b.d - a.d)
    const mostrar = dets.slice(-80)   // las más cercanas si hay demasiadas
    const conRotulo = new Set(mostrar.filter((d) => d.etiqueta === "pez").sort((a, b) => b.px - a.px).slice(0, 10))
    for (const d of mostrar) {
      ctx.globalAlpha = d.vis
      if (d.etiqueta === "pez") {
        ctx.save(); ctx.translate(d.sx, d.sy); ctx.rotate(d.ang)
        const a = d.px / 2, b = Math.max(1.5, d.px * 0.17)
        ctx.fillStyle = this.escalaPeso ? this.escalaPeso(d.f.w) : azul
        ctx.beginPath(); ctx.ellipse(0, 0, a, b, 0, 0, 2 * Math.PI); ctx.fill()
        ctx.beginPath(); ctx.moveTo(-a, 0); ctx.lineTo(-a - b * 1.6, -b * 1.1); ctx.lineTo(-a - b * 1.6, b * 1.1); ctx.closePath(); ctx.fill()
        ctx.restore()
        // caja de detección y confianza
        const hw = Math.abs(Math.cos(d.ang)) * d.px / 2 + Math.abs(Math.sin(d.ang)) * d.px * 0.17 + 3
        const hh = Math.abs(Math.sin(d.ang)) * d.px / 2 + Math.abs(Math.cos(d.ang)) * d.px * 0.17 + 3
        ctx.globalAlpha = Math.min(1, d.vis + 0.2)
        ctx.strokeStyle = color; ctx.lineWidth = 1.2
        ctx.strokeRect(d.sx - hw, d.sy - hh, 2 * hw, 2 * hh)
        if (d.px > 18 && conRotulo.has(d)) {
          ctx.font = "600 16px system-ui, sans-serif"
          const t = `pez ${Math.round(d.conf * 100)}%`
          ctx.fillStyle = color; ctx.fillRect(d.sx - hw, d.sy - hh - 19, ctx.measureText(t).width + 8, 19)
          ctx.fillStyle = "#fff"; ctx.fillText(t, d.sx - hw + 4, d.sy - hh - 4)
        }
      } else {
        ctx.fillStyle = naranja
        ctx.beginPath(); ctx.arc(d.sx, d.sy, Math.max(1.5, d.px / 2), 0, 2 * Math.PI); ctx.fill()
        ctx.strokeStyle = color; ctx.lineWidth = 1
        const hw = Math.max(3, d.px / 2 + 2)
        ctx.strokeRect(d.sx - hw, d.sy - hw, 2 * hw, 2 * hw)
      }
    }
    ctx.globalAlpha = 1
    // retícula y REC
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5
    ctx.strokeRect(x0 + 12, y0 + 12, W - 24, H - 24)
    ctx.beginPath(); ctx.moveTo(x0 + W / 2 - 12, y0 + H / 2); ctx.lineTo(x0 + W / 2 + 12, y0 + H / 2); ctx.moveTo(x0 + W / 2, y0 + H / 2 - 12); ctx.lineTo(x0 + W / 2, y0 + H / 2 + 12); ctx.stroke()
    const parpadeo = Math.floor(this.reloj * 1.5) % 2 === 0
    const hs = this.horaSim, hh = Math.floor(hs), mm = Math.floor((hs - hh) * 60), ss = Math.floor(((hs - hh) * 60 - mm) * 60)
    ctx.font = "600 17px ui-monospace, Menlo, monospace"
    if (parpadeo) { ctx.fillStyle = "#e5484d"; ctx.beginPath(); ctx.arc(x0 + 22, y0 + H - 20, 7, 0, 2 * Math.PI); ctx.fill() }
    ctx.fillStyle = "#fff"
    ctx.fillText(`REC ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`, x0 + 38, y0 + H - 14)
    const nDet = dets.length
    const txt = esCenital ? `${nDet} pellets en cuadro` : `${nDet} peces detectados`
    ctx.textAlign = "right"; ctx.fillText(txt, x0 + W - 14, y0 + H - 14); ctx.textAlign = "left"
    ctx.restore()
  }

  ubicarTip(it) {
    const f = it.f
    const k = f.k || 1.15
    const cond = k < 1.0 ? "delgado" : k > 1.3 ? "robusto" : "normal"
    const rezagado = f.w < 0.5 * this.pesoRef ? " · <b>rezagado</b>" : ""
    this.tip.innerHTML = `<div class="t">Eco de pez${rezagado}</div>
      Peso estimado <b>${fmtN(f.w, 0)} g</b> · largo ${fmtN(f.l)} cm<br>Condición K ${fmtN(k, 2)} (${cond}) · TS ${fmtN(f.ts)} dB<br>Profundidad ${fmtN(f.z, 2)} m`
    this.tip.style.left = `${Math.min(it.sx + 14, this.w - 190)}px`
    this.tip.style.top = `${Math.max(4, it.sy - 70)}px`
  }

  // Pez estilizado: cuerpo elíptico orientado según el rumbo, cola bifurcada que bate,
  // y ojo cuando está lo bastante cerca. r es el "radio" base en píxeles.
  dibujarPez(it, reloj) {
    const ctx = this.ctx
    const { sx, sy, r, ang, f } = it
    // K alto → cuerpo más alto y algo más corto; K bajo → alargado y fino
    const kk = (f.k || 1.15) / 1.15
    const L = 2.6 * r * Math.cbrt(1 / kk), H = 0.85 * r * Math.sqrt(kk) * kk
    const cos = Math.cos(ang), sin = Math.sin(ang)
    // cuerpo
    ctx.beginPath()
    ctx.ellipse(sx, sy, L, H, ang, 0, 2 * Math.PI)
    ctx.fill()
    // cola: triángulo bifurcado en la parte trasera, batiendo
    const rapido = f.modo === "comer" || f.modo === "acudir" ? 1.8 : 1
    const bate = Math.sin(reloj * rapido * (f.wz ? 5 + 6 * f.wz : 7) + (f.fz || 0)) * 0.55
    const cb = Math.cos(ang + bate), sb = Math.sin(ang + bate)
    const bx = sx - L * 0.9 * cos, by = sy - L * 0.9 * sin        // base de la cola
    const tl = 1.3 * r, tw = 1.1 * r
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx - tl * cb - tw * sb, by - tl * sb + tw * cb)
    ctx.lineTo(bx - tl * 0.55 * cb, by - tl * 0.55 * sb)
    ctx.lineTo(bx - tl * cb + tw * sb, by - tl * sb - tw * cb)
    ctx.closePath()
    ctx.fill()
    if (r > 3.5) {
      // aleta dorsal y ojo
      ctx.globalAlpha *= 0.8
      ctx.beginPath()
      ctx.moveTo(sx - 0.2 * L * cos, sy - 0.2 * L * sin)
      ctx.lineTo(sx - 0.1 * L * cos + 1.5 * H * sin, sy - 0.1 * L * sin - 1.5 * H * cos)
      ctx.lineTo(sx + 0.3 * L * cos, sy + 0.3 * L * sin)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = it.a
      ctx.fillStyle = token("--surface-1")
      ctx.beginPath()
      ctx.arc(sx + 0.62 * L * cos - 0.3 * H * sin, sy + 0.62 * L * sin + 0.3 * H * cos, Math.max(0.8, 0.25 * r), 0, 2 * Math.PI)
      ctx.fill()
    }
  }

  dibujarFondo(P) {
    const ctx = this.ctx
    const e = this.datos.estanque
    const D = e.profundidad_m
    const { celdas } = this.datos.fondo
    const exag = this.capas.relieve ? (0.14 * D) / this.kgM2Max : 0
    const borde = token("--surface-1")
    const hexes = celdas.map((c, i) => {
      const h = exag * c.kg_m2
      const top = this.hexVerts[i].map(([x, y]) => P(x, y, this.zFondo(Math.hypot(x, y)) - h))
      const base = h > 0.01 ? this.hexVerts[i].map(([x, y]) => P(x, y, this.zFondo(Math.hypot(x, y)))) : null
      return { top, base, d: (top[0][2] + top[3][2]) / 2, c }
    })
    hexes.sort((a, b) => b.d - a.d)
    for (const hx of hexes) {
      const alpha = 0.25 + 0.75 * Math.min(1, Math.sqrt(hx.c.kg_m2 / this.kgM2Max) * 1.6)
      const color = this.escalaAlim(hx.c.kg_m2)
      // paredes de la columna (solo las caras que miran a la cámara: las más cercanas)
      if (hx.base) {
        ctx.globalAlpha = alpha * 0.8
        ctx.fillStyle = d3.color(color).darker(0.6).formatHex()
        for (let k = 0; k < 6; k++) {
          const k2 = (k + 1) % 6
          const dMid = (hx.base[k][2] + hx.base[k2][2]) / 2
          if (dMid > hx.d) continue       // cara trasera
          ctx.beginPath()
          ctx.moveTo(hx.top[k][0], hx.top[k][1]); ctx.lineTo(hx.top[k2][0], hx.top[k2][1])
          ctx.lineTo(hx.base[k2][0], hx.base[k2][1]); ctx.lineTo(hx.base[k][0], hx.base[k][1])
          ctx.closePath(); ctx.fill()
        }
      }
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.beginPath()
      hx.top.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath(); ctx.fill()
      ctx.globalAlpha = 0.35
      ctx.strokeStyle = borde; ctx.lineWidth = 0.6; ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  get pesoRef() { return this._pesoRef ||= d3.median(this.datos.peces, (f) => f.w) }

  hover(ev) {
    if (this.arrastrando || !this.proyectados.length) return
    const rect = this.canvas.getBoundingClientRect()
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
    let mejor = null, dmin = 144
    for (const it of this.proyectados) {
      const d2 = (it.sx - mx) ** 2 + (it.sy - my) ** 2
      if (d2 < dmin) { dmin = d2; mejor = it }
    }
    this.hoverIt = mejor
    if (!mejor) return this.ocultarTip()
    this.tip.hidden = false
    this.ubicarTip(mejor)
    this.pedirRender()
  }

  marcarHover(it) {
    const ctx = this.ctx
    ctx.beginPath(); ctx.arc(it.sx, it.sy, 2.8 * it.r + 4, 0, 2 * Math.PI)
    ctx.lineWidth = 2; ctx.strokeStyle = token("--text-primary"); ctx.stroke()
  }

  ocultarTip() {
    this.tip.hidden = true
    if (this.hoverIt) { this.hoverIt = null; this.pedirRender() }
  }

  dibujarLeyenda([wmin, wmax]) {
    this._pesoRef = null
    const grad = (esc, a, b) => `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((t) => esc(a + t * (b - a))).join(",")})`
    this.leyenda.innerHTML = `
      <div class="rampa"><span>Peso</span><span>${fmtN(wmin, 0)} g</span><span class="barra-color" style="background:${grad(this.escalaPeso, wmin, wmax)}"></span><span>${fmtN(wmax, 0)} g</span></div>
      <div class="rampa"><span>Alimento</span><span>0</span><span class="barra-color" style="background:${grad(this.escalaAlim, 0, this.kgM2Max)}"></span><span>${fmtN(this.kgM2Max, 2)} kg/m²</span></div>
      <div class="rampa"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${token("--series-2")}"></span><span>Pellet cayendo y en el fondo</span></div>
      <div class="rampa"><span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${token("--muted")}"></span><span>Fecas</span>
        <span style="display:inline-block;width:14px;height:6px;border-radius:3px;background:${token("--axis")};margin-left:8px"></span><span>Mortalidad</span></div>
      <div class="rampa"><span style="display:inline-block;width:12px;height:8px;background:${token("--camara")};opacity:.35;border:1px dashed ${token("--camara")}"></span><span>Conos de los pares estéreo y de la cámara del fondo (franja = rango útil) · caja fina = pez detectado (simulado)</span></div>`
  }
}

