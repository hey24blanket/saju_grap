# SajuGrap RAG Manager MVP - 설치/운영 가이드

## 1. 무엇이 추가되었나

브라우저 관리자 UI:

- `/admin/rag`
- Firebase Email/Password 로그인
- JSONL 업로드/검증
- 기존 Production 대비 Diff
- `documentHash` + `embeddingHash`
- 변경된 embedding input만 재임베딩
- Firestore에 진행 상태를 저장하는 resumable batch embedding
- Quick Vector Search
- 실제 `ragQueryBuilder -> ragRetriever` 경로 테스트
- 실제 `api/chat.js`를 이용한 Gemini/GPT Draft 버전 테스트
- Draft -> Production atomic switch
- 이전 version rollback

핵심 서버 파일:

- `lib/ragAdminAuth.js`
- `lib/ragManagerCore.js`
- `api/admin/rag.js`

기존 코드 중 수정된 파일:

- `lib/ragDocumentSchema.js`
- `lib/ragRetriever.js`
- `api/chat.js`
- `vercel.json`

---

## 2. 운영 데이터 구조

### RAG chunks

기존 collection을 그대로 사용한다.

```text
sajugrap_rag_chunks
```

새 버전의 document id:

```text
v1.25__chunk001
v1.25__chunk002
v1.24__chunk001
...
```

각 chunk에는 다음 운영 필드가 붙는다.

```json
{
  "ragVersion": "v1.25",
  "knowledgeLayer": "myeongri",
  "documentHash": "...",
  "embeddingHash": "...",
  "managerMeta": {
    "diffState": "UNCHANGED",
    "embeddingStatus": "reused"
  }
}
```

`knowledgeLayer` 허용값:

```text
myeongri
counseling_case
conversation_style
```

### Version metadata

```text
sajugrap_rag_versions/{version}
```

상태:

```text
PREPARING
EMBEDDING
READY
PRODUCTION
ARCHIVED
FAILED
```

### Active pointer

```text
sajugrap_rag_manager/runtime
```

예:

```json
{
  "activeRagVersion": "v1.25",
  "previousRagVersion": "v1.24"
}
```

앱은 이 pointer를 읽고 **Vector Search 전에** `ragVersion == activeRagVersion`을 Firestore pre-filter로 적용한다.

첫 Production 전환 전에는 `activeRagVersion`이 없으므로 기존 legacy RAG 검색 방식이 그대로 유지된다.

---

## 3. 관리자 인증 - MVP 필수

### Firebase Console

1. Firebase Authentication을 연다.
2. Sign-in method에서 `Email/Password`를 활성화한다.
3. 관리자 계정 하나를 생성한다.
4. Users 화면에서 그 계정의 UID를 복사한다.

### Vercel Environment Variables

필수:

```text
SAJUGRAP_ADMIN_UID=<Firebase 관리자 UID>
FIREBASE_PROJECT_ID=saju-grap
```

여러 관리자를 허용하려면:

```text
SAJUGRAP_ADMIN_UIDS=uid1,uid2,uid3
```

RAG/Firestore용으로 기존 프로젝트에서 사용하던 값도 그대로 필요하다.

권장:

```text
FIREBASE_SERVICE_ACCOUNT_JSON={...service account json...}
GEMINI_API_KEY=...
```

GPT 테스트까지 쓸 경우:

```text
OPENAI_API_KEY=...
```

브라우저에는 service account 또는 Gemini/OpenAI key를 넣지 않는다.

Admin API는 Firebase ID token의 RS256 서명을 Google SecureToken 공개 인증서로 검증한 뒤 UID allowlist를 확인한다.

---

## 4. Firestore Vector composite index - 반드시 생성

버전 시스템을 Production으로 전환하기 전에 아래 index가 있어야 한다.

현재 기본 vector field:

```text
embeddingVector
```

현재 기본 dimension:

```text
768
```

### A. Production / Real App Retrieval

`ragVersion`을 먼저 필터한 뒤 vector search하기 위한 index:

```bash
gcloud firestore indexes composite create \
  --collection-group=sajugrap_rag_chunks \
  --query-scope=COLLECTION \
  --field-config=order=ASCENDING,field-path=ragVersion \
  --field-config=field-path=embeddingVector,vector-config='{"dimension":"768","flat":"{}"}'
```

### B. Manager의 knowledgeLayer Quick Search / Layer LLM Test

```bash
gcloud firestore indexes composite create \
  --collection-group=sajugrap_rag_chunks \
  --query-scope=COLLECTION \
  --field-config=order=ASCENDING,field-path=ragVersion \
  --field-config=order=ASCENDING,field-path=knowledgeLayer \
  --field-config=field-path=embeddingVector,vector-config='{"dimension":"768","flat":"{}"}'
```

`RAG_EMBEDDING_DIMENSIONS`를 768이 아닌 값으로 운영한다면 index dimension도 동일하게 바꿔야 한다.

Index 생성은 즉시 완료되지 않을 수 있으므로 Google Cloud Console > Firestore > Indexes에서 READY 상태를 확인한다.

---

## 5. 실제 사용 순서

### 최초 1회

1. 코드를 Vercel에 배포한다.
2. Firebase Email/Password 관리자 계정을 만든다.
3. `SAJUGRAP_ADMIN_UID`를 Vercel env에 넣는다.
4. 위 Firestore composite vector index를 생성한다.
5. `/admin/rag`에 로그인한다.

### RAG 업데이트 때마다

```text
JSONL 준비
  ↓
/admin/rag 접속
  ↓
JSONL 드래그
  ↓
검증
  ↓
Draft 생성
  ↓
Diff 확인
  ↓
Embedding 완료까지 실행
  ↓
Quick Search
  ↓
Real App Retrieval
  ↓
Gemini / GPT 최종 답변 테스트
  ↓
Production
```

문제가 생기면 Version 표에서 이전 `ARCHIVED` version의 `Rollback` 버튼을 누른다.

---

## 6. Diff 규칙

내부 상태:

```text
UNCHANGED
METADATA_MODIFIED
EMBEDDING_INPUT_MODIFIED
ADDED
DELETED
```

### documentHash

작성된 RAG document의 전체 의미/metadata 변경을 감지한다.
Embedding vector/provider/timestamp 같은 runtime artifact는 hash에서 제외한다.

### embeddingHash

실제로 embedding API에 들어가는 `embeddingText`만 hash한다.

따라서 `embeddingText`에는 영향을 주지 않는 metadata만 바뀐 경우 기존 vector를 재사용한다.

주의: 현재 `buildRagEmbeddingText()`는 title, domain, cycleType, factType, 일부 metadata, content를 포함한다. 따라서 이 필드들이 바뀌면 `embeddingHash`도 바뀌며 정상적으로 재임베딩된다.

---

## 7. Resumable embedding 동작

한 Vercel HTTP 요청에서 전체 corpus를 끝내지 않는다.

Manager UI의 `완료까지 실행`은 실제로 다음을 반복한다.

```text
POST embedBatch (기본 12 chunks)
  ↓
Firestore 진행 상태 저장
  ↓
다음 POST embedBatch
  ↓
...
  ↓
READY
```

각 chunk 상태:

```text
pending
processing
failed
done
reused
```

브라우저를 닫아도 상태는 Firestore에 남는다.
다시 접속해서 같은 version을 선택하면 이어서 실행할 수 있다.
10분 이상 `processing`에 멈춘 chunk는 stale job으로 보고 다시 처리할 수 있다.

---

## 8. 테스트 모드 차이

### Quick Search

```text
질문
→ query embedding
→ ragVersion / knowledgeLayer pre-filter
→ Firestore Vector Search
```

Query Builder를 거치지 않는 smoke test다.

### Real App Retrieval

```text
Engine Facts
+ domain/cycle
+ 사용자 질문
→ buildRagQuery()
→ retrieveRagForEngineFacts()
→ 동일 production retriever
```

실제 앱의 검색 경로를 확인한다.

### Gemini / GPT Test

Admin API가 기존 `api/chat.js`를 직접 호출한다.
일반 앱 요청과 같은 Engine Fact / RAG / prompt / provider 경로를 사용하면서, 테스트하고 싶은 Draft `ragVersion`만 서버 내부 옵션으로 주입한다.

Draft version override는 일반 `/api/chat` HTTP 요청 body에서는 받을 수 없게 되어 있다.

---

## 9. Legacy에서 Versioned RAG로 첫 전환

현재 Firestore에 이미 있는 기존 RAG 문서는 `ragVersion`이 없다.

첫 Draft 생성 시 Manager는:

1. `activeRagVersion`이 없음을 확인한다.
2. `ragVersion`이 없는 기존 문서를 legacy base로 읽는다.
3. 새 JSONL과 hash 비교한다.
4. 동일 vector는 새 version 문서에 재사용한다.
5. 새 version 전체가 READY가 될 때까지 기존 앱은 legacy 검색을 계속한다.
6. `Production` 버튼을 누르는 순간 `activeRagVersion` pointer가 생긴다.
7. 그 이후부터 앱은 version pre-filter vector search를 사용한다.

따라서 migration 중 앱의 기존 RAG를 먼저 삭제하지 않는다.

---

## 10. Casebook / Conversation Style 확장

이번 MVP는 schema를 다시 뜯지 않도록 `knowledgeLayer`를 미리 추가했다.

예:

```json
{
  "knowledgeLayer": "counseling_case",
  "situationType": "unpaid_invoice",
  "emotionContext": ["anxiety", "relationship_conflict"]
}
```

상담/대화 스타일 전용 metadata는 기존 `metadata` 또는 향후 schema extension으로 추가할 수 있다.

Manager는 이미 layer별 Quick Search를 지원한다.

단, **실제 Production chat에서 `myeongri 4 + counseling 2 + style 1` 같은 multi-lane retrieval orchestration은 이번 Manager MVP에서 자동 활성화하지 않았다.** 실제 Casebook schema와 검색 정책이 확정된 뒤 production retriever에 lane allocator를 붙이는 것이 안전하다.

---

## 11. 중요한 운영 원칙

- Production version 문서를 직접 수정하지 않는다.
- 수정은 항상 새 Draft version에서 한다.
- JSONL 업로드만으로 Production이 바뀌지 않는다.
- `READY` 확인 후 수동 Production 전환한다.
- 이전 version은 rollback을 위해 보존한다.
- 오래된 version 삭제/pruning은 별도 관리 기능으로 나중에 추가한다.
