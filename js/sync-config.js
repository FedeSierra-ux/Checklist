/* Tudu — configuración de sincronización (Supabase).
 *
 * Completá estos dos valores con los de tu proyecto de Supabase
 * (Project Settings → API):
 *
 *   url     → "Project URL"          ej: https://abcdefgh.supabase.co
 *   anonKey → "Publishable key"      (empieza con sb_publishable_; en proyectos
 *                                     viejos es la "anon public", un JWT eyJ…)
 *
 * ¡Ojo! La "Secret key" (sb_secret_…) NUNCA va acá: saltea RLS y da acceso
 * total. La publishable es pública por diseño y, sin el código de
 * sincronización, no sirve para leer los datos de nadie.
 *
 * Si los dejás vacíos, la app te los pide una sola vez desde el panel de
 * sincronización (☁ en la barra superior) y los guarda en ese dispositivo.
 */
window.TUDU_SYNC_CONFIG = {
  url: 'https://utymgqxlobmloitdfind.supabase.co',
  anonKey: 'sb_publishable_iEHInMgIwgjGqalC8AT-Bg_LMd8AOtM',
};
