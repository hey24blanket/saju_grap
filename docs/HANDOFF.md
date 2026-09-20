# SajuGrap 인수인계

새 채팅에서 이 파일부터 읽으면 된다.  
기준일: 2026-09-20. Production merge는 하지 않았다.

## 한 줄 상태

- **Production (`main`)**: 단일 스크롤 사주 대시보드까지 반영됨. `https://saju-grap.vercel.app/`
- **최신 작업**: Design Token Foundation + Dashboard Visual Redesign은 **Preview/draft PR만** 완료.
- **Production readiness**: **NOT READY**. 프로덕션 배포/머지 금지.

## 브랜치 스택 (아래가 먼저)

```
main / origin/main
  de5ec89  단일 스크롤 사주 대시보드
    └─ cursor/chat-hide-models-suit-caa3     PR #8  draft
         2f8ca0f  SUIT + 채팅 모델명 숨김 + Gemini→GPT fallback
         └─ cursor/design-token-foundation-v1-caa3   PR #9  draft
              7d021dd  토큰 체계만 추가, 시각 변화 없음
              └─ cursor/dashboard-visual-redesign-v1-caa3   PR #10  draft
                   fda2d04  밝은 대시보드 리디자인
                   7e8d8e2  그래프 높이/포인트 라벨 토큰 폴리시
```

다음 작업을 이을 때 **토큰/대시보드를 만지려면 PR #10 브랜치에서 시작**한다.  
`main`에서 다시 만들면 토큰·리디자인이 빠진다.

## Preview

- PR #10: https://github.com/hey24blanket/saju_grap/pull/10
- Preview: https://saju-grap-git-cursor-dashboard-visual-redesign-v1-caa3-blanket2.vercel.app
- Vercel CI: 마지막 커밋 `7e8d8e2` SUCCESS
- Preview에 SSO/Deployment Protection이 걸려 있으면 바로 안 열릴 수 있다.

---

## 지금까지 한 일

### 1. 상담 QA (코드 없음)

라이브 Preview에서 상담 PR 품질만 확인. Production 손대지 않음.

### 2. 홈을 단일 스크롤 대시보드로 재구성 — `main`에 있음

- 브랜치: `cursor/saju-dashboard-scroll-caa3` → `main` (`de5ec89`)
- 원국/핵심명리/그래프/고급 Fact를 한 페이지 스크롤로 올림
- 엔진/상담 로직 변경 없음

### 3. 채팅 UX + 폰트 + 모델 폴백 — PR #8

- 프로토타입 UI를 **SUIT**로 전환
- 채팅에서 Gemini/GPT 모델명 노출 제거
- 프로토타입 경로: **Gemini 우선, 막히면 GPT**
- 관련: `lib/chatProviderPolicy.js`

### 4. Design Token Foundation v1 — PR #9

- 소스: `styles/tokens.css`
- 문서: `docs/design-system/DESIGN_TOKENS.md`
- 계층: **Primitive → Semantic → Component → Screen**
- 이 PR의 목적은 **시각 변경 없이 값을 중앙화**하는 것
- 다음 리디자인은 여기 semantic/component 값을 바꾸는 방식으로만 진행

### 5. Dashboard Visual Redesign v1 — PR #10

토큰 체계를 다시 만들지 않고, #9 위에서 홈을 밝은 정보 대시보드로 바꿈.

최종 섹션 순서:

1. Greeting hero (이름 큰 타이포, 저장/다시입력 아이콘)
2. 원국 8자 (4주 mini-card, 일주 MASTER 강조)
3. 핵심 명리 (일간 / 강약 / 용신, value-first)
4. 운의 흐름 (시·일·월·연·대운 + 총/사업/재물/심신/연애)
5. 선택 시점 explanation + 그래프 포인트 라벨
6. 더 깊이 보기 accordion (용희기구한 / 구조 / 특수 / 기술 진단)
7. floating rounded bottom nav (홈 / 기상도 / 상담 / 상세분석 / 내 정보)

숨김/제거:

- 인생 에너지 저널: **코드·route·data 유지, UI만 hidden**
- `오늘 기상도 대화하기`: 노출 제거 (chat과 중복)
- `진단 보기` 버튼: 원국/핵심명리가 홈에 바로 보이므로 불필요
- 채팅 진입은 **bottom nav 상담 하나**만 유지

테스트: `npm test` 통과. 엔진/상담/RAG/Firestore/chat API 미변경.

---

## 해결된 문제

| 문제 | 해결 |
| --- | --- |
| 홈이 상담앱/진단 패널처럼 보임 | 밝은 blue-gray 배경 + white card + 넓은 spacing |
| 원국/핵심명리가 버튼 뒤에 숨음 | 대시보드 기본 노출 |
| 중첩 glass panel | 섹션은 spacing/type/card rhythm으로 구분 |
| 오행색이 UI accent와 섞임 | `--element-*`와 `--color-accent-*` 분리. water도 pastel fill + deep text |
| 그래프가 Excel/재무 차트처럼 보임 | area fill, 격자 최소화, 선택 점 확대, y축 숨김 |
| 모바일에서 그래프가 nav에 가림 | `--size-chart-compact` (14.5rem) / 데스크톱은 `--size-chart-height` |
| 선택 시점 피드백 약함 | 아래 설명 카드 + token tooltip 스타일 포인트 라벨 |
| 저널/기상도 대화 CTA가 홈을  dens하게 만듦 | UI 숨김. 기능 삭제는 아님 |
| 채팅 FAB와 nav 상담이 중복 | FAB 제거, nav 5칸 동일 |
| 토큰 없이 hex를 컴포넌트에 다시 뿌림 | `index.html` 커스텀 CSS는 semantic/component token 사용 |
| Gemini가 막히면 채팅이 죽음 | GPT fallback (`chatProviderPolicy`) |
| 채팅에 모델명이 노출됨 | UI에서 숨김 |

---

## 절대 건드리면 안 되는 것

- Saju Engine 계산
- Counseling Orchestrator / Interpretation Brief / Evidence Selector / RAG
- Firestore, chat API, 상담 로직
- Production (`saju-grap.vercel.app`) 직접 배포/머지
- 가짜 운세 점수, 가짜 그래프, 가짜 알림/뱃지
- 새 hex / 19·21·23px 같은 magic number를 컴포넌트에 대량 추가
- 토큰 계층을 새로 만들거나 우회

새 시각 값이 필요하면:

1. 기존 semantic token
2. 없으면 primitive → semantic 추가
3. 컴포넌트 전용이면 component token
4. 컴포넌트 CSS raw 값은 마지막 수단

---

## 다음에 할 일 (우선순위)

### P0 — 리뷰/머지 결정

1. PR #8 → #9 → #10 순으로 Preview 리뷰
2. 사람 확인 후 draft 해제 여부 결정
3. **Production merge는 사용자가 명시할 때만**

### P1 — 리디자인 잔여

- Preview SSO/Deployment Protection 때문에 외부에서 안 열리면 우회 또는 보호 설정 확인
- 390 첫 화면에서 그래프 explanation이 floating nav와 겹칠 수 있음. 스크롤하면 보임. 더 줄일지는 디자인 판단
- `430x932` 전용 검수는 약함. 390은 확인함
- 그래프 점 위 라벨과 아래 카드의 hover/persist 인덱스가 어긋나 보이면 `syncGraphFloat` / `updateGraphPoint` 점검
- `btnSaveToCloud`는 ID만 있고 핸들러가 원래 없음
- `/favicon.ico` 404, Tailwind CDN production warning (기존)

### P2 — 토큰 문서/정리

- `docs/design-system/DESIGN_TOKENS.md`는 **foundation 시점 문서**라 값이 구식이다. 리디자인 후 semantic 값으로 갱신 필요
- Tailwind 유틸 (`text-stone-800`, `bg-amber-500` 등)은 아직 토큰에 안 묶여 있음. 다음 패스에서 theme 연결 가능
- 온보딩/채팅 시트는 대시보드만큼 리디자인하지 않음. 톤만 glass→white로 따라감

### P3 — 제품/IA (이번 리디자인 범위 밖)

- bottom nav IA를 새로 만들지 말 것. 지금 라벨: 홈 / 기상도 / 상담 / 상세분석 / 내 정보
- 저널을 다시 노출하려면 새 진입점 기획이 필요. 삭제된 것이 아님
- 상담 PR #6 (`Interpretation Brief`)은 별도 draft. 대시보드 리디자인과 독립

---

## 핵심 파일

| 파일 | 역할 |
| --- | --- |
| `styles/tokens.css` | 토큰 소스. 시각 제어면 |
| `docs/design-system/DESIGN_TOKENS.md` | 토큰 문서 (foundation 기준, 일부 stale) |
| `index.html` | 프로토타입 UI + 대시보드 CSS/HTML/JS |
| `api/analyze.js` | Engine Facts API. 계산 금지, 오케스트레이션만 |
| `api/chat.js` | 상담 채팅 |
| `lib/chatProviderPolicy.js` | Gemini 우선 / GPT fallback |
| `src/engine/SajuGrapEngine.js` | 사주 엔진. 수정 금지 |

로컬에서 대시보드+엔진만 보려면 `index.html` + `POST /api/analyze`면 된다.  
분석 API는 Node에서 로컬 핸들러로 띄울 수 있다 (이전 세션은 `/tmp/preview-saju.mjs` + `127.0.0.1:4173`).

테스트:

```bash
npm test
```

빌드 스크립트는 없다. static `index.html` + Vercel functions.

---

## 새 채팅에 넣을 시작 프롬프트 초안

```text
SajuGrap 인수인계: docs/HANDOFF.md 를 먼저 읽어.

현재 최신 UI 작업은 draft PR #10
(cursor/dashboard-visual-redesign-v1-caa3, base는 token foundation PR #9).
Production main은 아직 단일 스크롤 대시보드(de5ec89)다.

토큰 계층을 새로 만들지 말고 styles/tokens.css 를 기준으로 해.
엔진/상담/RAG/Firestore/chat API와 Production 배포는 건드리지 마.
```
