// Registro en tiempo real: pequeñas series que crecen punto a punto (N de peces, peso medio,
// alimento en el fondo, peces detectados por la cámara). Una serie por gráfico, línea fina,
// valor actual rotulado al final; sin leyenda porque el título nombra la serie.
import * as d3 from "d3"
import { fmtN } from "viz/formato"

const MAX_PUNTOS = 120   // a 2 s por punto: 4 minutos en pantalla

export function crearRegistro(raiz, series) {
  const paneles = new Map()
  for (const s of series) {
    const fig = document.createElement("figure")
    fig.className = "chispa"
    fig.innerHTML = `<figcaption><span class="chispa-titulo">${s.titulo}</span><span class="chispa-valor" aria-live="off">–</span></figcaption>`
    const svg = d3.select(fig).append("svg").attr("viewBox", "0 0 340 56").attr("preserveAspectRatio", "none").attr("role", "img").attr("aria-label", s.titulo)
    svg.append("path").attr("class", "chispa-area").attr("style", `fill:${s.color};fill-opacity:0.10`)
    svg.append("path").attr("class", "chispa-linea").attr("style", `stroke:${s.color}`)
    svg.append("circle").attr("class", "chispa-punto").attr("r", 2.6).attr("style", `fill:${s.color}`)
    raiz.appendChild(fig)
    paneles.set(s.clave, { ...s, fig, svg, datos: [] })
  }
  const lista = document.createElement("ol")
  lista.className = "registro-lista"
  raiz.appendChild(lista)

  const x = d3.scaleLinear().range([2, 338])
  const y = d3.scaleLinear().range([52, 6])
  const linea = d3.line().x((d) => x(d.i)).y((d) => y(d.v)).curve(d3.curveMonotoneX)
  const area = d3.area().x((d) => x(d.i)).y0(54).y1((d) => y(d.v)).curve(d3.curveMonotoneX)
  let n = 0

  function dibujar(p) {
    const d = p.datos
    if (!d.length) return
    x.domain([d[0].i, Math.max(d[d.length - 1].i, d[0].i + 10)])
    const [lo, hi] = d3.extent(d, (q) => q.v)
    const holgura = (hi - lo) * 0.25 || Math.abs(hi) * 0.01 || 1
    y.domain([lo - holgura, hi + holgura])
    p.svg.select(".chispa-linea").attr("d", linea(d))
    p.svg.select(".chispa-area").attr("d", area(d))
    const u = d[d.length - 1]
    p.svg.select(".chispa-punto").attr("cx", x(u.i)).attr("cy", y(u.v))
    p.fig.querySelector(".chispa-valor").textContent = `${fmtN(u.v, p.dec)} ${p.unidad}`.trim()
  }

  return {
    // valores: { clave: número } — las claves ausentes no agregan punto a su serie
    agregar(etiqueta, valores) {
      n += 1
      for (const [clave, v] of Object.entries(valores)) {
        const p = paneles.get(clave)
        if (!p || v == null || Number.isNaN(v)) continue
        p.datos.push({ i: n, v })
        if (p.datos.length > MAX_PUNTOS) p.datos.shift()
        dibujar(p)
      }
      const fila = document.createElement("li")
      fila.innerHTML = `<span class="mono">${etiqueta}</span>` + series.filter((s) => valores[s.clave] != null)
        .map((s) => `<span><b>${fmtN(valores[s.clave], s.dec)}</b> ${s.corto || s.unidad}</span>`).join("")
      lista.prepend(fila)
      while (lista.children.length > 6) lista.lastChild.remove()
    }
  }
}
