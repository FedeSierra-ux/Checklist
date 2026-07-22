# Pendientes

App simple e **instalable (PWA)** para gestionar tus tareas pendientes. Funciona
offline y guarda todo en tu teléfono — sin cuentas ni servidores.

## Qué hace

- **Semana / Mes** — vé lo pendiente de esta semana agrupado por día, o el mes
  completo en un calendario con puntos que marcan los días con vencimientos.
- **Tareas con deadline** — fecha y hora límite, ordenadas por urgencia y
  pintadas según cuánto falta (vencida · hoy · próxima).
- **Tildar y sacar** — un toque marca la tarea como hecha, se tacha y se archiva.
- **Listas de compras** — listas aparte con ítems tildables (ej. Supermercado).
- **Notificaciones** — aviso local antes de cada vencimiento (configurable: a la
  hora, 30 min, 1 h, 3 h o 1 día antes) y un resumen de lo pendiente al abrir.
- **Instalable** — "Agregar a la pantalla de inicio" y se abre como app nativa.

## Cómo usarla

Es un sitio estático (HTML + CSS + JS, sin dependencias). Serví la carpeta con
cualquier servidor:

```bash
python3 -m http.server 8000
# luego abrí http://localhost:8000
```

Para que funcionen las notificaciones y la instalación, debe servirse por
**HTTPS** (o `localhost`). Podés publicarla gratis en GitHub Pages, Netlify o
Vercel apuntando a la raíz del repo.

### Instalar en el celular

1. Abrí la URL en Chrome (Android) o Safari (iPhone).
2. Android: aparece el banner **"Instalar Pendientes"**, o menú → *Instalar app*.
3. iPhone: botón compartir → *Agregar a inicio*.

## Estructura

```
index.html              Estructura de la app
css/styles.css          Estilos (tema claro y oscuro automáticos)
js/app.js               Lógica: tareas, calendario, compras, avisos
sw.js                   Service worker (cache offline + notificaciones)
manifest.webmanifest    Metadatos de la PWA
icons/                  Íconos (SVG + PNG)
```

## Notas sobre las notificaciones

Las notificaciones son **locales**: se programan mientras la app está abierta o
en segundo plano. Para avisos garantizados con la app cerrada haría falta un
servidor de *push* — se puede agregar más adelante si lo necesitás.

## Privacidad

Todos los datos viven en `localStorage` de tu dispositivo. Nada se envía a
ningún servidor.
