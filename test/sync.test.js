import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netErrorMessage } from '../js/sync.js';

// "Sin conexión." a secas no servía para saber qué fallaba: ahora el mensaje
// dice la causa y trae el detalle técnico.
test('sin internet', () => {
  assert.equal(netErrorMessage('Failed to fetch', false), 'Sin conexión a internet.');
});

test('DNS: no se encuentra el servidor', () => {
  const m = netErrorMessage('Unable to resolve host "firestore.googleapis.com": No address associated with hostname');
  assert.match(m, /No se encuentra el servidor/);
  assert.match(m, /firestore\.googleapis\.com/);
});

test('tiempo agotado', () => {
  assert.match(netErrorMessage('timeout'), /no respondió a tiempo/);
  assert.match(netErrorMessage('SocketTimeoutException: timed out'), /no respondió a tiempo/);
});

test('certificado / fecha del teléfono', () => {
  assert.match(netErrorMessage('javax.net.ssl.SSLHandshakeException: CertPathValidatorException'), /fecha y hora/);
});

test('otro error de red: genérico con detalle', () => {
  const m = netErrorMessage('Failed to fetch');
  assert.match(m, /No se pudo conectar/);
  assert.match(m, /\(Failed to fetch\)/);
});
