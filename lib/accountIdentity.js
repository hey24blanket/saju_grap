// Firebase is the identity authority. UID, email and account status never come
// from request JSON. Revocation/disabled-user checks are required on every call.
import { getBearerToken } from './ragAdminAuth.js';
import { ExperienceError } from './experienceService.js';

let authPromise;
export async function adminAuth() {
  if (!authPromise) authPromise = (async () => {
    const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
    const app = getApps().find(a => a.name === 'saju-accounts') || initializeApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID
    }, 'saju-accounts');
    return getAuth(app);
  })().catch(error => { authPromise = null; throw error; });
  return authPromise;
}

export async function accountIdentity(req, verify) {
  const token = getBearerToken(req);
  if (!token) throw new ExperienceError(401, '로그인한 뒤 다시 시도해 주세요.');
  let identity;
  try { identity = await (verify || (async t => (await adminAuth()).verifyIdToken(t, true)))(token); }
  catch (error) {
    if (String(error.code || '').startsWith('auth/') && !['auth/internal-error', 'auth/insufficient-permission'].includes(error.code)) throw new ExperienceError(401, '로그인이 만료됐어요. 다시 로그인해 주세요.');
    throw new ExperienceError(503, '계정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (!identity?.uid || identity.firebase?.sign_in_provider === 'anonymous') throw new ExperienceError(401, '이메일 계정으로 로그인해 주세요.');
  if (!identity.email_verified) throw new ExperienceError(403, '이메일을 인증한 뒤 계정 보관함을 열 수 있어요.');
  return identity;
}
