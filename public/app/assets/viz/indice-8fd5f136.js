import { fondoSuperior } from "viz/graficos"

// Mini vista superior del fondo en las tarjetas del índice
export async function montarIndice(el) {
  const estatico = document.querySelector('meta[name="salmo-static"]')?.content
  const m = el.dataset.miniFondo.match(/estanques\/([^/]+)\/nube\?escaneo_id=(\d+)/)
  const nube = estatico && m
    ? await fetch(`${estatico}data/nube/${m[1]}-${m[2]}.json.gz`).then((r) => new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json())
    : await fetch(el.dataset.miniFondo).then((r) => r.json())
  fondoSuperior(el, nube, +el.dataset.kgMax, { mini: true })
}
