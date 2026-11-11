import { defineConfig } from "vite";

// La demo es un sitio estático ya generado (public/app). Vite solo lo sirve y lo copia al build.
export default defineConfig({
  server: { host: true, port: 8080 },
  build: { outDir: "dist" },
});
