# SajuGrap counseling prototype

## Scope

The prototype changes only free-form `mode: "chat"` counseling. Existing
`prefetch`, `summary`, and `detail` response contracts remain compatible. The
SajuGrap engine is unchanged and remains the only source of calculated Saju
facts.

## Counseling state

- Schema: `sg_counseling_state_v1`.
- Browser storage: `sessionStorage` only, under
  `saju_grap_counseling_session_v1`.
- State separates subjects, observations, goals, constraints, attempts,
  tentative hypotheses, corrections, and open questions.
- Every non-subject state item must cite a real user message ID. Assistant
  messages and unknown IDs are rejected as evidence.
- A repeated message ID does not update state twice. A response for an older
  revision cannot overwrite the current state.
- Corrections mark the replaced item `superseded` or `retracted`; inactive
  items are excluded from the prompt's active state.
- A valid reply is preserved when its state delta is rejected.

The state is private session context. It is not written to public RAG,
ChunkingExpress, analytics, or a training dataset.

## Time-flow counseling

- Questions such as "when will it improve?", future-flow questions, and past
  comparisons receive a compact counseling timeline instead of one selected
  graph point.
- The timeline contains all ten annual cycles available from the engine, the
  current major-luck cycle, and monthly cycles for the requested years.
- The browser obtains a requested adjacent year's monthly cycles through the
  deterministic `/api/analyze` endpoint and sends only its cycle facts and
  monthly compatibility projection. Up to three supplemental years are
  allowed per turn.
- Missing supplemental years are recorded as coverage gaps. The model must
  not turn a coverage gap into generic financial, relationship, career, or
  health advice.
- Past readings are conditional comparisons against the user's actual
  experience. Future readings describe relative conditions and never promise
  an event or outcome.
- UI wave scores are explicitly non-canonical comparison heuristics. A
  `gisinImpact.activated` value only means an element match and must never be
  described as wealth activation.

## RAG policy

Modes are `off`, `optional`, and `required`.

1. A server runtime override has highest priority.
2. `RAG_MODE` is next.
3. A request `ragMode` is used when the server has no explicit mode.
4. Legacy `RAG_REQUIRED=false` maps to `optional`; other explicit legacy
   values map to `required`.
5. With no setting, free counseling defaults to `optional`; report modes
   default to `required`.

`optional` isolates missing Engine Facts, no results, timeout, embedding
errors, and retrieval errors from the final counseling call. `required`
returns a clear failure. `off` calls neither embedding nor retrieval.

Ordinary reality-based counseling uses a `counseling_reference` query purpose:
it does not apply Saju domain/cycle hard filters or boost results with natal
metadata. Explicit Saju and time-flow questions use `saju_interpretation`,
with the inferred domain and the relevant annual or monthly anchor. Free
counseling retrieves at most three chunks. Report modes keep the existing Saju
interpretation query. Explicit `inactive`, `retrievalAllowed:false`,
`isActive:false`, or negative-review flags always exclude a document. Legacy
documents with all activation fields missing retain the prior allow behavior
until the corpus is migrated.

## Configuration and rollback

- `COUNSELING_PROTO_ENABLED=false`: restores the previous plain-text chat
  response path. Reports are unaffected.
- `RAG_MODE=off|optional|required`: explicit server policy.
- `RAG_TIMEOUT_MS`: optional retrieval deadline; default `8000`.
- `RAG_TARGET_RESULTS`: report target; counseling is capped at 3.
- `ENABLE_TRAINING_TRACE=true`: permits the opt-in debug trace. It is disabled
  by default even if a client asks for it.

OpenAI Responses requests use `store:false`. Structured chat responses use a
strict JSON schema. Gemini chat responses request JSON output and are validated
by the same server parser and state reducer.

## Verification

Run:

```sh
npm test
```

The deterministic suite covers RAG off/optional/required behavior, explicit
document-denial flags, source validation, duplicate messages, stale revisions,
subject separation, corrections, more than 20 follow-up messages, prompt-data
boundaries, chat API compatibility, and the rollback path. Live model and
Firebase checks require configured credentials and an approved cost cap.

Passing this suite means the response path and fact contracts are ready for a
preview. It does not mean real counseling quality has been validated. That
second gate requires the live E07/E08 multi-turn evaluation, human review of
timing specificity and continuity, and explicit acceptance of the output.
