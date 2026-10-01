import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profiles = JSON.parse(await fs.readFile(path.join(ROOT, 'eval', 'counseling-profiles.json'), 'utf8'));
const scenarios = JSON.parse(
  await fs.readFile(path.join(ROOT, 'eval', 'counseling-scenarios.json'), 'utf8')
);

if (process.argv.includes('--holdout')) scenarios.splice(0, scenarios.length, ...JSON.parse(await fs.readFile(path.join(ROOT, 'eval', 'counseling-holdout.json'), 'utf8')));

function readArgs(argv) {
  const result = {
    profileId: 'P01',
    baseUrl: '',
    provider: '',
    ragMode: 'optional',
    scenarioIds: [],
    output: '',
    maxCalls: 0,
    confirmLive: false,
    resume: false,
    deploymentCommit: '',
    referenceDateTime: '2026-10-02T08:00:00+09:00'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--holdout') continue;
    else if (arg === '--resume') result.resume = true;
    else if (arg === '--deployment-commit') result.deploymentCommit = argv[++index] || '';
    else if (arg === '--reference-date') result.referenceDateTime = argv[++index];
    else if (arg === '--confirm-live') result.confirmLive = true;
    else if (arg === '--profile') result.profileId = argv[++index] || '';
    else if (arg === '--base-url') result.baseUrl = argv[++index] || '';
    else if (arg === '--provider') result.provider = argv[++index] || 'gemini';
    else if (arg === '--rag-mode') result.ragMode = argv[++index] || 'off';
    else if (arg === '--scenarios') result.scenarioIds = (argv[++index] || '').split(',').filter(Boolean);
    else if (arg === '--output') result.output = argv[++index] || '';
    else if (arg === '--max-calls') result.maxCalls = Number(argv[++index] || 0);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function postJson(url, body) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    throw new Error(`${url} failed: HTTP ${response.status} ${json?.error?.code || ''} ${json?.error?.message || ''}`);
  }
  return { json, elapsedMs: Date.now() - startedAt };
}

const options = readArgs(process.argv.slice(2));
const profile = profiles.find(p => p.id === options.profileId);
if (!profile) throw new Error(`Unknown profile: ${options.profileId}`);
const selected = options.scenarioIds.length
  ? scenarios.filter((scenario) => options.scenarioIds.includes(scenario.id))
  : scenarios;
for (const id of options.scenarioIds) if (!scenarios.some(s => s.id === id)) throw new Error(`Unknown scenario: ${id}`);
const plannedCalls = selected.reduce((total, scenario) => total + scenario.turns.length, 0);
const needsNextYearTimeline = selected.some((scenario) => scenario.id === 'E07');

const plan = {
  deploymentCommit: options.deploymentCommit,
  referenceDateTime: options.referenceDateTime,
  profileId: profile.id,
  profileTitle: profile.title,
  provider: options.provider,
  ragMode: options.ragMode,
  scenarioIds: selected.map((scenario) => scenario.id),
  plannedPaidChatCalls: plannedCalls,
  plannedAnalyzeCalls: 1 + (needsNextYearTimeline ? 1 : 0),
  note: 'One invocation tests one provider/RAG configuration. Analyze calls use the deterministic engine; chat calls invoke the selected model.'
};

if (!options.confirmLive) {
  console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
  process.exit(0);
}
if (!options.output) throw new Error('--output is required to retain live checkpoints.');
if (!options.baseUrl) throw new Error('--base-url is required for live evaluation.');
if (!Number.isInteger(options.maxCalls) || options.maxCalls < plannedCalls) {
  throw new Error(`--max-calls must be an integer >= planned calls (${plannedCalls}).`);
}

const baseUrl = options.baseUrl.replace(/\/$/, '');
const evaluationProfile = { ...profile.input, name: '합성 평가 사용자', timezone: 'Asia/Seoul', referenceDateTime: options.referenceDateTime };
const analysis = await postJson(`${baseUrl}/api/analyze`, evaluationProfile);
const engineData = analysis.json.data;
const referenceYear = Number(engineData.engineFacts?.cycles?.reference?.year);
const timelineContexts = [];
if (needsNextYearTimeline && Number.isFinite(referenceYear)) {
  const nextYear = referenceYear + 1;
  const nextAnalysis = await postJson(`${baseUrl}/api/analyze`, {
    ...evaluationProfile,
    referenceDateTime: `${nextYear}-09-15T12:00:00+09:00`
  });
  timelineContexts.push({
    referenceYear: nextYear,
    engineFacts: {
      schemaVersion: nextAnalysis.json.data.engineFacts.schemaVersion,
      engineVersion: nextAnalysis.json.data.engineFacts.engineVersion,
      cycles: {
        reference: nextAnalysis.json.data.engineFacts.cycles?.reference,
        month: nextAnalysis.json.data.engineFacts.cycles?.month
      }
    },
    cyclesData: nextAnalysis.json.data.cyclesData?.month
      ? { month: nextAnalysis.json.data.cyclesData.month }
      : null
  });
}
const sajuContext = {
  name: '합성 평가 사용자',
  pillars: engineData.pillars,
  dayPillar: engineData.pillars?.day,
  dayHanja: engineData.pillars?.dayHanja,
  engineFacts: engineData.engineFacts,
  cyclesData: engineData.cyclesData,
  timelineContexts
};
const currentDaewoonIndex = Math.max(0, engineData.engineFacts?.cycles?.daewoon?.findIndex((cycle) =>
  Number(cycle?.startYear) <= referenceYear && Number(cycle?.endYear) >= referenceYear
) ?? 0);

const checkpoint = options.resume && options.output ? JSON.parse(await fs.readFile(options.output, 'utf8')) : null;
if (checkpoint && (checkpoint.baseUrl !== options.baseUrl.replace(/\/$/, '') || checkpoint.deploymentCommit !== options.deploymentCommit || checkpoint.profileId !== profile.id || checkpoint.ragMode !== options.ragMode || checkpoint.referenceDateTime !== options.referenceDateTime || checkpoint.provider !== options.provider || JSON.stringify(checkpoint.scenarioIds) !== JSON.stringify(plan.scenarioIds))) throw new Error('Resume configuration mismatch');
const results = checkpoint?.results || [];
async function saveCheckpoint() {
  if (!options.output) return;
  const destination = path.resolve(options.output);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination + '.tmp', JSON.stringify({schemaVersion: 'sajugrap_counseling_eval_v3', createdAt: checkpoint?.createdAt || new Date().toISOString(), baseUrl, ...plan, engineFacts: engineData.engineFacts, results}, null, 2) + '\n');
  await fs.rename(destination + '.tmp', destination);
}

for (const scenario of selected) {
  const existing = results.find(r => r.id === scenario.id);
  const sessionId = existing?.sessionId || makeId(`eval-${scenario.id}`);
  let state = existing?.finalState || null;
  let history = existing?.history || [];
  const turns = existing?.turns || [];
  const result = existing || { id: scenario.id, title: scenario.title, sessionId, turns };
  if (!existing) results.push(result);

  for (let index = turns.length; index < scenario.turns.length; index += 1) {
    const userMessage = scenario.turns[index];
    const messageId = `${scenario.id}-u${index + 1}`;
    const response = await postJson(`${baseUrl}/api/chat`, {
      mode: 'chat',
      ...(options.provider ? { provider: options.provider } : {}),
      ragMode: options.ragMode,
      cycle: '대운',
      cycleIndex: currentDaewoonIndex,
      messageId,
      sessionId,
      baseRevision: Number(state?.revision || 0),
      counselingState: state,
      userMessage,
      history: history.slice(-20),
      includeTrainingTrace: false,
      sajuContext
    });
    const reply = response.json.reply;
    state = response.json.counselingState || state;
    history = [
      ...history,
      { id: messageId, role: 'user', text: userMessage },
      { id: `${scenario.id}-a${index + 1}`, role: 'model', text: reply }
    ];
    turns.push({
      turn: index + 1,
      userMessage,
      reply,
      elapsedMs: response.elapsedMs,
      diagnostic: response.json.diagnostic
    });
    result.finalState = state;
    result.history = history;
    await saveCheckpoint();
    console.log(`${profile.id}/${scenario.id}/${index + 1}: ${response.elapsedMs}ms`);
  }
}

const output = {
  schemaVersion: 'sajugrap_counseling_eval_v3',
  engineFacts: engineData.engineFacts,
  calculation: engineData.engineFacts?.calculation,
  natal: engineData.engineFacts?.natal,
  reviewStatus: 'requires_human_grounding_and_usefulness_review',
  createdAt: new Date().toISOString(),
  baseUrl,
  ...plan,
  results
};

if (options.output) {
  const destination = path.resolve(options.output);
  await fs.writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(destination);
} else {
  console.log(JSON.stringify(output, null, 2));
}
