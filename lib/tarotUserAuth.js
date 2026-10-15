import {initializeApp,getApps,cert} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';

export function tarotAuth(){
  let app=getApps().find(a=>a.name==='tarot-user-auth');
  if(!app){
    const credential=process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ?JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      :{projectId:process.env.FIREBASE_PROJECT_ID,clientEmail:process.env.FIREBASE_CLIENT_EMAIL,privateKey:process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n')};
    app=initializeApp({credential:cert(credential)},'tarot-user-auth');
  }
  return getAuth(app);
}
export async function requireTarotUser(req,{verify=token=>tarotAuth().verifyIdToken(token,true)}={}){
  const match=String(req.headers?.authorization||'').match(/^Bearer ([^\s]+)$/);
  if(!match)throw Object.assign(Error('로그인이 필요해요.'),{status:401});
  let user;
  try{user=await verify(match[1]);}catch{throw Object.assign(Error('로그인이 만료됐어요. 다시 로그인해 주세요.'),{status:401});}
  if(!user.uid||user.email_verified!==true||user.firebase?.sign_in_provider==='anonymous')
    throw Object.assign(Error('이메일 인증을 마친 뒤 기록을 연결해 주세요.'),{status:403});
  return user;
}
