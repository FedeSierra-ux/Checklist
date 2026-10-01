/* Panel de sincronización (☁): configurar Firebase, generar/pegar el
   código, ver el estado y cuánto del límite de 1 MB se está usando. */
import { $, showOverlay, hideOverlay } from './ctx.js';
import { agoLabel } from '../core/dates.js';
import { toast } from './toast.js';
import { Sync } from '../sync.js';

const overlay = () => $('#syncOverlay');

export function renderSync(st = Sync.status()) {
  const btn = $('#syncBtn');
  btn.classList.toggle('active', st.on && !st.error);
  btn.title = st.on ? 'Sincronización activa' : 'Sincronizar con otros dispositivos';

  $('#syncSetup').hidden = st.configured;
  $('#syncRoom').hidden = !st.configured;
  $('#syncDisconnect').hidden = !st.on;
  $('#syncRefresh').hidden = !st.on;
  $('#syncConnect').hidden = st.on;
  $('#syncMode').hidden = st.on;
  $('#syncGen').hidden = st.on;

  const codeInput = $('#syncCode');
  if (st.on) { codeInput.value = st.code; codeInput.readOnly = true; }
  else codeInput.readOnly = false;

  let txt;
  if (!st.configured) txt = 'Pegá los datos de tu proyecto de Firebase para empezar.';
  else if (!st.on) txt = 'Sin conectar. Generá un código acá y pegá el mismo en el otro dispositivo.';
  else if (st.busy) txt = 'Sincronizando…';
  else if (st.error) txt = '⚠ ' + st.error;
  else txt = `✓ Conectado · última sincronización ${agoLabel(st.last)}`;
  $('#syncState').textContent = txt;
  $('#syncState').classList.toggle('bad', !!st.error);

  // Cuánto del documento (1 MB) se usa. Lo viejo del archivo se recorta solo.
  const usage = $('#syncUsage');
  usage.hidden = !(st.on && st.size);
  if (st.on && st.size) {
    const pct = Math.min(100, Math.round((st.size / st.max) * 100));
    $('#syncUsagePct').textContent = pct < 1 ? '< 1%' : pct + '%';
    $('#syncUsageFill').style.width = Math.max(pct, 1) + '%';
    usage.classList.toggle('warn', pct >= 80);
  }
}

export function initSyncPanel() {
  const ov = overlay();
  $('#syncBtn').addEventListener('click', () => { showOverlay(ov); renderSync(); });
  $('#syncClose').addEventListener('click', () => hideOverlay(ov));
  ov.addEventListener('click', (e) => { if (e.target === ov) hideOverlay(ov); });

  $('#syncSaveCfg').addEventListener('click', () => {
    try {
      Sync.setConfig($('#syncUrl').value, $('#syncKey').value);
      toast('Proyecto guardado');
      renderSync();
    } catch (e) { toast(e.message); }
  });

  $('#syncGen').addEventListener('click', () => {
    $('#syncCode').value = Sync.generateCode();
    toast('Código nuevo — copialo al otro dispositivo');
  });

  $('#syncCopy').addEventListener('click', async () => {
    const v = $('#syncCode').value.trim();
    if (!v) return;
    try { await navigator.clipboard.writeText(v); toast('Código copiado'); }
    catch (e) { $('#syncCode').select(); toast('Copialo a mano'); }
  });

  $('#syncConnect').addEventListener('click', async () => {
    $('#syncState').textContent = 'Conectando…';
    try {
      await Sync.connect($('#syncCode').value, $('#syncModeSel').value);
      toast('✓ Sincronización activada');
    } catch (e) {
      $('#syncState').textContent = '⚠ ' + e.message;
      $('#syncState').classList.add('bad');
    }
  });

  $('#syncRefresh').addEventListener('click', async () => {
    await Sync.syncNow();
    const st = Sync.status();
    toast(st.error ? '⚠ ' + st.error : '✓ Al día');
  });

  $('#syncDisconnect').addEventListener('click', () => {
    if (!confirm('¿Desconectar este dispositivo? Tus tareas quedan acá, pero dejan de sincronizarse.')) return;
    Sync.disconnect();
    toast('Desconectado');
  });
}
