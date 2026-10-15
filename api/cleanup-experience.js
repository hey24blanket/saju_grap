import { timingSafeEqual } from 'node:crypto';
import { getFirestoreClient } from '../lib/ragRetriever.js';
import { cleanupExpired } from '../lib/experienceCleanup.js';

export default async function handler(req, res, runtime = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false }); }
  const secret = runtime.secret ?? process.env.CRON_SECRET;
  const received = Buffer.from(String(req.headers?.authorization || ''));
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  if (!secret || received.length !== expected.length || !timingSafeEqual(received, expected)) return res.status(401).json({ success: false });
  try {
    const { db } = runtime.db ? { db: runtime.db } : await getFirestoreClient();
    const result = await cleanupExpired(db, runtime.options);
    console.info('[SajuGrap cleanup]', result); // Counts only, no IDs or private text.
    return res.status(result.failures ? 503 : 200).json({ success: !result.failures, ...result });
  } catch { return res.status(503).json({ success: false }); }
}
