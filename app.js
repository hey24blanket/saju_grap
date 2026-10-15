import { PHASES, DOMAINS } from './lib/waveReading.js';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENT_KEY = 'sajugrap_experience_v2';
const ARCHIVE_KEY = 'sajugrap_archive_v2';
const CHAT_KEY = 'sajugrap_chat_v2';
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('저장 공간이 부족하거나 저장이 차단되어 있어요. 내보내기를 이용해 주세요.'); return false; } };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const uuid = () => crypto.randomUUID();
let current = read(CURRENT_KEY, null);
if (!current?.reading?.timelines || !current?.profile || !current.analysisId) current = null;
let archive = read(ARCHIVE_KEY, []);
if (!Array.isArray(archive)) archive = [];
let view = 'today', period = 'day', domain = 'all', selectedId = current?.reading?.today?.id;
let snapshot = false, chat = read(CHAT_KEY, null), busy = false, draftProfile = null, toastTimer;
const navItems = [
  ['today', '오늘', '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>'],
  ['flow', '흐름', '<path d="M2 13c4-11 5 11 10 0s6 11 10 0M2 7c4-9 5 9 10 0s6 9 10 0"/>'],
  ['profile', '내 사주', '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>'],
  ['archive', '보관함', '<rect x="4" y="4" width="16" height="17" rx="3"/><path d="M2 4V1h20v3M9 10h6"/>']
];
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; toastTimer = setTimeout(() => $('#toast').textContent = '', 4500); }
function wave(points, selected = '') {
  const list = points?.length ? points : ['gather', 'transition', 'unfold', 'transition', 'gather', 'unfold'].map(mode => ({ mode }));
  const count = Math.max(2, list.length);
  const bands = [-1, -.72, -.42, 0, .42, .72, 1].map((band, n) => {
    const coords = Array.from({ length: count }, (_, i) => ({ x: 600 * i / (count - 1), y: 80 + band * PHASES[list[Math.min(i, list.length - 1)].mode].spread }));
    let path = `M${coords[0].x},${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) { const a = coords[i - 1], b = coords[i], mid = (a.x + b.x) / 2; path += ` C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`; }
    return `<path d="${path}" stroke="${n % 2 ? 'var(--color-experience-hover)' : 'var(--color-wave-thread)'}" stroke-width="${n === 3 ? 1.8 : 1}" opacity="${n === 3 ? .85 : .55}" fill="none"/>`;
  }).join('');
  const ix = list.findIndex(p => p.id === selected);
  return `<svg class="wave" viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="선 간격이 좁으면 모이는 흐름, 넓으면 펼치는 흐름입니다. 간격은 운의 좋고 나쁨을 뜻하지 않습니다.">${bands}${ix >= 0 ? `<line x1="${600 * ix / (count - 1)}" x2="${600 * ix / (count - 1)}" y1="12" y2="145" stroke="var(--color-wave-thread)" stroke-dasharray="3 5" opacity=".55"/>` : ''}</svg>`;
}
function phaseLegend() { return `<div class="legend">${Object.values(PHASES).map(p => `<span style="--dot:${p.color}">${p.label}</span>`).join('')}</div>`; }
function selected() { return Object.values(current?.reading.timelines || {}).flat().find(p => p.id === selectedId) || current?.reading.today; }
function pillars(reading = current.reading, mini = false) {
  return `<div class="pillars ${mini ? 'mini-pillars' : ''}">${[['year', '태어난 해'], ['month', '태어난 달'], ['day', '태어난 날'], ['hour', '태어난 시']].map(([key, label]) => { const p = reading.natal[key]; return `<div class="pillar"><small>${label}</small><strong>${esc(p?.ganzhi || '—')}</strong><span>${p ? esc(p.stem + p.branch) : '미확정'}</span></div>`; }).join('')}</div>`;
}
function dateLabel(p) { return `${p.calendarType === 'lunar' ? '음력' + (p.isLeapMonth ? ' 윤달' : '') : '양력'} ${p.year}년 ${p.month}월 ${p.day}일 · ${p.unknownTime ? '시간 모름' : `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`}`; }
function heading(eyebrow, title, right = '') { return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1></div>${right ? `<span class="date-label">${right}</span>` : ''}</div>`; }
async function api(body, timeout = 165000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch('/api/experience', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    let json; try { json = await r.json(); } catch { throw new Error('연결이 끊겼어요. 잠시 후 다시 시도해 주세요.'); }
    if (!r.ok || !json.success) { const e = new Error(json.message || '잠시 후 다시 시도해 주세요.'); e.status = r.status; throw e; }
    return json;
  } catch (error) { if (error.name === 'AbortError') throw new Error('답변을 기다리는 시간이 길어졌어요. 다시 시도하면 준비된 답변을 확인할 수 있어요.'); throw error; }
  finally { clearTimeout(timer); }
}
function navigate(next) {
  if (!current && next !== 'archive') { renderOnboarding(); return; }
  view = next;
  render(); window.scrollTo({ top: 0, behavior: 'instant' }); $('#main').focus({ preventScroll: true });
}
function renderNav() {
  $('#navigation').hidden = !current && view !== 'archive';
  $('#navigation').innerHTML = navItems.map(([id, label, path]) => `<button data-nav="${id}" ${view === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>${label}</button>`).join('');
  $$('[data-nav]').forEach(b => b.onclick = () => navigate(b.dataset.nav));
}
function render() {
  renderNav();
  if (!current && view !== 'archive') return renderOnboarding();
  if (view === 'today') renderToday();
  if (view === 'flow') renderFlow();
  if (view === 'profile') renderProfile();
  if (view === 'archive') renderArchive();
  bindActions();
}
function archivedBanner() {
  if (snapshot) return `<div class="archive-notice">${esc(current.reading.referenceDate)} 기준으로 저장한 해설을 보고 있어요. <button class="quiet" data-action="refresh">오늘 흐름으로 돌아가기 ↗</button></div>`;
  if (current.reading.referenceDate !== today()) return `<div class="archive-notice">마지막으로 본 ${esc(current.reading.referenceDate)}의 해설이에요. <button class="quiet" data-action="refresh">오늘 흐름 보기 ↗</button></div>`;
  return '';
}
function readingCard(point, isToday = false) {
  const p = PHASES[point.mode];
  return `<section class="card hero-card"><span class="eyebrow">${isToday ? '나의 오늘 흐름' : esc(point.label)}</span><div><span class="badge">${p.label}</span></div><h2>${p.title}</h2><p>${p.description}</p>${wave(isToday ? current.reading.timelines.day : current.reading.timelines[period], point.id)}<div class="wave-caption"><span>${esc((isToday ? current.reading.timelines.day : current.reading.timelines[period])[0]?.label)}</span><span>${esc(point.label)} 선택</span><span>${esc((isToday ? current.reading.timelines.day : current.reading.timelines[period]).at(-1)?.label)}</span></div><p class="hero-note">모으는 때도, 펼치는 때도 각자의 쓰임이 있어요.</p></section>`;
}
function renderToday() {
  const reading = current.reading;
  if (reading.limited) { view = 'profile'; render(); return; }
  const point = reading.today;
  if (!point) { $('#main').innerHTML = '<div class="card empty"><h2>오늘의 흐름을 찾지 못했어요.</h2><button class="primary" data-action="refresh">다시 계산하기</button></div>'; return; }
  selectedId = point.id; period = 'day'; domain = 'all';
  $('#main').innerHTML = `${heading('A MOMENT FOR YOURSELF', `${esc(current.profile.name || '나')}의 흐름을 읽는 시간`, esc(reading.referenceDate.replaceAll('-', '. ')))}${archivedBanner()}<div class="grid">${readingCard(point, true)}<div class="stack"><section class="card action-card"><span class="eyebrow">오늘의 작은 실천</span><h3>거창하지 않아도 괜찮아요.</h3><p class="action-text">${PHASES[point.mode].action}</p><div class="actions"><button class="secondary" data-action="save">이 해설 저장 ＋</button></div></section><section class="card"><span class="eyebrow">나를 읽는 바탕</span>${pillars(reading, true)}<button class="quiet full" data-action="profile">내 사주 자세히 보기 →</button></section></div></div><div class="section-title"><h3>어떤 흐름이 궁금하세요?</h3><span class="muted">천천히 살펴보세요</span></div><div class="explore-grid"><button class="explore-card" data-action="flow"><span class="symbol">≈</span><h3>앞으로의 흐름</h3><p>날짜와 시기별로 살펴보기 →</p></button><button class="explore-card" data-action="chat"><span class="symbol">◌</span><h3>이 해설이 궁금하다면</h3><p>지금 본 흐름에서 상담 이어가기 →</p></button><button class="explore-card" data-action="archive"><span class="symbol">▤</span><h3>다시 읽는 나의 기록</h3><p>저장한 해설과 대화 돌아보기 →</p></button></div><p class="note">사주 그랩의 파동은 사주를 바탕으로 제안하는 생활의 관점이에요. 미래의 사건이나 성공 가능성을 예측하는 점수가 아니에요.</p>`;
}
function renderFlow() {
  if (current.reading.limited) { $('#main').innerHTML = `${heading('MY FLOW', '시간을 알면 더 자세히 볼 수 있어요')}<section class="card empty"><p>${current.reading.message}</p><button class="primary" data-action="edit">태어난 시간 입력</button></section>`; return; }
  const list = current.reading.timelines[period] || [];
  if (!list.some(c => c.id === selectedId)) selectedId = list[0]?.id;
  const point = selected();
  $('#main').innerHTML = `${heading('MY FLOW', '모이고, 펼쳐지는 나의 흐름', `${current.reading.referenceDate.slice(0, 4)}년 기준`)}${archivedBanner()}<div class="segmented" aria-label="기간">${[['day', '이번 달'], ['month', '올해'], ['year', '해마다'], ['daewoon', '큰 흐름']].map(([id, label]) => `<button data-period="${id}" aria-pressed="${period === id}">${label}</button>`).join('')}</div><div class="grid"><div>${readingCard(point)}<section class="card" style="margin-top:20px"><h3>궁금한 시기를 눌러보세요</h3><div class="timeline">${list.map(p => `<button data-point="${p.id}" aria-pressed="${p.id === point.id}" aria-label="${esc(p.label + ', ' + PHASES[p.mode].label)}">${period === 'day' ? p.day : esc(p.label.replace(' 절기 흐름', ''))}<small>${({gather:'모으기',unfold:'펼치기',transition:'전환'})[p.mode]}</small></button>`).join('')}</div>${phaseLegend()}<p class="note">${period === 'month' ? '월 흐름은 양력 1일이 아닌 절기에서 바뀌어요. 아래 해설 근거에서 시작일을 확인할 수 있어요.' : '파동의 폭은 모으기와 펼치기의 성격을 나타내요. 더 넓거나 좁은 쪽이 더 좋은 운을 뜻하지 않아요.'}</p></section></div><section class="card" style="align-self:start"><span class="eyebrow">${esc(point.label)} · 활용하기</span><h2 style="margin-top:12px">${PHASES[point.mode].verb}</h2><div class="domain-list" aria-label="관심 분야">${Object.entries(DOMAINS).map(([key, d]) => `<button data-domain="${key}" aria-pressed="${domain === key}">${d.label}</button>`).join('')}</div><p>${DOMAINS[domain][point.mode]}</p><p class="note">같은 흐름을 분야에 맞게 적용한 제안이에요. 분야별 길흉 점수를 매기지 않아요.</p><div class="actions"><button class="primary full" data-action="chat">이 흐름으로 상담하기 ↗</button><button class="secondary full" data-action="save">해설 보관하기 ＋</button></div><details><summary>어떻게 읽은 해설인가요?</summary><p>${esc(point.label)}의 간지는 ${esc(point.evidence.ganzhi)}, 십이운성은 ${esc(point.evidence.stage)}${point.evidence.tenGod ? `, 십성은 ${esc(point.evidence.tenGod)}` : ''}이에요. 십이운성의 성격을 사주 그랩의 모으기·펼치기·전환 언어로 풀었어요.${point.startDate ? ` 이 월운의 절기 시작일은 ${esc(point.startDate)}이에요.` : ''}</p><p>이것은 전통 명리의 해석 방식이며 실제 사건이나 심리 상태를 측정한 결과는 아니에요. 종합 해설에서는 원국과 다른 시기의 관계도 함께 살펴봐요.</p></details></section></div>`;
  $$('[data-period]').forEach(b => b.onclick = () => { period = b.dataset.period; render(); });
  $$('[data-point]').forEach(b => b.onclick = () => { selectedId = b.dataset.point; render(); });
  $$('[data-domain]').forEach(b => b.onclick = () => { domain = b.dataset.domain; render(); });
}
function renderProfile() {
  const p = current.profile, r = current.reading;
  const elements = { wood: ['나무', '자라고 뻗어가는 모습', '배우고 시도하는 일과, 충분히 뿌리내리는 시간을 함께 살펴볼 수 있어요.'], fire: ['불', '밝히고 나누는 모습', '생각을 표현하는 일과, 자신의 여유를 지키는 일을 함께 살펴볼 수 있어요.'], earth: ['흙', '받치고 연결하는 모습', '일상을 안정시키는 일과, 새롭게 바꾸고 싶은 부분을 함께 살펴볼 수 있어요.'], metal: ['금속', '다듬고 구분하는 모습', '나에게 필요한 기준을 세우는 일과, 다른 방식에 열어두는 여지를 함께 살펴볼 수 있어요.'], water: ['물', '흐르고 스며드는 모습', '유연하게 살펴보는 일과, 내 방향을 정하는 일을 함께 살펴볼 수 있어요.'] };
  const e = elements[r.dayMaster?.element];
  $('#main').innerHTML = `${heading('ABOUT MYSELF', '내 사주, 천천히 알아보기')}<div class="grid"><section class="card"><span class="eyebrow">${esc(p.name || '나')}의 네 기둥</span>${pillars()}${r.limited ? `<div class="archive-notice">${r.message}</div>` : ''}${e ? `<h2>${e[0]}, ${e[1]}</h2><p style="margin-top:18px">태어난 날의 천간인 ‘일간’을 ${e[0]}의 이미지로 읽어요. ${e[2]}</p><p class="note">나의 성격을 단정하는 이름표가 아니라, 나를 돌아볼 때 빌려 쓰는 비유예요.</p>` : ''}${r.structure ? `<details><summary>원국의 균형 더 알아보기</summary><dl><div><dt>일간의 지지 정도</dt><dd>${({ very_strong: '지지하는 힘이 크게 모인 편', strong: '지지하는 힘이 많은 편', weak: '지지하는 힘이 적은 편', very_weak: '지지하는 힘이 적게 모인 편', balanced: '중간 범위' })[r.structure.strength] || esc(r.structure.strength)}</dd></div><div><dt>균형을 돕는 관점 · 용신</dt><dd>${esc(elements[r.structure.yongsin]?.[0] || '미확정')}</dd></div><div><dt>보조하는 관점 · 희신</dt><dd>${r.structure.heesin.map(key => esc(elements[key]?.[0] || key)).join(', ') || '미확정'}</dd></div><div><dt>쏠림을 살필 관점 · 기신</dt><dd>${r.structure.gisin.map(key => esc(elements[key]?.[0] || key)).join(', ') || '미확정'}</dd></div></dl><p>신강·신약은 몸이나 마음의 강함이 아니라 사주 안에서 일간을 지지하는 관계를 분류한 말이에요. 용신은 무조건 좋은 것, 기신은 나쁜 것이 아니에요. 어떤 역할도 쓰이는 상황과 정도를 함께 살펴야 해요.</p></details>` : ''}<details><summary>네 기둥과 시간 기준</summary><p>사주는 태어난 해·달·날·시간을 네 기둥으로 정리한 전통 해석 체계예요. 여기서는 한국 출생 시각(Asia/Seoul)을 기준으로 계산해요. 해외 출생 시각을 그대로 입력하면 맞지 않을 수 있어요.</p><p>음력은 양력으로 변환한 뒤 절기를 기준으로 계산하고, 하루는 ${p.dayBoundary === 'zi' ? '23시' : '자정'}에 바뀌는 기준을 사용해요. 시간을 모르면 달력 경계에서 달라질 수 있는 기둥도 확정하지 않아요.</p></details><div class="actions"><button class="primary" data-action="flow">나의 흐름 살펴보기 →</button></div></section><div class="stack"><section class="card"><h3>입력한 정보</h3><dl><div><dt>생년월일</dt><dd>${esc(dateLabel(p))}</dd></div><div><dt>계산 기준</dt><dd>${Number(p.gender) === 1 ? '남성' : '여성'} · 한국 시각</dd></div><div><dt>하루의 시작</dt><dd>${p.dayBoundary === 'zi' ? '23시' : '자정'}</dd></div></dl><button class="secondary full" data-action="edit">정보 수정</button></section><section class="card"><h3>나의 정보와 기록</h3><p class="note">보관함은 이 브라우저에 저장돼요. 다른 기기로 자동 동기화되지 않아요. 상담 연결을 위해 서버에도 입력 정보와 대화가 저장되며 연결은 30일 뒤 만료돼요.</p><div class="actions"><button class="quiet" data-action="export">기록 내보내기 ↓</button><button class="quiet danger" data-action="delete">정보와 기록 삭제</button></div></section></div></div>`;
}
function renderArchive() {
  $('#main').innerHTML = `${heading('MY COLLECTION', '다시 읽고 싶은 나의 기록', `${archive.length}개의 기록`)}<p class="muted" style="margin:-10px 0 25px">이 브라우저에 보관한 해설과 대화예요. 저장 당시의 날짜와 내용을 그대로 볼 수 있어요.</p>${archive.length ? `<div class="archive-grid">${archive.map(item => `<article class="card archive-card"><span class="archive-date">${esc(item.savedAt.slice(0, 10))} 저장 · ${item.kind === 'chat' ? '대화' : '흐름 해설'}</span><h3>${esc(item.title)}</h3><p>${esc(item.action || '')}</p><div class="actions"><button class="quiet" data-open="${item.id}">기록 열기 →</button><button class="quiet danger" data-remove="${item.id}" aria-label="${esc(item.title)} 삭제">삭제</button></div></article>`).join('')}</div><div class="actions"><button class="secondary" data-action="export">기록 내보내기 ↓</button></div>` : `<section class="card empty"><div class="symbol">▤</div><h2>마음에 남는 해설을 모아보세요.</h2><p>해설에서 ‘저장’을 누르면 여기서 다시 읽을 수 있어요. 상담을 마친 뒤 대화도 함께 남길 수 있어요.</p><button class="primary" data-action="today">오늘 흐름 보러 가기 →</button></section>`}`;
  $$('[data-open]').forEach(b => b.onclick = () => {
    const item = archive.find(x => x.id === b.dataset.open); if (!item) return;
    current = structuredClone(item.experience); snapshot = true; selectedId = item.pointId; period = selected()?.type || 'day'; domain = item.domain || 'all';
    if (item.kind === 'chat') { chat = structuredClone(item.chat); render(); openChat(true); }
    else navigate('flow');
  });
  $$('[data-remove]').forEach(b => b.onclick = () => confirmDialog('이 기록을 지울까요?', '<p>보관함에서 삭제하며 되돌릴 수 없어요. 다른 기록과 입력한 정보는 남아 있어요.</p>', '삭제', async () => { const next = archive.filter(x => x.id !== b.dataset.remove); if (store(ARCHIVE_KEY, next)) { archive = next; render(); } else throw new Error('기록을 삭제하지 못했어요.'); }));
}
function renderOnboarding(profile = null) {
  $('#navigation').hidden = true;
  const p = profile || read('saju_grap_user_profile_cache', {}) || {};
  $('#main').innerHTML = `<div class="onboarding"><section class="onboarding-intro"><span class="eyebrow">YOUR OWN RHYTHM</span><h1>운을 모으는 때,<br>펼치는 때.</h1><p>좋은 날과 나쁜 날을 나누기보다<br>지금의 나에게 어울리는 흐름을 읽어보세요.</p>${wave()}<div class="wave-caption"><span>모으는 시간</span><span>펼치는 시간</span></div><p class="note">사주 그랩은 사주를 편안한 언어로 풀어<br>내 일상을 돌아보는 시간을 만듭니다.</p></section><section class="card form-card"><div class="step"><i>1</i> 정보 입력 <span>—</span> <i>2</i> 확인 후 해설</div><h2>나의 흐름을 만나볼까요?</h2><p class="muted">태어난 정보를 알려주세요. 이름은 비워도 괜찮아요.</p><form id="birthForm"><div class="form-fields"><div class="field wide"><label for="name">어떻게 불러드릴까요? <span class="muted">선택</span></label><input id="name" name="name" maxlength="30" autocomplete="nickname" placeholder="나" value="${esc(p.name || '')}"></div><div class="field wide"><label>생년월일</label><div class="birth-date"><input aria-label="태어난 연도" name="year" type="number" min="1900" max="2100" required placeholder="연도" value="${esc(p.year || '')}"><input aria-label="태어난 월" name="month" type="number" min="1" max="12" required placeholder="월" value="${esc(p.month || '')}"><input aria-label="태어난 일" name="day" type="number" min="1" max="31" required placeholder="일" value="${esc(p.day || '')}"></div></div><div class="field"><label for="calendarType">달력 기준</label><select id="calendarType" name="calendarType"><option value="solar">양력</option><option value="lunar" ${p.calendarType === 'lunar' ? 'selected' : ''}>음력</option></select></div><div class="field"><label for="gender">대운 계산 기준</label><select id="gender" name="gender" required><option value="">선택해 주세요</option value="1" ${Number(p.gender) === 1 ? 'selected' : ''}>남성</option><option value="2" ${Number(p.gender) === 2 ? 'selected' : ''}>여성</option></select></div><label id="leapField" class="field wide check" ${p.calendarType === 'lunar' ? '' : 'hidden'}><input type="checkbox" name="isLeapMonth" ${p.isLeapMonth ? 'checked' : ''}>음력 윤달에 태어났어요</label><div class="field wide"><label for="birthTime">태어난 시간 · 한국 시각</label><input id="birthTime" name="birthTime" type="time" ${p.unknownTime ? 'disabled' : 'required'} value="${p.hour != null ? `${String(p.hour).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}` : ''}"><label class="check"><input id="unknownTime" name="unknownTime" type="checkbox" ${p.unknownTime ? 'checked' : ''}>태어난 시간을 몰라요</label><p class="muted" id="unknownNote" ${p.unknownTime ? '' : 'hidden'}>시간을 추측하지 않고 확정 가능한 기둥만 보여드려요. 파동과 종합 상담은 시간 입력 후 볼 수 있어요.</p></div></div><details><summary>계산 기준 자세히</summary><div class="field" style="margin-top:12px"><label for="dayBoundary">하루가 바뀌는 시각</label><select id="dayBoundary" name="dayBoundary"><option value="midnight">자정 (00:00)</option><option value="zi" ${p.dayBoundary === 'zi' ? 'selected' : ''}>자시 (23:00)</option></select></div><p>이 버전은 한국 출생 시각을 지원해요. 대운의 순행·역행 계산을 위해 전통 명리의 남성·여성 기준을 사용해요.</p></details><p class="note">입력 정보는 해설 계산과 상담 연결을 위해 서버에 저장돼요. 상담을 보내면 사주 계산 결과와 대화가 Gemini 또는 OpenAI에 전달돼요. 내 사주에서 기록을 내보내거나 삭제할 수 있어요.</p><label class="check note"><input type="checkbox" required id="consent">이용 목적을 확인했고 입력 정보 저장에 동의해요.</label><div id="birthError" class="error" role="alert" hidden></div><button class="primary full" type="submit" style="margin-top:22px">입력 정보 확인하기 →</button>${current ? '<button class="quiet full" type="button" id="cancelEdit">이전 해설로 돌아가기</button>' : ''}</form></section></div>`;
  $('#calendarType').onchange = e => { $('#leapField').hidden = e.target.value !== 'lunar'; if (e.target.value !== 'lunar') $('[name=isLeapMonth]').checked = false; };
  $('#unknownTime').onchange = e => { $('#birthTime').disabled = e.target.checked; $('#birthTime').required = !e.target.checked; $('#unknownNote').hidden = !e.target.checked; };
  if ($('#cancelEdit')) $('#cancelEdit').onclick = render;
  $('#birthForm').onsubmit = e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); const unknown = form.has('unknownTime'); const [hour, minute] = String(form.get('birthTime') || '').split(':').map(Number);
    draftProfile = { name: form.get('name').trim(), year: Number(form.get('year')), month: Number(form.get('month')), day: Number(form.get('day')), calendarType: form.get('calendarType'), isLeapMonth: form.has('isLeapMonth'), gender: Number(form.get('gender')), hour: unknown ? null : hour, minute: unknown ? null : minute, unknownTime: unknown, dayBoundary: form.get('dayBoundary') };
    confirmDialog('입력한 정보가 맞나요?', `<span class="eyebrow">STEP 02 · 확인</span><dl><div><dt>생년월일과 시간</dt><dd>${esc(dateLabel(draftProfile))}</dd></div><div><dt>계산 기준</dt><dd>${draftProfile.gender === 1 ? '남성' : '여성'} · 한국 시각</dd></div><div><dt>하루의 시작</dt><dd>${draftProfile.dayBoundary === 'zi' ? '23시' : '자정'}</dd></div></dl><p class="muted">${unknown ? '태어난 시간에 따라 달라지는 항목은 확정하지 않을게요.' : '절기와 달력을 확인해 나의 흐름을 준비할게요.'}</p>`, '나의 해설 보기', async () => { await analyzeProfile(draftProfile); });
  };
}
async function analyzeProfile(profile, referenceDate = null) {
  const json = await api({ action: 'analyze', profile, ...(referenceDate ? { referenceDate } : {}) }, 40000);
  current = { analysisId: json.analysisId, reading: json.reading, profile: json.profile, sessionExpiresAt: json.sessionExpiresAt };
  snapshot = Boolean(referenceDate && referenceDate !== today()); selectedId = json.reading.today?.id; chat = null; localStorage.removeItem(CHAT_KEY);
  store(CURRENT_KEY, current); navigate(json.reading.limited ? 'profile' : 'today');
}
function saveReading() {
  const point = selected(); if (!point) return;
  const exists = archive.find(a => a.kind === 'reading' && a.experience.analysisId === current.analysisId && a.pointId === point.id && a.domain === domain);
  if (exists) { toast('이미 보관한 해설이에요. 보관함에서 다시 볼 수 있어요.'); return; }
  persistArchive({ id: uuid(), kind: 'reading', title: `${point.label} · ${PHASES[point.mode].label}`, action: DOMAINS[domain][point.mode], pointId: point.id, domain, experience: structuredClone(current), savedAt: new Date().toISOString() });
}
function persistArchive(item) {
  if (archive.length >= 40 && !archive.some(a => a.id === item.id)) { toast('기록은 40개까지 보관할 수 있어요. 내보낸 뒤 일부를 정리해 주세요.'); return false; }
  const next = [item, ...archive.filter(a => a.id !== item.id)];
  if (!store(ARCHIVE_KEY, next)) return false;
  archive = next; toast('보관함에 저장했어요. 언제든 다시 읽어보세요.'); return true;
}
function confirmDialog(title, body, label, action) {
  $('#confirmTitle').textContent = title; $('#confirmBody').innerHTML = body; $('#acceptConfirm').textContent = label; $('#acceptConfirm').disabled = false;
  $('#acceptConfirm').onclick = async () => {
    $('#acceptConfirm').disabled = true; $('#acceptConfirm').textContent = '잠시만요…';
    try { await action(); $('#confirmDialog').close(); } catch (e) { const prior = $('#confirmBody .error'); if (prior) prior.remove(); const error = document.createElement('p'); error.className = 'error'; error.role = 'alert'; error.textContent = e.message; $('#confirmBody').append(error); }
    finally { $('#acceptConfirm').disabled = false; $('#acceptConfirm').textContent = label; }
  };
  if (!$('#confirmDialog').open) $('#confirmDialog').showModal();
}
function bindActions() { $$('[data-action]').forEach(b => b.onclick = async () => {
  const action = b.dataset.action;
  if (['today', 'flow', 'profile', 'archive'].includes(action)) return navigate(action);
  if (action === 'edit') return renderOnboarding(current.profile);
  if (action === 'save') return saveReading();
  if (action === 'chat') return openChat();
  if (action === 'refresh') { b.disabled = true; try { await analyzeProfile(current.profile); } catch (e) { toast(e.message); b.disabled = false; } return; }
  if (action === 'export') return exportRecords();
  if (action === 'delete') return confirmDialog('정보와 기록을 모두 지울까요?', '<p>이 브라우저의 사주 정보·보관함·대화와 현재 연결의 서버 기록을 삭제해요. 삭제 후 복구할 수 없으니 필요하다면 먼저 내보내세요.</p>', '모두 삭제', async () => {
    if (busy) throw new Error('진행 중인 답변을 받은 뒤 삭제해 주세요.');
    await api({ action: 'delete' }, 30000);
    for (const storage of [localStorage, sessionStorage]) for (const key of Object.keys(storage)) if (/^(sajugrap_|saju_grap_|sg_pending_counseling_turns_v1:|sg_counseling)/.test(key)) storage.removeItem(key);
    current = null; archive = []; chat = null; snapshot = false; view = 'today'; render(); toast('입력 정보와 기록을 삭제했어요.');
  });
}); }
function exportRecords() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), current, archive, chat }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `sajugrap-records-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openChat(restore = false) {
  const point = selected(); if (!point) return;
  if (busy && chat?.pointId !== point.id) { toast('지금 준비 중인 답변을 받은 뒤 다른 해설을 열어주세요.'); return; }
  if (!restore && (!chat || chat.analysisId !== current.analysisId || chat.pointId !== point.id || chat.domain !== domain)) chat = { id: uuid(), analysisId: current.analysisId, pointId: point.id, domain, messages: [], experience: structuredClone(current), action: DOMAINS[domain][point.mode] };
  $('#chatContext').textContent = `${point.label} · ${PHASES[point.mode].label} · ${DOMAINS[domain].label}`;
  $('#chatError').hidden = true; $('#chatInput').value = chat.pending?.text || '';
  renderMessages();
  $('#chatPrompts').innerHTML = chat.messages.length ? '' : ['이 흐름을 일상에서 어떻게 쓰면 좋을까요?', '지금 한 가지에 집중한다면 무엇을 살펴볼까요?'].map(t => `<button type="button">${t}</button>`).join('');
  $$('#chatPrompts button').forEach(b => b.onclick = () => { $('#chatInput').value = b.textContent; $('#chatInput').focus(); });
  if (!$('#chatDialog').open) $('#chatDialog').showModal();
  if (chat.pending) { $('#chatError').textContent = '아직 받지 못한 답변이 있어요. 같은 질문으로 다시 시도할 수 있어요.'; $('#chatError').hidden = false; }
}
function renderMessages() {
  $('#chatMessages').innerHTML = (chat.messages.length ? chat.messages.map(m => `<div class="message ${m.role === 'user' ? 'user' : ''}">${esc(m.text)}</div>`).join('') : `<div class="message">${esc(chat.action)}\n\n지금 보고 있는 해설을 바탕으로 궁금한 점을 함께 살펴볼게요.</div>`) + (busy ? '<div class="message waiting" role="status">선택한 흐름과 질문을 함께 살펴보고 있어요…</div>' : '');
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  $('#sendChat').disabled = busy; $('#chatInput').disabled = busy; $('#saveChat').disabled = busy; $('#finishChat').disabled = busy;
}
$('#chatForm').onsubmit = async e => {
  e.preventDefault(); if (busy || !chat) return;
  const text = $('#chatInput').value.trim(); if (!text) return;
  // Keep the ID across a lost response, so the server can return the completed result.
  if (chat.pending && chat.pending.text !== text) { toast('먼저 보내던 질문을 다시 확인해 주세요. 새 질문은 답변을 받은 뒤 보낼 수 있어요.'); $('#chatInput').value = chat.pending.text; return; }
  const requestId = chat.pending?.id || uuid();
  if (!chat.pending) { chat.pending = { id: requestId, text }; chat.messages.push({ id: requestId, role: 'user', text }); }
  store(CHAT_KEY, chat); busy = true; renderMessages(); $('#chatError').hidden = true; $('#chatPrompts').innerHTML = '';
  try {
    const result = await api({ action: 'chat', analysisId: chat.analysisId, cycleId: chat.pointId, domain: chat.domain, conversationId: chat.id, requestId, text });
    chat.messages.push({ id: `${requestId}_reply`, role: 'assistant', text: result.reply }); delete chat.pending; store(CHAT_KEY, chat); $('#chatInput').value = '';
  } catch (error) {
    $('#chatError').textContent = error.message; $('#chatError').hidden = false;
    if ([401, 404].includes(error.status)) {
      const button = document.createElement('button'); button.className = 'quiet'; button.textContent = '같은 날짜의 해설 다시 연결';
      button.onclick = async () => {
        button.disabled = true;
        try { const saved = chat.experience, oldPoint = chat.pointId, oldDomain = chat.domain; await analyzeProfile(saved.profile, saved.reading.referenceDate); selectedId = oldPoint; period = selected()?.type || 'day'; domain = oldDomain; openChat(); toast('같은 날짜로 다시 연결했어요. 새 상담을 시작할 수 있어요.'); } catch (e) { toast(e.message); button.disabled = false; }
      }; $('#chatError').append(button);
    }
  } finally { busy = false; renderMessages(); }
};
function saveConversation(note = '') {
  if (!chat?.messages.some(m => m.role === 'assistant')) { toast('답변을 받은 뒤 대화를 저장할 수 있어요.'); return false; }
  if (note) { chat.action = note; store(CHAT_KEY, chat); }
  const point = Object.values(chat.experience.reading.timelines).flat().find(p => p.id === chat.pointId);
  return persistArchive({ id: chat.id, kind: 'chat', title: `${point.label} · 나의 상담`, action: note || chat.action, pointId: chat.pointId, domain: chat.domain, experience: chat.experience, chat: structuredClone(chat), savedAt: new Date().toISOString() });
}
$('#saveChat').onclick = () => saveConversation();
$('#finishChat').onclick = () => {
  if (!chat?.messages.some(m => m.role === 'assistant')) { $('#chatDialog').close(); return; }
  confirmDialog('오늘, 가져갈 한 가지', `<p class="muted">대화를 마치며 기억하고 싶은 내용을 직접 남겨보세요. 대화 전문과 함께 보관해 둘게요.</p><label class="field" style="margin-top:18px">나의 메모<textarea id="closingNote" rows="3" maxlength="500">${esc(chat.action)}</textarea></label><p class="note">다음에 보관함에서 다시 읽거나 상담을 이어갈 수 있어요.</p>`, '저장하고 마치기', async () => { if (saveConversation($('#closingNote').value.trim())) $('#chatDialog').close(); else throw new Error('저장하지 못했어요.'); });
};
$('#closeChat').onclick = () => $('#chatDialog').close();
$('#closeConfirm').onclick = $('#cancelConfirm').onclick = () => { if (!$('#acceptConfirm').disabled) $('#confirmDialog').close(); };
$('#confirmDialog').addEventListener('cancel', e => { if ($('#acceptConfirm').disabled) e.preventDefault(); });
$('#profileShortcut').onclick = () => current ? navigate('profile') : renderOnboarding();
window.addEventListener('online', () => toast('다시 연결됐어요. 이어서 볼 수 있어요.'));
window.addEventListener('offline', () => toast('인터넷 연결이 끊겼어요. 저장한 기록은 계속 볼 수 있어요.'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
