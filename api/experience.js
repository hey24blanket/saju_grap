import { randomUUID } from 'node:crypto';
import { getFirestoreClient } from '../lib/ragRetriever.js';
import { runChat } from './chat.js';
import { assertRequest, cleanProfile, computeExperience, getSession, getAnalysis, chatContext, consumeBudget, groundMemory, validateId, hash, ExperienceError } from '../lib/experienceService.js';

export default async function experience(req, res, runtime = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  let requestRef;
  let conversationRef;
  let lease;
  try {
    assertRequest(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = runtime.forcedAction || body.action;
    if (!['analyze', 'chat', 'delete'].includes(action)) throw new ExperienceError(400, '지원하지 않는 요청입니다.');
    const { db } = runtime.db ? { db: runtime.db } : await getFirestoreClient();
    const session = await getSession(db, req, res, { create: action === 'analyze' });
    if (action === 'delete') {
      await db.recursiveDelete(session.ref);
      res.setHeader('Set-Cookie', 'sg_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
      return res.status(200).json({ success: true });
    }
    if (action === 'analyze') {
      await consumeBudget(db, session, req, 'analyze');
      const profile = cleanProfile(body.profile);
      let referenceDateTime = new Date().toISOString();
      if (body.referenceDate !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate) || new Date(body.referenceDate).toISOString().slice(0, 10) !== body.referenceDate) throw new ExperienceError(400, '해설 기준일을 확인해 주세요.');
        referenceDateTime = `${body.referenceDate}T12:00:00+09:00`;
      }
      let calculated;
      try { calculated = computeExperience(profile, referenceDateTime); } catch (error) { throw new ExperienceError(400, '생년월일과 태어난 시간을 다시 확인해 주세요. 음력이라면 윤달 여부도 확인해 주세요.'); }
      const id = randomUUID();
      await session.ref.collection('analyses').doc(id).set({ profile, referenceDateTime, createdAt: Date.now(), engineVersion: calculated.data?.engineFacts?.engineVersion || 'limited' });
      return res.status(200).json({ success: true, analysisId: id, reading: calculated.reading, profile, sessionExpiresAt: session.value.expiresAt });
    }
    const analysis = await getAnalysis(session, body.analysisId);
    const selected = chatContext(analysis, body.cycleId, body.domain || 'all');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 1500) throw new ExperienceError(400, '질문을 1,500자 이내로 적어주세요.');
    const requestId = validateId(body.requestId);
    const conversationId = validateId(body.conversationId);
    conversationRef = session.ref.collection('conversations').doc(conversationId);
    requestRef = session.ref.collection('requests').doc(requestId);
    const fingerprint = hash(JSON.stringify([body.analysisId, body.cycleId, body.domain || 'all', conversationId, text]));
    lease = randomUUID();
    let previous;
    let conversation;
    await db.runTransaction(async tx => {
      const [r, c] = await Promise.all([tx.get(requestRef), tx.get(conversationRef)]);
      if (r.exists) {
        const old = r.data();
        if (old.fingerprint !== fingerprint) throw new ExperienceError(409, '같은 요청으로 다른 질문을 보낼 수 없어요.');
        if (old.status === 'complete') { previous = old.response; return; }
        if (old.status === 'pending' && old.until > Date.now()) throw new ExperienceError(409, '답변을 준비하고 있어요. 잠시 후 다시 확인해 주세요.');
      }
      conversation = c.data() || { analysisId: body.analysisId, cycleId: body.cycleId, domain: body.domain || 'all', messages: [], state: null };
      if (conversation.analysisId !== body.analysisId || conversation.cycleId !== body.cycleId || conversation.domain !== (body.domain || 'all')) throw new ExperienceError(409, '다른 해설의 상담은 새 대화로 열어주세요.');
      if (conversation.busyUntil > Date.now()) throw new ExperienceError(409, '이 대화의 앞선 답변을 기다려 주세요.');
      if (conversation.messages.length >= 40) throw new ExperienceError(422, '이 대화는 충분히 길어졌어요. 저장한 뒤 새 상담을 열어주세요.');
      tx.set(requestRef, { fingerprint, status: 'pending', lease, until: Date.now() + 180000 });
      tx.set(conversationRef, { ...conversation, lease, busyUntil: Date.now() + 180000 });
    });
    if (previous) return res.status(200).json(previous);
    await consumeBudget(db, session, req, 'chat');
    let status = 500; let result;
    const mockRes = { setHeader() {}, status(n) { status = n; return this; }, json(j) { result = j; return this; }, end() {} };
    const cycleLabels = { day: '일운', month: '월운', year: '연운', daewoon: '대운' };
    const messages = [...conversation.messages, { id: requestId, role: 'user', text }];
    await (runtime.runChat || runChat)({ method: 'POST', headers: {}, body: {
      mode: 'chat', ragMode: 'optional', cycle: cycleLabels[selected.selected.type], cycleIndex: selected.selected.index,
      domain: selected.context.domain, messageId: requestId, sessionId: conversationId,
      baseRevision: conversation.state?.revision || 0, counselingState: conversation.state, history: conversation.messages.slice(-20),
      userMessage: text, sajuContext: selected.data, includeTrainingTrace: false
    } }, mockRes, { readingContext: selected.context });
    if (status !== 200 || !result?.success || !result.reply) throw new ExperienceError(502, '답변을 끝까지 준비하지 못했어요. 같은 질문으로 다시 시도할 수 있어요.');
    const response = { success: true, reply: result.reply, conversationId, requestId, context: selected.context, diagnostic: { requestId: result.diagnostic?.requestId || requestId, provider: result.diagnostic?.provider || null } };
    const state = groundMemory(result.counselingState, messages);
    await db.runTransaction(async tx => {
      const [r, s] = await Promise.all([tx.get(requestRef), tx.get(session.ref)]);
      if (!s.exists || r.data()?.lease !== lease) throw new ExperienceError(409, '연결이 변경되어 답변을 저장하지 않았어요.');
      tx.set(requestRef, { fingerprint, status: 'complete', response });
      tx.set(conversationRef, { ...conversation, state, messages: [...messages, { id: `${requestId}_reply`, role: 'assistant', text: result.reply }], busyUntil: 0, updatedAt: Date.now() });
    });
    return res.status(200).json(response);
  } catch (error) {
    if (requestRef && lease) {
      try {
        const db = requestRef.firestore;
        await db.runTransaction(async tx => {
          const [r, c] = await Promise.all([tx.get(requestRef), tx.get(conversationRef)]);
          if (r.data()?.lease === lease && r.data()?.status === 'pending') tx.update(requestRef, { status: 'failed', until: 0 });
          if (c.data()?.lease === lease) tx.update(conversationRef, { busyUntil: 0 });
        });
      } catch { /* The original failure remains visible; a lease expires safely. */ }
    }
    const status = error instanceof ExperienceError ? error.status : 503;
    if (status === 405) res.setHeader('Allow', 'POST');
    return res.status(status).json({ success: false, message: error instanceof ExperienceError ? error.message : '연결을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
}
