/* Tudu — configuración de sincronización (Firebase / Firestore).
 *
 * Completá estos dos valores con los de tu proyecto de Firebase
 * (Configuración del proyecto → General → "Tus apps" → app web):
 *
 *   projectId → ej: tudu-1a2b3
 *   apiKey    → la "Web API key", empieza con AIza…
 *
 * Los dos son públicos por diseño: lo que protege los datos son las reglas de
 * firebase/firestore.rules (sin el código de sincronización no se puede leer
 * ni pisar el espacio de nadie).
 *
 * Si los dejás vacíos, la app te los pide una sola vez desde el panel de
 * sincronización (☁ en la barra superior) y los guarda en ese dispositivo.
 */
window.TUDU_SYNC_CONFIG = {
  projectId: '',
  apiKey: '',
};
