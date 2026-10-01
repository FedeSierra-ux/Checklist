/* Tareas repetidas. Una regla es:
     { every: n, unit: 'day' | 'week' | 'month' | 'year', days?: [0..6], md?: 1..31 }
   `days` (0 = domingo) sólo en semanales: "todos los lunes y jueves".
   `md` sólo en mensuales: el día del mes al que se ancla, para que una tarea
   del 31 no se corra al 30 después de pasar por un mes corto.
   Al completar una repetida no se crea otra: la misma avanza a la próxima
   fecha (y el historial queda en el archivo). */
import { parseYmd, ymd, addDays, daysInMonth } from './dates.js';

const UNITS = ['day', 'week', 'month', 'year'];
const monIdx = (d) => (d + 6) % 7;            // lunes = 0 … domingo = 6
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export function cleanRepeat(r) {
  if (!r || !UNITS.includes(r.unit)) return null;
  const out = { every: clamp(parseInt(r.every, 10) || 1, 1, 99), unit: r.unit };
  if (r.unit === 'week' && Array.isArray(r.days) && r.days.length) {
    out.days = [...new Set(r.days.map(Number).filter(d => d >= 0 && d <= 6))]
      .sort((a, b) => monIdx(a) - monIdx(b));
  }
  if (r.unit === 'month' && r.md) out.md = clamp(parseInt(r.md, 10) || 1, 1, 31);
  return out;
}

function addMonths(d, n, md) {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const day = Math.min(md || d.getDate(), daysInMonth(first.getFullYear(), first.getMonth()));
  return new Date(first.getFullYear(), first.getMonth(), day);
}

// Siguiente fecha estrictamente posterior a `fromYmd` según la regla.
export function nextDate(r, fromYmd) {
  const d = parseYmd(fromYmd);
  const n = r.every || 1;
  if (r.unit === 'day') return ymd(addDays(d, n));
  if (r.unit === 'week') {
    if (!r.days || !r.days.length) return ymd(addDays(d, 7 * n));
    const cur = monIdx(d.getDay());
    const later = r.days.map(monIdx).filter(i => i > cur).sort((a, b) => a - b);
    if (later.length) return ymd(addDays(d, later[0] - cur));
    const monday = addDays(d, -cur);
    return ymd(addDays(monday, 7 * n + Math.min(...r.days.map(monIdx))));
  }
  if (r.unit === 'month') return ymd(addMonths(d, n, r.md));
  if (r.unit === 'year') {
    const y = d.getFullYear() + n, m = d.getMonth();
    return ymd(new Date(y, m, Math.min(d.getDate(), daysInMonth(y, m))));
  }
  return fromYmd;
}

// Primera fecha >= startYmd que cumple la regla (para anclar una tarea nueva:
// "todos los lunes" creada un jueves arranca el lunes que viene).
export function firstOnOrAfter(r, startYmd) {
  const d = parseYmd(startYmd);
  if (r.unit === 'week' && r.days && r.days.length) {
    for (let i = 0; i < 7; i++) {
      const x = addDays(d, i);
      if (r.days.includes(x.getDay())) return ymd(x);
    }
  }
  if (r.unit === 'month' && r.md) {
    const y = d.getFullYear(), m = d.getMonth();
    const thisMonth = new Date(y, m, Math.min(r.md, daysInMonth(y, m)));
    return ymd(thisMonth >= d ? thisMonth : addMonths(new Date(y, m, 1), 1, r.md));
  }
  return startYmd;
}

// Al completar: avanza desde el vencimiento hasta pasar hoy, así una diaria
// atrasada tres días no deja tres vencidas en fila.
export function advancePast(r, dueYmd, todayYmd) {
  let next = nextDate(r, dueYmd);
  for (let i = 0; next <= todayYmd && i < 5000; i++) next = nextDate(r, next);
  return next;
}

const DOW_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const listJoin = (a) => a.length > 1 ? `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}` : a[0];

export function describeRepeat(r) {
  if (!r) return '';
  const n = r.every || 1;
  if (r.unit === 'day') return n === 1 ? 'cada día' : `cada ${n} días`;
  if (r.unit === 'week') {
    const days = r.days || [];
    if (n === 1 && days.length === 7) return 'cada día';
    if (n === 1 && days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d))) return 'de lunes a viernes';
    if (days.length) {
      const list = listJoin(days.map(d => DOW_NAMES[d]));
      return n === 1 ? `cada ${list}` : `cada ${n} semanas (${list})`;
    }
    return n === 1 ? 'cada semana' : `cada ${n} semanas`;
  }
  if (r.unit === 'month') {
    const base = n === 1 ? 'cada mes' : `cada ${n} meses`;
    return r.md ? `${base} el ${r.md}` : base;
  }
  if (r.unit === 'year') return n === 1 ? 'cada año' : `cada ${n} años`;
  return '';
}
