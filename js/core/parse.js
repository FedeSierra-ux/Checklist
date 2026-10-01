/* Escritura natural: "el viernes a las 5 pedir turno #salud !alta".
   Saca del texto etiquetas, prioridad, repetición, fecha y hora, y deja el
   título limpio. Puro (recibe `now`) para poder probarlo en Node. */
import { ymd, pad, addDays, parseYmd, daysInMonth } from './dates.js';
import { firstOnOrAfter, nextDate } from './repeat.js';

// \b de JS no entiende tildes ni ñ: estos bordes sí. El borde izquierdo usa
// lookbehind, que Safari recién soporta desde iOS 16.4; si no está, se usa un
// grupo inicial y `find` corrige el resultado para que quede igual.
const E = '(?![\\p{L}\\p{N}_])';
const HAS_LOOKBEHIND = (() => { try { return new RegExp('(?<!a)b').test('b'); } catch (e) { return false; } })();
const re = (src) => HAS_LOOKBEHIND
  ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${src})${E}`, 'iu')
  : { pre: new RegExp(`(^|[^\\p{L}\\p{N}_])(?:${src})${E}`, 'iu') };

function find(s, r) {
  if (r instanceof RegExp) return s.match(r);
  const m = s.match(r.pre);
  if (!m) return null;
  const skip = m[1].length;
  const out = [m[0].slice(skip), ...m.slice(2)];
  out.index = m.index + skip;
  return out;
}
const strip = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const DOW = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const DOW1 = 'domingo|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado';
const DOWS = 'domingos?|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bados?';
const dowOf = (w) => { const s = strip(w); return DOW[s] ?? DOW[s.replace(/s$/, '')]; };

const MES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7,
  septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
const MES_AB = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11 };
const MES_RX = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|sept?iembre|octubre|noviembre|diciembre'
  + '|ene|feb|mar|abr|may|jun|jul|ago|sept?|set|oct|nov|dic';
const mesOf = (w) => { const s = strip(w); return MES[s] ?? MES_AB[s.slice(0, 3)]; };

const NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20 };
const NUM_RX = '\\d{1,3}|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte';
const numOf = (w) => /^\d/.test(w) ? parseInt(w, 10) : NUM[strip(w)];

const UNIT_RX = 'd[ií]as?|semanas?|mes(?:es)?|a[ñn]os?';
const unitOf = (w) => {
  const s = strip(w);
  if (s.startsWith('dia')) return 'day';
  if (s.startsWith('semana')) return 'week';
  if (s.startsWith('mes')) return 'month';
  if (s.startsWith('ano')) return 'year';
  return null;
};

const R_DAILY = re('todos\\s+los\\s+d[ií]as|cada\\s+d[ií]a|diariamente|a\\s+diario');
const R_WEEKDAYS = re('de\\s+lunes\\s+a\\s+viernes|d[ií]as\\s+h[áa]biles|d[ií]as\\s+de\\s+semana|entre\\s+semana');
// "el 10" sólo es día del mes si no sigue "de mayo" (eso es una fecha).
const R_EVERY = re(`(?:todos\\s+los|todas\\s+las|cada)\\s+(?:(${NUM_RX})\\s+)?(${UNIT_RX})`
  + `(?:\\s+el\\s+(?:d[ií]a\\s+)?(\\d{1,2})(?!\\d|\\s*[/-]\\d|\\s+(?:de\\s+)?(?:${MES_RX})(?![\\p{L}])))?`);
const R_EVERY_DOW = re(`(?:todos\\s+los|todas\\s+las|cada)\\s+((?:${DOWS})(?:\\s*(?:,|y)\\s*(?:los\\s+)?(?:${DOWS}))*)`);

const R_AT = re('a\\s+las?\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(?:h(?:s|rs?)?|horas?)?(?:\\s+y\\s+(media|cuarto))?'
  + '(?:\\s*(am|pm|a\\.\\s?m\\.|p\\.\\s?m\\.)|\\s+(?:de|a|por)\\s+la\\s+(mañana|tarde|noche|madrugada))?');
const R_HHMM = re('(\\d{1,2}):(\\d{2})\\s*(?:(am|pm)|h(?:s|rs)?)?');
const R_AMPM = re('(\\d{1,2})\\s?(am|pm)');
const R_NOON = re('al?\\s+mediod[ií]a');

const R_PASADO = re('pasado\\s+mañana');
const R_HOY = re('hoy|esta\\s+noche|esta\\s+tarde');
const R_MANANA = re('mañana');
const R_IN = re(`(?:dentro\\s+de|en)\\s+(${NUM_RX})\\s+(${UNIT_RX})`);
const R_DOW = re(`(?:(el|este|esta)\\s+)?(?:(pr[óo]ximo)\\s+)?(${DOW1})(?:\\s+(que\\s+viene|pr[óo]ximo))?`);
const R_DMY = re('(?:el\\s+)?(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{4}|\\d{2}))?'
  + '(?!\\s*(?:kg|kilos?|g|gr|grs|l|lts?|litros?|ml|cc)(?![\\p{L}]))');
const R_DM_TXT = re(`(?:el\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(${MES_RX})\\.?(?:\\s+(?:de\\s+|del\\s+)?(\\d{4}))?`);

function to24(h, min, ampm, period, hadAt) {
  const p = ampm ? strip(ampm).replace(/[.\s]/g, '') : '';
  const per = period ? strip(period) : '';
  if (p === 'pm' || per === 'tarde' || per === 'noche') {
    if (h < 12) h += 12;
    else if (per === 'noche' && h === 12) h = 0;
  } else if (p === 'am' || per === 'manana' || per === 'madrugada') {
    if (h === 12) h = 0;
  } else if (hadAt && h >= 1 && h <= 6) {
    h += 12;                       // "a las 5" es a la tarde, no de madrugada
  }
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

function validDate(y, m, d) {
  return m >= 0 && m <= 11 && d >= 1 && d <= daysInMonth(y, m);
}

// Fecha d/m sin año: este año, o el que viene si ya pasó.
function nextDayMonth(d, m, y, today) {
  if (y != null) return validDate(y, m, d) ? ymd(new Date(y, m, d)) : null;
  let yy = today.getFullYear();
  if (!validDate(yy, m, d) && !validDate(yy + 1, m, d)) return null;
  let cand = new Date(yy, m, d);
  if (!validDate(yy, m, d) || cand < today) { yy += 1; cand = new Date(yy, m, d); }
  return validDate(yy, m, d) ? ymd(cand) : null;
}

const timePassed = (now, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
};

export function parseQuick(text, now = new Date()) {
  let s = ` ${text} `;
  const tags = [];
  let priority = null, date = null, time = null, repeat = null;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  // Al sacar algo del final, se va también el conector que lo anunciaba
  // ("comprar pan PARA el sábado"). Sólo en minúscula: "Plan A" queda.
  const cut = (m) => {
    let before = s.slice(0, m.index);
    const after = s.slice(m.index + m[0].length);
    if (!after.trim()) before = before.replace(/\s(?:para|hasta|desde|antes\s+del?|de|del|el|la|a|en)\s*$/u, ' ');
    s = `${before} ${after}`;
  };
  const grab = (rx) => { const m = find(s, rx); if (m) cut(m); return m; };

  s = s.replace(/#([\p{L}\p{N}_]+)/gu, (_, t) => { tags.push(t.toLowerCase()); return ' '; });
  s = s.replace(/!(alta|media|baja|[1-3])(?![\p{L}\p{N}_])/iu, (_, p) => {
    priority = { alta: 3, media: 2, baja: 1, 1: 1, 2: 2, 3: 3 }[p.toLowerCase()];
    return ' ';
  });

  // --- Repetición ---
  let m;
  if ((m = grab(R_DAILY))) repeat = { every: 1, unit: 'day' };
  else if ((m = grab(R_WEEKDAYS))) repeat = { every: 1, unit: 'week', days: [1, 2, 3, 4, 5] };
  else if ((m = grab(R_EVERY))) {
    const unit = unitOf(m[2]);
    repeat = { every: m[1] ? numOf(m[1]) || 1 : 1, unit };
    if (unit === 'month' && m[3]) repeat.md = Math.min(31, Math.max(1, +m[3]));
  } else if ((m = grab(R_EVERY_DOW))) {
    const days = m[1].replace(/(^|\s)los\s+/giu, '$1').split(/\s*,\s*|\s+y\s+/iu)
      .map(dowOf).filter(d => d != null);
    if (days.length) repeat = { every: 1, unit: 'week', days: [...new Set(days)] };
  }

  // --- Hora (antes que la fecha: "de la mañana" no es "mañana") ---
  if ((m = grab(R_AT))) {
    const min = m[2] ? +m[2] : m[3] ? (strip(m[3]) === 'media' ? 30 : 15) : 0;
    time = to24(+m[1], min, m[4], m[5], true);
  } else if ((m = grab(R_HHMM))) {
    time = to24(+m[1], +m[2], m[3], null, false);
  } else if ((m = grab(R_AMPM))) {
    time = to24(+m[1], 0, m[2], null, false);
  } else if ((m = grab(R_NOON))) {
    time = '12:00';
  }

  // --- Fecha ---
  if (grab(R_PASADO)) date = ymd(addDays(today, 2));
  else if (grab(R_HOY)) date = ymd(today);
  else if (grab(R_MANANA)) date = ymd(addDays(today, 1));
  else if ((m = grab(R_IN))) {
    const n = numOf(m[1]) || 1, unit = unitOf(m[2]);
    const d = new Date(today);
    if (unit === 'day') d.setDate(d.getDate() + n);
    else if (unit === 'week') d.setDate(d.getDate() + 7 * n);
    else if (unit === 'month') d.setMonth(d.getMonth() + n);
    else d.setFullYear(d.getFullYear() + n);
    date = ymd(d);
  } else if ((m = grab(R_DOW))) {
    const target = dowOf(m[3]);
    let diff = (target - today.getDay() + 7) % 7;
    const este = m[1] && /^est/i.test(m[1]) && !m[2] && !m[4];
    if (diff === 0 && !este) diff = 7;
    date = ymd(addDays(today, diff));
  } else if ((m = find(s, R_DMY))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    const d = nextDayMonth(+m[1], +m[2] - 1, y, today);
    if (d) { date = d; cut(m); }
  } else if ((m = find(s, R_DM_TXT))) {
    const mes = mesOf(m[2]);
    const d = mes != null ? nextDayMonth(+m[1], mes, m[3] ? +m[3] : null, today) : null;
    if (d) { date = d; cut(m); }
  }

  // `explicitDate`: la fecha salió del texto ("el viernes"), no de la hora ni
  // de la repetición. El formulario la usa para no pisar el campo Fecha.
  const explicitDate = !!date;

  // --- Anclar la repetición ---
  if (repeat) {
    let start = date || ymd(today);
    if (repeat.unit === 'month' && !repeat.md) repeat.md = parseYmd(start).getDate();
    start = firstOnOrAfter(repeat, start);
    if (start === ymd(today) && time && timePassed(now, time)) start = nextDate(repeat, start);
    date = start;
  } else if (time && !date) {
    // "llamar a las 5": hoy si todavía no pasó, si no mañana.
    date = ymd(timePassed(now, time) ? addDays(today, 1) : today);
  }

  const title = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/gu, '');
  return { title, tags, priority, date, time, repeat, explicitDate };
}
