import * as d3 from "d3"

export function esOscuro() {
  const t = document.documentElement.dataset.theme
  if (t === "dark") return true
  if (t === "light") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function token(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
}

// Secuencial azul (magnitud: peso de los peces). En oscuro, lo bajo es oscuro y lo alto claro.
const AZUL_CLARO = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281", "#0d366b"]
const AZUL_OSCURO = ["#1c5cab", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"]
// Secuencial naranja (segundo contexto secuencial: alimento en el fondo).
const NARANJA_CLARO = ["#fbe3d6", "#f6b896", "#ef8d5f", "#eb6834", "#c24e1f", "#8a3310"]
const NARANJA_OSCURO = ["#3b2318", "#6e3317", "#a6431b", "#d95926", "#f08a5c", "#ffc7a8"]

export function rampaPeso(dominio) {
  return d3.scaleSequential(d3.piecewise(d3.interpolateLab, esOscuro() ? AZUL_OSCURO : AZUL_CLARO)).domain(dominio).clamp(true)
}

export function rampaAlimento(max) {
  return d3.scaleSequentialSqrt(d3.piecewise(d3.interpolateLab, esOscuro() ? NARANJA_OSCURO : NARANJA_CLARO)).domain([0, max]).clamp(true)
}

// Divergente azul ↔ rojo con gris neutro al centro (correlaciones).
export function rampaDivergente() {
  const oscuro = esOscuro()
  const mid = oscuro ? "#383835" : "#f0efec"
  const neg = oscuro ? "#5598e7" : "#1c5cab"
  const pos = oscuro ? "#e66767" : "#c43c3b"
  // dominio −1 … 0 … 1, cada brazo con la misma cantidad de pasos
  const izq = d3.interpolateLab(mid, neg)
  const der = d3.interpolateLab(mid, pos)
  return (v) => (v < 0 ? izq(Math.min(1, -v)) : der(Math.min(1, v)))
}

export function tintaSobre(color) {
  const c = d3.lab(color)
  return c.l > 60 ? "#0b0b0b" : "#ffffff"
}

export const ESTADOS = {
  ok: { color: "#0ca30c", icono: "✓", texto: "Normal" },
  aviso: { color: "#fab219", icono: "!", texto: "Aviso" },
  serio: { color: "#ec835a", icono: "!!", texto: "Serio" },
  critico: { color: "#d03b3b", icono: "✕", texto: "Crítico" },
}
