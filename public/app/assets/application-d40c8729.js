import { montarEstanque } from "viz/estanque"
import { montarIndice } from "viz/indice"

document.addEventListener("DOMContentLoaded", () => {
  const raiz = document.querySelector("[data-estanque]")
  if (raiz) montarEstanque(raiz)
  document.querySelectorAll("[data-mini-fondo]").forEach(montarIndice)
})
