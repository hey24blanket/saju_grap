// lib/ragAdminAuth.js
// SajuGrap RAG Manager - Firebase ID token verification without extra runtime deps.
// Verifies RS256 Firebase ID tokens against Google's SecureToken certificates,
// then checks the UID against SAJUGRAP_ADMIN_UID / SAJUGRAP_ADMIN_UIDS.

import crypto from 'node:crypto';

const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache = {
  expiresAt: 0,
  certs: null
};

function cleanText(value) {
  return value === null || value === undefined
    ? ''
    : String(value).trim();
}

function decodeBase64Url(value) {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding
    ? normalized + '='.repeat(4 - padding)
    : normalized;
  return Buffer.from(padded, 'base64');
}

function parseJwtPart(value, label) {
  try {
    return JSON.parse(decodeBase64Url(value).toString('utf8'));
  } catch (error) {
    const wrapped = new Error(`Firebase ID token ${label}를 읽을 수 없습니다.`);
    wrapped.code = 'SG-RAG-ADMIN-AUTH-002';
    wrapped.cause = error;
    throw wrapped;
  }
}

function resolveProjectId() {
  const direct =
    cleanText(process.env.FIREBASE_PROJECT_ID) ||
    cleanText(process.env.GOOGLE_CLOUD_PROJECT) ||
    cleanText(process.env.GCLOUD_PROJECT);

  if (direct) {
    return direct;
  }

  const raw = cleanText(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return cleanText(parsed?.project_id);
    } catch {
      return '';
    }
  }

  return '';
}

function parseAdminUids() {
  return [
    cleanText(process.env.SAJUGRAP_ADMIN_UID),
    ...cleanText(process.env.SAJUGRAP_ADMIN_UIDS)
      .split(',')
      .map((item) => cleanText(item))
  ].filter(Boolean);
}

function cacheMaxAgeMs(response) {
  const cacheControl = cleanText(response.headers.get('cache-control'));
  const match = cacheControl.match(/max-age=(\d+)/i);
  const seconds = match ? Number(match[1]) : 3600;
  return Math.max(60, Number.isFinite(seconds) ? seconds : 3600) * 1000;
}

async function getSecureTokenCerts() {
  const now = Date.now();
  if (certCache.certs && certCache.expiresAt > now + 30_000) {
    return certCache.certs;
  }

  const response = await fetch(CERT_URL, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const error = new Error(
      `Firebase 공개 인증서 조회에 실패했습니다. HTTP ${response.status}`
    );
    error.code = 'SG-RAG-ADMIN-AUTH-003';
    throw error;
  }

  const certs = await response.json();
  certCache = {
    certs,
    expiresAt: now + cacheMaxAgeMs(response)
  };

  return certs;
}

export async function verifyFirebaseIdToken(idToken) {
  const token = cleanText(idToken);
  if (!token) {
    const error = new Error('Firebase ID token이 없습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-001';
    throw error;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    const error = new Error('Firebase ID token 형식이 올바르지 않습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-002';
    throw error;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtPart(encodedHeader, 'header');
  const payload = parseJwtPart(encodedPayload, 'payload');

  if (header?.alg !== 'RS256' || !cleanText(header?.kid)) {
    const error = new Error('Firebase ID token의 서명 알고리즘 또는 kid가 올바르지 않습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-004';
    throw error;
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    const error = new Error('서버에 FIREBASE_PROJECT_ID가 설정되어 있지 않습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-005';
    throw error;
  }

  const certs = await getSecureTokenCerts();
  const cert = certs?.[header.kid];
  if (!cert) {
    // Force one refresh in case Google rotated keys between requests.
    certCache.expiresAt = 0;
    const refreshed = await getSecureTokenCerts();
    if (!refreshed?.[header.kid]) {
      const error = new Error('Firebase ID token의 공개 인증서를 찾을 수 없습니다.');
      error.code = 'SG-RAG-ADMIN-AUTH-006';
      throw error;
    }
  }

  const publicCert = (certs?.[header.kid]) || (await getSecureTokenCerts())?.[header.kid];
  const signature = decodeBase64Url(encodedSignature);
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();

  if (!verifier.verify(publicCert, signature)) {
    const error = new Error('Firebase ID token 서명 검증에 실패했습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-007';
    throw error;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuer = `https://securetoken.google.com/${projectId}`;

  if (payload?.aud !== projectId || payload?.iss !== issuer) {
    const error = new Error('Firebase ID token의 project audience/issuer가 일치하지 않습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-008';
    throw error;
  }

  const uid = cleanText(payload?.sub);
  if (!uid || uid.length > 128) {
    const error = new Error('Firebase ID token의 uid(sub)가 올바르지 않습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-009';
    throw error;
  }

  if (!Number.isFinite(payload?.exp) || payload.exp <= nowSeconds) {
    const error = new Error('Firebase ID token이 만료되었습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-010';
    throw error;
  }

  if (!Number.isFinite(payload?.iat) || payload.iat > nowSeconds + 300) {
    const error = new Error('Firebase ID token의 발급 시간이 올바르지 않습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-011';
    throw error;
  }

  return {
    uid,
    email: cleanText(payload?.email) || null,
    emailVerified: payload?.email_verified === true,
    authTime: Number(payload?.auth_time) || null,
    token: payload
  };
}

export function getBearerToken(req) {
  const header = cleanText(req?.headers?.authorization || req?.headers?.Authorization);
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? cleanText(match[1]) : '';
}

export async function requireRagAdmin(req) {
  const allowed = parseAdminUids();
  if (allowed.length === 0) {
    const error = new Error(
      'SAJUGRAP_ADMIN_UID 또는 SAJUGRAP_ADMIN_UIDS가 서버에 설정되어 있지 않습니다.'
    );
    error.code = 'SG-RAG-ADMIN-AUTH-012';
    error.httpStatus = 503;
    throw error;
  }

  const identity = await verifyFirebaseIdToken(getBearerToken(req));

  if (!allowed.includes(identity.uid)) {
    const error = new Error('이 계정은 SajuGrap RAG 관리자 권한이 없습니다.');
    error.code = 'SG-RAG-ADMIN-AUTH-013';
    error.httpStatus = 403;
    throw error;
  }

  return identity;
}

export default Object.freeze({
  verifyFirebaseIdToken,
  getBearerToken,
  requireRagAdmin
});
