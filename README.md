# Tudu

App de tareas pendientes, minimalista y enfocada. Corre como **web (PWA)** y como
**app Android (APK)** con notificaciones del sistema y widget en la pantalla de
inicio. Todo se guarda en tu dispositivo — sin cuentas ni servidores; y si
querés, se sincroniza con tus otros dispositivos con un código.

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
- **Sincronización opcional** PC ⇆ celular con un código, sin crear cuentas.
- **Tema claro/oscuro** automático.

## Sincronizar la PC y el celular

Por defecto cada dispositivo guarda lo suyo. Si querés cargar tareas en la PC y
verlas en el celular, hay que activar la sincronización: un **código** compartido
identifica tu espacio en [Supabase](https://supabase.com) (plan gratuito) y todos
los dispositivos con ese código ven lo mismo. No hay cuentas ni login.

**Preparar el proyecto (una sola vez, ~3 minutos)**

1. Creá un proyecto gratis en [supabase.com](https://supabase.com).
2. Abrí **SQL Editor**, pegá el contenido de [`supabase/schema.sql`](supabase/schema.sql)
   y dale **Run**.
3. Andá a **Settings → API Keys** y copiá el **Project URL** y la
   **Publishable key** (`sb_publishable_…`; en proyectos viejos es la *anon
   public*, un JWT que empieza con `eyJ…`). La **Secret key** no se usa nunca
   acá: saltea RLS y da acceso total.
4. Pegá esos dos valores en [`js/sync-config.js`](js/sync-config.js) y hacé
   commit. (Alternativa sin tocar código: dejalos vacíos y cargalos desde el
   panel ☁ de la app, en cada dispositivo.)

> En este repo los pasos 1-4 ya están hechos: `js/sync-config.js` viene con el
> proyecto cargado, así que sólo hay que conectar los dispositivos.

**Conectar los dispositivos**

1. En la PC: botón **☁** de la barra superior → **Generar código** → **Conectar**.
2. Copiá ese código y pegalo en el mismo panel del celular → **Conectar**.
3. Listo. Los cambios viajan solos: al guardar algo, al volver a la app y cada
   ~25 segundos mientras la tenés abierta.

Al conectar un dispositivo elegís qué hacer con lo que ya tenía: **combinar**
(default), **traer lo de la nube** o **subir lo de acá**.

**Cómo se resuelven los conflictos.** Cada tarea, lista e ítem lleva su marca de
última modificación, y los borrados dejan una "tumba". Si editás la misma tarea
en los dos lados gana la más reciente; si cada lado editó cosas distintas, se
conservan las dos; y lo borrado en un dispositivo no revive desde el otro.

**Sobre la seguridad.** La tabla queda con RLS activo y sin políticas: la clave
pública no puede leer nada por sí sola. El único acceso son dos funciones que
exigen el código, y el código generado tiene ~100 bits de azar. Aun así, **el
código es la llave de tus tareas**: tratalo como una contraseña y no lo publiques.
Los datos viajan sin cifrado extremo a extremo, así que quedan legibles en tu
propio proyecto de Supabase.

Si nunca activás la sincronización, la app sigue funcionando igual que antes:
todo local, sin red.

## Dos formas de usarla

### 1) Web / PWA (la más rápida)

Es un sitio estático (HTML + CSS + JS, sin dependencias). Serví la raíz:

```bash
python3 -m http.server 8000
# abrí http://localhost:8000
```

**Publicada automáticamente**: el repo trae un workflow que la sube a GitHub
Pages en `https://<usuario>.github.io/<repo>/`. Corré **Actions → "Publicar PWA
(GitHub Pages)" → Run workflow** (la primera vez habilita Pages solo). En el
celular: Chrome/Safari → *Agregar a la pantalla de inicio*.

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

#### Opción A — Descargar desde Releases (recomendada)

Cada push a `Main` publica un **GitHub Release** con el APK ya adjunto:

👉 **[github.com/FedeSierra-ux/Checklist/releases/latest](https://github.com/FedeSierra-ux/Checklist/releases/latest)**

Descargá **`tudu.apk`** al teléfono e instalalo (activá antes "Instalar
apps de orígenes desconocidos"). Cada nueva versión queda ahí, sin depender de
artefactos de Actions (que expiran a los 90 días).

Si no cargás una clave propia, cada build firma con una clave nueva (para
*actualizar* la app sin desinstalar entre versiones, cargá tu clave estable en
los secrets del repo: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`,
`KEY_PASSWORD`).

También podés compilar sin publicar release desde **Actions → "Compilar APK"**
(artefacto `tudu-apk` / `app-debug.apk`, para probar rápido).

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
js/sync.js              Sincronización entre dispositivos (merge + Supabase)
js/sync-config.js       URL y clave del proyecto de Supabase (opcional)
supabase/schema.sql     Tabla y funciones a correr en Supabase
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

Sin sincronización, todos los datos viven en el dispositivo (`localStorage` en
web / `SharedPreferences` en Android) y no se envía nada a ningún servidor.

Si activás la sincronización, tus tareas y listas se copian a **tu propio**
proyecto de Supabase, bajo el código que elegiste. Los avisos ya mostrados
(`notified`) nunca salen del dispositivo. Podés cortarlo cuando quieras con
**Desconectar**: los datos quedan en el dispositivo y dejan de subirse.
