import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTicket, checkTicket, TICKET_LIFE } from '../src/ticket.js';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0) / 1000;

test('a fresh ticket opens', async () => {
  const t = await makeTicket('secret', NOW);
  assert.match(t, /^\d{10}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(await checkTicket(t, 'secret', NOW), true);
  assert.equal(await checkTicket(t, 'secret', NOW + TICKET_LIFE), true);
});

test('an expired ticket does not', async () => {
  const t = await makeTicket('secret', NOW);
  assert.equal(await checkTicket(t, 'secret', NOW + TICKET_LIFE + 1), false);
});

test('another secret, a changed date or signature, or garbage do not', async () => {
  const t = await makeTicket('secret', NOW);
  const [exp, sig] = t.split('.');
  assert.equal(await checkTicket(t, 'other', NOW), false);
  assert.equal(await checkTicket(`${Number(exp) + 30}.${sig}`, 'secret', NOW), false);
  assert.equal(await checkTicket(`${exp}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, 'secret', NOW), false);
  for (const bad of [null, undefined, '', 'x', `${exp}.`, `${exp}.${sig}x`, `${exp}.${sig.slice(1)}`, 123]) {
    assert.equal(await checkTicket(bad, 'secret', NOW), false, String(bad));
  }
});

test('no secret configured, no ticket opens', async () => {
  const t = await makeTicket('secret', NOW);
  assert.equal(await checkTicket(t, undefined, NOW), false);
  assert.equal(await checkTicket(t, '', NOW), false);
});

test('a ticket dated beyond one life is refused', async () => {
  const t = await makeTicket('secret', NOW + 3600);
  assert.equal(await checkTicket(t, 'secret', NOW), false);
});
