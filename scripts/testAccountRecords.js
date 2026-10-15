import assert from 'node:assert/strict';
import { test } from 'node:test';
import experience from '../api/experience.js';
import cleanupHandler from '../api/cleanup-experience.js';
import { ACCOUNT_COLLECTION, getAccount, assertOwnerActive } from '../lib/accountRecords.js';
import { SESSION_COLLECTION, BUDGET_COLLECTION, hash } from '../lib/experienceService.js';
import { cleanupExpired, deleteOwner } from '../lib/experienceCleanup.js';
import { MemoryDB, response, request } from './helpers/experienceMemoryDb.js';
const profile = { year: 1990, month: 1, day: 15, hour: 14, minute: 0, gender: 1, calendarType: 'solar', isLeapMonth: false, dayBoundary: 'midnight' };
const verifyIdentity = async token => {
  if (token === 'invalid') throw Object.assign(new Error(), { code: 'auth/id-token-revoked' });
  return { uid: token, auth_time: Math.floor(Date.now() / 1000), email_verified: token !== 'unverified', firebase: { sign_in_provider: token === 'anonymous' ? 'anonymous' : 'password' } };
};
const fixtureChat = async (_, res) => res.status(200).json({ success: true, reply: '서버에 보관된 답변이에요.' });
async function call(db, body, token = 'person_A', cookie = '', extra = {}) {
  const res = response(); await experience(request(body, cookie, token), res, { db, verifyIdentity, runChat: fixtureChat, ...extra }); return res;
}
async function setup(db = new MemoryDB(), token = 'person_A') {
  assert.equal((await call(db, { action: 'account' }, token)).code, 200);
  const r = await call(db, { action: 'analyze', profile }, token); assert.equal(r.code, 200);
  const current = r.body;
  const item = { id: 'reading_123', kind: 'reading', pointId: current.reading.today.id, domain: 'all', experience: current, action: 'forged', savedAt: new Date().toISOString() };
  return { db, current, item, token };
}

test('cloud access rejects missing, revoked, anonymous and unverified identities; ignores supplied UID', async () => {
  const db = new MemoryDB();
  for (const [token, status] of [['',401], ['invalid',401], ['anonymous',401], ['unverified',403]]) assert.equal((await call(db, { action: 'account', uid: 'person_A' }, token)).code, status);
  assert.equal(db.rows.size, 0);
  await call(db, { action: 'account', uid: 'person_B' });
  assert.ok(db.rows.has(`${ACCOUNT_COLLECTION}/${hash('person_A')}`));
  assert.ok(!db.rows.has(`${ACCOUNT_COLLECTION}/${hash('person_B')}`));
});

test('same verified account restores current and archive on a new device; another account stays isolated', async () => {
  const { db, item, current } = await setup();
  const save = await call(db, { action: 'record-save', item, operationId: 'operation_123', revision: 0 }); assert.equal(save.code, 200);
  assert.notEqual(save.body.item.action, 'forged');
  const reopened = await call(db, { action: 'account' });
  assert.equal(reopened.body.current.analysisId, current.analysisId); assert.equal(reopened.body.archive.length, 1);
  const other = await call(db, { action: 'account' }, 'person_B'); assert.equal(other.body.current, null); assert.equal(other.body.archive.length, 0);
  const stolen = await call(db, { action: 'record-save', item, operationId: 'operation_456' }, 'person_B'); assert.equal(stolen.code, 404);
});

test('retries are idempotent, conflicting edits fail, and a tombstone prevents stale resurrection', async () => {
  const { db, item } = await setup();
  const body = { action: 'record-save', item, revision: 0, operationId: 'operation_123' };
  const a = await call(db, body), b = await call(db, body); assert.deepEqual(a.body, b.body);
  assert.equal((await call(db, { ...body, operationId: 'operation_456' })).code, 409);
  assert.equal((await call(db, { action: 'record-delete', id: item.id, revision: 9 })).code, 409);
  assert.equal((await call(db, { action: 'record-delete', id: item.id, revision: 1 })).code, 200);
  assert.equal((await call(db, { ...body, revision: 2, operationId: 'operation_789' })).code, 409);
  assert.equal((await call(db, { action: 'account' })).body.archive.length, 0);
});

test('server conversation is authoritative even when client sends fabricated messages', async () => {
  const { db, item, current } = await setup();
  const chat = await call(db, { action: 'chat', analysisId: current.analysisId, cycleId: item.pointId, domain: 'all', conversationId: 'conversation_123', requestId: 'request_123', text: '내 질문이에요.' });
  assert.equal(chat.code, 200);
  const saved = await call(db, { action: 'record-save', item: { ...item, id: 'conversation_123', kind: 'chat', chat: { messages: [{ role: 'assistant', text: '조작된 답변' }] } }, operationId: 'operation_123' });
  assert.equal(saved.code, 200);
  assert.deepEqual(saved.body.item.chat.messages.map(m => m.text), ['내 질문이에요.', '서버에 보관된 답변이에요.']);
});

test('device migration is resumable, labelled read-only, and never imports invented server chat history', async () => {
  const { db, item, current } = await setup();
  const imported = { ...item, id: 'device_chat_123', kind: 'chat', chat: { messages: [{ role: 'user', text: '예전 질문' }, { role: 'assistant', text: '예전 답변' }] } };
  const a = await call(db, { action: 'record-import', item: imported, operationId: 'import_123' });
  const b = await call(db, { action: 'record-import', item: imported, operationId: 'import_456' });
  assert.equal(a.code, 200); assert.deepEqual(a.body.item, b.body.item); assert.equal(a.body.item.chat.readOnly, true); assert.equal(a.body.item.source, 'device');
  assert.equal((await call(db, { action: 'account' })).body.archive.length, 1);
  const useImportedHistory = await call(db, { action: 'chat', analysisId: a.body.item.experience.analysisId, cycleId: item.pointId, conversationId: a.body.item.id, requestId: 'request_123', text: '이어줘' }); assert.equal(useImportedHistory.code, 404);
  const serverConversations = [...db.rows.keys()].filter(k => k.includes('/conversations/')); assert.equal(serverConversations.length, 0);
});

test('40-record limit is transactional; deleting a record releases a slot', async () => {
  const { db, item } = await setup(); const ref = db.collection(ACCOUNT_COLLECTION).doc(hash('person_A'));
  db.rows.set(ref.path, { ...db.rows.get(ref.path), archiveCount: 39 });
  const results = await Promise.all(['record_123', 'record_456'].map(id => call(db, { action: 'record-save', item: { ...item, id }, operationId: id })));
  assert.deepEqual(results.map(r => r.code).sort(), [200, 409]);
  const saved = results.find(r => r.code === 200).body.item;
  await call(db, { action: 'record-delete', id: saved.id, revision: saved.revision });
  assert.equal((await call(db, { action: 'record-save', item: { ...item, id: 'record_789' }, operationId: 'operation_789' })).code, 200);
});

test('deleting an account during a provider call cannot recreate data, including after a new account generation opens', async () => {
  const { db, item, current } = await setup(); let release, started;
  const signal = new Promise(r => started = r);
  const running = call(db, { action: 'chat', analysisId: current.analysisId, cycleId: item.pointId, conversationId: 'conversation_123', requestId: 'request_123', text: '질문' }, 'person_A', '', { runChat: async (_, res) => { started(); await new Promise(r => release = r); res.status(200).json({ success: true, reply: '늦은 답변' }); } });
  await signal;
  assert.equal((await call(db, { action: 'delete' })).code, 200);
  assert.equal((await call(db, { action: 'account' })).code, 200);
  release(); assert.equal((await running).code, 409);
  assert.equal([...db.rows.keys()].filter(k => /\/(analyses|conversations|requests)\//.test(k)).length, 0);
});

test('expired guest sessions remain deletable; cleanup physically removes descendants and expired counters only', async () => {
  const db = new MemoryDB(), now = Date.now();
  const cookie = 'a'.repeat(64), expired = `${SESSION_COLLECTION}/${hash(cookie)}`, active = `${SESSION_COLLECTION}/active`;
  db.rows.set(expired, { createdAt: 1, expiresAt: now - 1 }); db.rows.set(`${expired}/conversations/a`, { text: 'private' });
  db.rows.set(active, { createdAt: 2, expiresAt: now + 10000 }); db.rows.set(`${active}/analyses/a`, { profile });
  db.rows.set(`${BUDGET_COLLECTION}/expired`, { count: 1, expiresAt: new Date(now - 1) });
  db.rows.set(`${BUDGET_COLLECTION}/active`, { count: 1, expiresAt: new Date(now + 10000) });
  const result = await cleanupExpired(db, { now }); assert.equal(result.owners, 1); assert.equal(result.budgets, 1);
  assert.ok(![...db.rows.keys()].some(k => k.startsWith(expired))); assert.ok(db.rows.has(`${active}/analyses/a`));
  db.rows.set(expired, { createdAt: 1, expiresAt: now - 1 }); db.rows.set(`${expired}/requests/a`, { text: 'private' });
  assert.equal((await call(db, { action: 'delete' }, '', `sg_session=${cookie}`)).code, 200); assert.ok(!db.rows.has(expired));
});

test('a failed recursive delete leaves a locked parent for retry and prevents new writes', async () => {
  const { db } = await setup(); const owner = await getAccount(db, { uid: 'person_A' });
  const original = db.recursiveDelete.bind(db); db.recursiveDelete = async () => { throw new Error('temporary failure'); };
  await assert.rejects(deleteOwner(db, owner));
  assert.equal((await owner.ref.get()).data().status, 'deleting');
  await assert.rejects(db.runTransaction(tx => assertOwnerActive(tx, owner)));
  db.recursiveDelete = original; assert.equal(await deleteOwner(db, owner), true); assert.equal((await owner.ref.get()).exists, false);
});

test('cleanup rechecks expiry to protect an account refreshed after the initial query', async () => {
  const { db } = await setup(); const owner = await getAccount(db, { uid: 'person_A' });
  assert.equal(await deleteOwner(db, owner, { expiredBefore: Date.now() }), false);
  assert.equal((await owner.ref.get()).exists, true);
});

test('cron endpoint fails closed without its secret and serializes overlapping runs', async () => {
  const db = new MemoryDB(); const r = response();
  await cleanupHandler({ method: 'GET', headers: {} }, r, { db, secret: '' }); assert.equal(r.code, 401);
  const bad = response(); await cleanupHandler({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, bad, { db, secret: 'secret' }); assert.equal(bad.code, 401);
  const ok = response(); await cleanupHandler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, ok, { db, secret: 'secret' }); assert.equal(ok.code, 200);
  db.rows.set('saju_experience_maintenance_v1/production', { until: Date.now() + 10000 }); assert.equal((await cleanupExpired(db)).skipped, true);
});

test('overlapping deletion cannot delete a newly reopened account generation', async () => {
  const { db } = await setup(); const owner = await getAccount(db, { uid: 'person_A' }); let started, release;
  const signal = new Promise(r => started = r), original = db.recursiveDelete.bind(db);
  db.recursiveDelete = async ref => { started(); await new Promise(r => release = r); return original(ref); };
  const deletion = deleteOwner(db, owner); await signal;
  await assert.rejects(deleteOwner(db, owner), e => e.status === 409);
  release(); await deletion;
  const reopened = await getAccount(db, { uid: 'person_A' }, { create: true });
  assert.notEqual(reopened.value.generation, owner.value.generation);
  assert.equal(await deleteOwner(db, owner), false);
  assert.equal((await reopened.ref.get()).exists, true);
});

test('returning after retention expiry clears old descendants before opening a new account', async () => {
  const { db } = await setup(), ref = db.collection(ACCOUNT_COLLECTION).doc(hash('person_A'));
  const old = db.rows.get(ref.path); db.rows.set(ref.path, { ...old, expiresAt: Date.now() - 1 });
  const reopened = await call(db, { action: 'account' });
  assert.equal(reopened.code, 200); assert.equal(reopened.body.current, null); assert.equal(reopened.body.archive.length, 0);
  assert.notEqual(db.rows.get(ref.path).generation, old.generation);
});


test('account-wide deletion requires recent authentication before any data is removed', async () => {
  const { db } = await setup();
  const r = await call(db, { action: 'delete' }, 'person_A', '', { verifyIdentity: async () => ({ uid: 'person_A', email_verified: true, auth_time: 1 }) });
  assert.equal(r.code, 401); assert.ok(db.rows.has(`${ACCOUNT_COLLECTION}/${hash('person_A')}`));
});
