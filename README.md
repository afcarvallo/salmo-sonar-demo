# SalmoSonar · demo estática

Versión de demostración de SalmoSonar sin servidor: estanques con sonar 3D simulado, cámaras con
detección YOLO sobre video real y la sección Visión (datasets, resultados de modelos y videos), con
todos los datos **precomputados** en `public/app/`. No hay modelos corriendo ni datasets completos:
solo las páginas, los JSON del simulador, cuadros de video con sus detecciones y miniaturas.

## Montar en Lovable

1. Subir este repositorio a GitHub (público, o con acceso para la cuenta de GitHub conectada a Lovable).
2. En Lovable: **Create new project → Import from GitHub** y elegir el repo.
   Es un proyecto Vite sin React: Lovable lo construye con `npm run build` y lo publica tal cual.
3. **Publish**. La raíz redirige a `app/index.html`.

También sirve en GitHub Pages, Netlify o Vercel (carpeta `public/`, sin build).

## Regenerar la demo

Desde el repositorio `salmo-sonar`, con la app corriendo (Rails en :3800 y el servicio de visión en :8601):

    python3 script/exportar_demo.py --salida ../salmo-sonar-demo/public/app --limpiar

## Qué funciona y qué no

- Funciona: navegación entre estanques y escaneos (nubes 3D de los 240 escaneos por estanque,
  comprimidas), animación y comportamiento, cámaras simuladas, registro en tiempo real, ventanas de
  video con detecciones (cuadros precomputados en bucle), datasets (12 miniaturas por dataset y 3
  páginas de imagen), resultados de los modelos (12 imágenes por corrida).
- No funciona (necesita la GPU): "Correr el modelo sobre esta imagen", elegir en el reproductor un
  modelo sin cuadros precomputados, y la paginación/orden de las galerías.
