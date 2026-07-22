// Copia los archivos de la app web (raíz) a www/ para que Capacitor los empaquete.
// La raíz sigue siendo la única fuente de verdad; www/ es un artefacto de build.
import { rm, mkdir, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const www = resolve(root, 'www');

const ENTRIES = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'assets'];

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
for (const e of ENTRIES) {
  await cp(resolve(root, e), resolve(www, e), { recursive: true }).catch((err) => {
    console.warn(`· salteado ${e}: ${err.message}`);
  });
}
console.log('www/ actualizado desde la raíz.');
