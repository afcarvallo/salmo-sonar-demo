import * as d3 from "d3"

const loc = d3.formatLocale({ decimal: ",", thousands: ".", grouping: [3], currency: ["$", ""] })
export const fmtN = (v, d = 1) => (v == null || Number.isNaN(v) ? "—" : loc.format(`,.${d}f`)(v))
export const fmtFecha = d3.timeFormat("%d-%m %H:%M")
export const fmtDia = d3.timeFormat("%d-%m")
