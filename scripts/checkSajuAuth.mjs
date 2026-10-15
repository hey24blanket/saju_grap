import { adminAuth } from '../lib/accountIdentity.js';
// Read-only capability probe in deployment builds. Never creates accounts or
// sends email, and never prints credentials or real user data.
if (process.env.VERCEL_ENV) {
  try { await (await adminAuth()).getUser('__saju_capability_probe_not_a_user__'); }
  catch (error) {
    if (error.code !== 'auth/user-not-found') {
      console.error('Saju account verification unavailable:', error.code || 'AUTH_SETUP');
      process.exit(1);
    }
  }
  console.log('Saju Firebase account verification is configured.');
}
