/* Fechas: helpers puros (sin DOM) para que se puedan probar en Node.
   Las fechas de tareas viajan como texto "AAAA-MM-DD" en hora LOCAL: nunca
   pasarlas por `new Date('AAAA-MM-DD')`, que las toma como UTC y en
   Argentina (UTC-3) las corre al día anterior. Usar parseYmd. */

export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Días enteros de `a` a `b` (positivo si b es posterior).
export const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

export const shortDate = (d) => `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`;
export const dowShort = (d) => DIAS[d.getDay()].slice(0, 3).toLowerCase();

// Vencimiento de una tarea: la hora, o el final del día si no tiene.
export function taskDate(t) {
  if (!t || !t.date) return null;
  const d = parseYmd(t.date);
  const [hh, mm] = (t.time || '23:59').split(':').map(Number);
  d.setHours(hh, mm, 0, 0);
  return d;
}

export function weekRange(base = new Date()) {
  const d = startOfDay(base);
  const dow = (d.getDay() + 6) % 7;            // semana de lunes a domingo
  const start = addDays(d, -dow);
  const end = addDays(start, 6); end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Etiqueta corta del vencimiento para la fila ("Hoy 18:00", "Vencida · ayer").
export function humanDue(t, now = new Date()) {
  const dt = taskDate(t);
  if (!dt) return null;
  const diff = dayDiff(now, dt);
  const hora = t.time ? ` ${t.time}` : '';
  if (dt < now && !t.done) {
    if (diff === 0) return { label: 'Vencida' + hora, cls: 'due' };
    if (diff === -1) return { label: 'Vencida · ayer', cls: 'due' };
    if (diff > -7) return { label: `Vencida · hace ${-diff} días`, cls: 'due' };
    return { label: `Vencida · ${shortDate(dt)}`, cls: 'due' };
  }
  if (diff === 0) return { label: 'Hoy' + hora, cls: 'today' };
  if (diff === 1) return { label: 'Mañana' + hora, cls: '' };
  if (diff > 1 && diff <= 6) return { label: DIAS[dt.getDay()].slice(0, 3) + hora, cls: '' };
  return { label: shortDate(dt) + hora, cls: '' };
}

// Cuándo avisar (ms). Con hora: `remind` minutos antes. Sin hora: a las 9 del
// día (o N días antes si el aviso es de "1 día antes"), no a las 22:59.
export function reminderAt(t) {
  if (!t || !t.date) return null;
  const remind = t.remind ?? 60;
  if (!t.time) {
    const d = parseYmd(t.date);
    d.setHours(9, 0, 0, 0);
    d.setDate(d.getDate() - Math.floor(remind / 1440));
    return d.getTime();
  }
  return taskDate(t).getTime() - remind * 60000;
}

// Texto de la notificación, relativo al momento en que va a sonar (no a
// cuando se programa): "Vence mañana a las 18:00", "Vence en 30 min (18:00)".
export function reminderBody(t, at = reminderAt(t)) {
  const due = taskDate(t);
  if (!due || at == null) return '';
  const when = new Date(at);
  const diff = dayDiff(when, due);
  if (!t.time) {
    if (diff <= 0) return 'Vence hoy';
    if (diff === 1) return 'Vence mañana';
    return `Vence el ${dowShort(due)} ${shortDate(due)}`;
  }
  const mins = Math.round((due - when) / 60000);
  if (diff === 0) {
    if (mins <= 0) return `Vence ahora (${t.time})`;
    if (mins < 60) return `Vence en ${mins} min (${t.time})`;
    return `Vence hoy a las ${t.time}`;
  }
  if (diff === 1) return `Vence mañana a las ${t.time}`;
  return `Vence el ${dowShort(due)} ${shortDate(due)} a las ${t.time}`;
}

export function agoLabel(ms, now = Date.now()) {
  if (!ms) return 'nunca';
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
