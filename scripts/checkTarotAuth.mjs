import {tarotAuth} from '../lib/tarotUserAuth.js';
// Read-only deployment check. Never creates users, changes providers or prints credentials.
if(process.env.VERCEL_ENV==='production'){
 try{await tarotAuth().getUser('__tarot_capability_probe_not_a_user__');}
 catch(e){if(e.code!=='auth/user-not-found'){console.error('Tarot account verification unavailable:',e.code||'AUTH_SETUP');process.exit(1);}}
 console.log('Tarot Firebase account verification is configured.');
}
