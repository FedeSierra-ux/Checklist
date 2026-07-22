# Pendientes

App de tareas pendientes, minimalista y enfocada. Corre como **web (PWA)** y como
**app Android (APK)** con notificaciones del sistema y widget en la pantalla de
inicio. Todo se guarda en tu dispositivo — sin cuentas ni servidores.

## Qué hace

- **Hoy · Semana · Mes · Compras** en una sola barra de navegación.
- **Vista Hoy** — solo lo de hoy y lo vencido, sin ruido.
- **Prioridades** en 4 niveles con color (alta / media / baja / ninguna); lo
  urgente sube arriba.
- **Deadlines** con fecha y hora, ordenados por urgencia.
- **Subtareas / checklist** dentro de cada tarea, con progreso.
- **Etiquetas** (`#salud`, `#casa`) y **buscador** global.
- **Escritura natural**: escribís *"mañana 15:00 pedir turno #salud !alta"* y
  entiende fecha, hora, prioridad y etiqueta solas.
- **Listas de compras** con ítems tildables.
- **Notificaciones** antes de cada vencimiento y resumen del día.
- **Tema claro/oscuro** automático.

## Dos formas de usarla

### 1) Web / PWA (la más rápida)

Es un sitio estático (HTML + CSS + JS, sin dependencias). Serví la raíz:

```bash
python3 -m http.server 8000
# abrí http://localhost:8000
```

Publicala gratis en GitHub Pages / Netlify / Vercel apuntando a la **raíz** del
repo. En el celular: Chrome/Safari → *Agregar a la pantalla de inicio*.

Limitación de la PWA: las notificaciones son **locales** (solo con la app abierta
o en segundo plano) y **no** hay widget nativo. Para eso está el APK.

### 2) APK de Android (notificaciones con la app cerrada + widget)

El APK se arma con [Capacitor](https://capacitorjs.com/), que envuelve la misma
app web. Ventajas sobre la PWA:

- **Notificaciones a nivel del sistema** (AlarmManager) que disparan **aunque la
  app esté cerrada**.
- **Widget** en la pantalla de inicio con los pendientes de hoy; podés tildarlos
  desde ahí.
- Se instala como app real (no como atajo).

#### Opción A — Compilar en GitHub (sin instalar nada)

Este repo trae un workflow de GitHub Actions. Andá a la pestaña **Actions →
"Compilar APK" → Run workflow**. Al terminar, descargá el artefacto
`pendientes-apk` (`app-debug.apk`) y pasalo a tu teléfono.

#### Opción B — Compilar en tu máquina

Requisitos: Node 18+, JDK 17 y el Android SDK (Android Studio).

```bash
npm install
npm run build:apk
# APK en: android/app/build/outputs/apk/debug/app-debug.apk
```

Para instalarlo, habilitá "Instalar apps de orígenes desconocidos" y abrí el APK,
o con el teléfono conectado: `adb install app-debug.apk`.

> El primer arranque pide permiso de **notificaciones**. En Android 12+ puede
> pedir además permiso de **alarmas exactas** para avisar con precisión.

## Cómo está organizado

```
index.html              App (raíz = única fuente de verdad, sirve para la PWA)
css/styles.css          Estilos (tema claro/oscuro, tipografía Manrope embebida)
js/app.js               Lógica: tareas, prioridades, Hoy, subtareas, tags,
                        búsqueda, notificaciones y puente nativo
sw.js                   Service worker (cache offline de la PWA)
manifest.webmanifest    Metadatos PWA
icons/ · assets/fonts/  Íconos y tipografía

capacitor.config.json   Config de Capacitor (webDir = www)
scripts/copy-web.mjs    Copia la app web a www/ antes de compilar
android/                Proyecto Android (Capacitor)
  ├─ …/PendientesWidget.java   Widget de pantalla de inicio
  ├─ …/WidgetService.java      Filas del widget (lee los datos de la app)
  └─ …/WidgetBridgePlugin.java Refresca el widget cuando cambian los datos
.github/workflows/build-apk.yml  Compila el APK en la nube
```

`www/` es un artefacto de build (se regenera con `npm run copy:web`) y no se
versiona.

## Cómo funcionan las notificaciones y el widget (APK)

- Al guardar o completar tareas, la app **reprograma** en el sistema todas las
  notificaciones futuras. Por eso disparan aunque la app esté cerrada.
- La app espeja los pendientes de hoy en `SharedPreferences`; el widget los lee y
  los muestra. Al tildar en el widget, la tarea se marca y la app se sincroniza al
  abrirse.

## Privacidad

Todos los datos viven en el dispositivo (`localStorage` en web /
`SharedPreferences` en Android). Nada se envía a ningún servidor.
