import { randomUUID } from 'node:crypto';
import { SESSION_COLLECTION, BUDGET_COLLECTION, ExperienceError } from './experienceService.js';
import { ACCOUNT_COLLECTION } from './accountRecords.js';

// Keep the locked parent until ALL descendants are gone. Firestore TTL on a
// parent alone would leave private conversation/analysis documents behind.
export async function deleteOwner(db, owner, { expiredBefore = null } = {}) {
  let locked;
  const deleteLease = randomUUID();
  await db.runTransaction(async tx => {
    const snap = await tx.get(owner.ref), value = snap.data();
    if (!value || value.generation !== owner.value.generation || value.createdAt !== owner.value.createdAt) return;
    if (expiredBefore !== null && value.expiresAt > expiredBefore) return;
    if (value.deleteLeaseUntil > Date.now()) throw new ExperienceError(409, '기록을 정리하고 있어요. 잠시 후 다시 확인해 주세요.');
    locked = value;
    tx.update(owner.ref, { status: 'deleting', expiresAt: Math.min(value.expiresAt, Date.now()), deleteLease, deleteLeaseUntil: Date.now() + 300000 });
  });
  if (!locked) return false;
  try {
    for (const collection of await owner.ref.listCollections()) await db.recursiveDelete(collection);
    await db.runTransaction(async tx => {
      const value = (await tx.get(owner.ref)).data();
      if (value?.deleteLease === deleteLease && value.generation === locked.generation && value.createdAt === locked.createdAt) tx.delete(owner.ref);
    });
  } catch (error) {
    await db.runTransaction(async tx => { if ((await tx.get(owner.ref)).data()?.deleteLease === deleteLease) tx.update(owner.ref, { deleteLeaseUntil: 0 }); });
    throw error;
  }
  return true;
}

export async function cleanupExpired(db, { now = Date.now(), maxOwners = 100, timeBudget = 70000 } = {}) {
  const lock = db.collection('saju_experience_maintenance_v1').doc(process.env.VERCEL_ENV === 'preview' ? 'preview' : 'production');
  const lease = randomUUID();
  const acquired = await db.runTransaction(async tx => {
    if ((await tx.get(lock)).data()?.until > now) return false;
    tx.set(lock, { lease, until: now + 180000 }); return true;
  });
  if (!acquired) return { skipped: true, owners: 0, budgets: 0 };
  const started = Date.now(); let owners = 0, budgets = 0, failures = 0;
  try {
    for (const collection of [SESSION_COLLECTION, ACCOUNT_COLLECTION]) {
      const expired = await db.collection(collection).where('expiresAt', '<=', now).limit(maxOwners).get();
      for (const doc of expired.docs) {
        if (Date.now() - started >= timeBudget) break;
        try { if (await deleteOwner(db, { ref: doc.ref, value: doc.data() }, { expiredBefore: now })) owners++; }
        catch { failures++; } // Parent remains locked and eligible for retry.
      }
    }
    const expiredBudgets = await db.collection(BUDGET_COLLECTION).where('expiresAt', '<=', new Date(now)).limit(400).get();
    if (expiredBudgets.docs.length) {
      const batch = db.batch(); expiredBudgets.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit(); budgets = expiredBudgets.docs.length;
    }
    return { skipped: false, owners, budgets, failures };
  } finally {
    await db.runTransaction(async tx => { if ((await tx.get(lock)).data()?.lease === lease) tx.update(lock, { until: 0 }); });
  }
}
