import { firebasePublicConfig } from './firebasePublicConfig.js';

let ready;
export function loadAccountAuth() {
  if (!ready) ready = (async () => {
    const [app, sdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js')
    ]);
    const auth = sdk.getAuth(app.getApps().find(a => a.name === 'saju-reader') || app.initializeApp(firebasePublicConfig, 'saju-reader'));
    await auth.authStateReady();
    return { auth, sdk };
  })().catch(error => { ready = null; throw error; });
  return ready;
}

export function authMessage(error) {
  return ({
    'auth/invalid-credential': '이메일과 비밀번호를 확인해 주세요.',
    'auth/wrong-password': '이메일과 비밀번호를 확인해 주세요.',
    'auth/user-not-found': '이메일과 비밀번호를 확인해 주세요.',
    'auth/invalid-email': '이메일 주소를 확인해 주세요.',
    'auth/email-already-in-use': '이 이메일로 로그인하거나 비밀번호를 다시 설정해 주세요.',
    'auth/weak-password': '더 안전한 비밀번호를 사용해 주세요. 8자 이상을 권해요.',
    'auth/password-does-not-meet-requirements': '비밀번호의 길이와 문자 조합을 확인해 주세요.',
    'auth/too-many-requests': '잠시 쉬었다가 다시 시도해 주세요.',
    'auth/network-request-failed': '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    'auth/requires-recent-login': '기록을 보호하기 위해 다시 로그인해 주세요.'
  })[error?.code] || '계정 연결을 마치지 못했어요. 잠시 후 다시 시도해 주세요.';
}
