import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readArgs(argv) {
  const result = {
    baseUrl: '',
    provider: 'gemini',
    confirmLive: false,
    output: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--confirm-live') result.confirmLive = true;
    else if (arg === '--base-url') result.baseUrl = argv[++index] || '';
    else if (arg === '--provider') result.provider = argv[++index] || 'gemini';
    else if (arg === '--output') result.output = argv[++index] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function analyzeProfile(baseUrl) {
  const { status, json } = await postJson(`${baseUrl}/api/analyze`, {
    name: '합성 평가 사용자',
    year: 1985,
    month: 10,
    day: 24,
    hour: 11,
    minute: 45,
    gender: 1,
    calendarType: 'solar',
    timezone: 'Asia/Seoul',
    referenceDateTime: '2026-09-16T12:00:00+09:00'
  });
  if (status !== 200 || !json?.success) {
    throw new Error(`analyze failed: ${status} ${JSON.stringify(json?.error || json)}`);
  }
  return json.data;
}

async function chatTurn(baseUrl, body) {
  const { status, json } = await postJson(`${baseUrl}/api/chat`, body);
  if (status !== 200 || !json?.success) {
    throw new Error(`chat failed: ${status} ${JSON.stringify(json?.error || json)}`);
  }
  return json;
}

const options = readArgs(process.argv.slice(2));

if (!options.confirmLive) {
  console.log(JSON.stringify({
    dryRun: true,
    note: 'Pass --confirm-live --base-url https://your-preview.vercel.app',
    turns: 5
  }, null, 2));
  process.exit(0);
}

if (!options.baseUrl) {
  throw new Error('--base-url is required');
}

const baseUrl = options.baseUrl.replace(/\/$/, '');
const analyzeData = await analyzeProfile(baseUrl);
const sajuContext = {
  name: analyzeData.name,
  engineFacts: analyzeData.engineFacts,
  cyclesData: analyzeData.cyclesData
};

const sessionId = `orch-preview-${Date.now()}`;
let history = [];
let counselingState = null;
let baseRevision = 0;

const scriptedTurns = [
  { id: 't1', text: '내 금전운은 언제 좀 풀릴까요?' },
  { id: 't2', text: '그렇게 보는 명리적인 이유는 뭐야?' },
  { id: 't3', text: '그럼 현실에서는 뭘 먼저 확인해야 해?' },
  { id: 't4', text: '내가 그런 정산 문제 있다고 말한 적 없는데?' }
];

const report = [];

for (const turn of scriptedTurns) {
  const payload = await chatTurn(baseUrl, {
    mode: 'chat',
    provider: options.provider,
    ragMode: 'optional',
    domain: '총운',
    messageId: turn.id,
    sessionId,
    baseRevision,
    userMessage: turn.text,
    history,
    counselingState,
    sajuContext
  });

  const reply = payload.data?.reply || payload.reply || '';
  const diagnostic = payload.diagnostic || payload.data?.diagnostic || {};
  const orch = diagnostic.counselingOrchestrator || null;

  report.push({
    turn: turn.id,
    userMessage: turn.text,
    focus: orch?.focus || null,
    evidenceScopes: orch?.evidenceScopes || null,
    evidencePeriods: orch?.evidencePeriods || null,
    timingGrounded: orch?.timingGrounded ?? null,
    timingYearGrounded: orch?.timingYearGrounded ?? null,
    timingMonthGrounded: orch?.timingMonthGrounded ?? null,
    knowledgeRag: diagnostic.rag?.status || null,
    exampleRag: diagnostic.exampleRag?.status || null,
    reply
  });

  history = [
    ...history,
    { id: turn.id, role: 'user', text: turn.text },
    { id: `${turn.id}-a`, role: 'model', text: reply }
  ];
  counselingState = payload.data?.counselingState || payload.counselingState || counselingState;
  baseRevision = counselingState?.revision ?? baseRevision + 1;
}

const coldSessionId = `orch-preview-cold-${Date.now()}`;
const coldPayload = await chatTurn(baseUrl, {
  mode: 'chat',
  provider: options.provider,
  ragMode: 'optional',
  domain: '총운',
  messageId: 'cold1',
  sessionId: coldSessionId,
  baseRevision: 0,
  userMessage: '그럼 지금 현실에서는 뭘 먼저 확인해야 해?',
  history: [],
  counselingState: null,
  sajuContext
});

const coldOrch = coldPayload.diagnostic?.counselingOrchestrator || null;
report.push({
  turn: 'cold1',
  userMessage: '그럼 지금 현실에서는 뭘 먼저 확인해야 해?',
  focus: coldOrch?.focus || null,
  evidenceScopes: coldOrch?.evidenceScopes || null,
  evidencePeriods: coldOrch?.evidencePeriods || null,
  timingGrounded: coldOrch?.timingGrounded ?? null,
  knowledgeRag: coldPayload.diagnostic?.rag?.status || null,
  exampleRag: coldPayload.diagnostic?.exampleRag?.status || null,
  reply: coldPayload.data?.reply || coldPayload.reply || ''
});

const output = { baseUrl, provider: options.provider, report };
console.log(JSON.stringify(output, null, 2));
if (options.output) {
  await fs.writeFile(path.resolve(options.output), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}
