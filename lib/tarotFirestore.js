import {getFirestoreClient} from './ragRetriever.js';
// Tarot uses the same authenticated Firestore database and transactions over REST.
// Keep this client isolated so other Saju endpoints retain their existing transport.
let clientPromise;
export function getTarotFirestore(){
 if(!clientPromise)clientPromise=(async()=>{const client=await getFirestoreClient({forceNew:true});client.db.settings({preferRest:true});return client;})().catch(error=>{clientPromise=null;throw error;});
 return clientPromise;
}
