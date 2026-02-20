# Postagent Discovery

## Existing chatbot endpoint (to be reused)
- `/Users/ghl/Documents/websites/steamzone.ca/api/estimate-agent/chat.ts`
  - OpenAI Responses API call using `gpt-5.2`
  - Tool-calling loop currently uses local tool registry:
    - `get_schema`
    - `get_state`
    - `normalize_and_validate`
    - `set_answer`
    - `next_question`
    - `compute_quote`
  - `appendTranscript(sessionId, ...)` and `toolNextQuestion(...)` are used to track state and prompt progression.
  - Current contract: requires `session_id` and `user_message` (legacy alias).
  - Runtime tools are reached through `server/estimateAgentRuntimeEntry.ts` (TS bridge) and `server/estimateAgentTools.ts`.

## Shared agent logic candidates (already in use)
- `/Users/ghl/Documents/websites/steamzone.ca/server/estimateAgentTools.ts`
  - `toolGetSchema()`
  - `toolGetState(sessionId)`
  - `toolNormalizeAndValidate(fieldKey, userText, answersSoFar)`
  - `toolSetAnswer(sessionId, fieldKey, normalizedValue)`
  - `toolNextQuestion(sessionId)`
  - `toolComputeQuote(sessionId)`
  - `peekNextQuestion(sessionId)`
  - `summaryState(session)`
  - `newSessionState(sessionId)`
- `/Users/ghl/Documents/websites/steamzone.ca/server/estimateAgentSessionStore.ts`
  - session persistence + memory fallback
  - `getSession(sessionId)`
  - `saveSession(session)`
  - `appendTranscript(sessionId, entry)`

## Schema + validation stack to reuse
- `/Users/ghl/Documents/websites/steamzone.ca/src/quote/estimateFormSchema.json`
  - Canonical schema source (fields, types, conditionals, options, validation).
- `/Users/ghl/Documents/websites/steamzone.ca/src/quote/schema.ts`
  - schema loader + visibility/required logic + question builder + ui hint helpers
  - core functions: `getEstimateSchema`, `getSchemaField`, `getRequiredVisibleFieldsInOrder`,
    `buildQuestionText`, `buildInputUiHint`, `pruneInvisibleAnswers`.
- `/Users/ghl/Documents/websites/steamzone.ca/src/quote/normalization.ts`
  - `normalizeAndValidateField`
  - `validateRequiredAnswers`
  - Existing robust parsing rules (yes/no slang, 2k, commas, dimensions, ranges, etc.)

## Quote engine path (already deterministic + reused)
- `/Users/ghl/Documents/websites/steamzone.ca/src/quote/quoteEngine.ts`
  - `computeDeterministicQuote`
  - `loadActivePricingConfig` (via `server/pricingStore.ts`) and engine in `src/lib/estimateEngine.ts`
- `/Users/ghl/Documents/websites/steamzone.ca/api/quote.ts`
  - endpoint validates answers then calls deterministic quote runtime.

## Session/session_id usage
- Current store table contract:
  - `/Users/ghl/Documents/websites/steamzone.ca/server/sql/estimate_sessions.sql`
  - Columns: `session_id`, `answers`, `asked_keys`, `transcript`, `last_question_key`, timestamps
- Current chatbot route uses provided `session_id` and never auto-creates one.

## Web UI entry
- `/Users/ghl/Documents/websites/steamzone.ca/src/pages/EstimateBotLabPage.tsx`
  - currently calls `POST /api/postagent/estimate`
  - persists `session_id` in `localStorage`
  - renders quick action hints and quote summary.

## Route handling / GHL widget guard status
- `/Users/ghl/Documents/websites/steamzone.ca/src/components/GhlWidgetLoader.tsx`
- `/Users/ghl/Documents/websites/steamzone.ca/src/App.tsx`
  - existing implementation already excludes GHL on `/estimate-bot-lab` via `enabled={route !== '/estimate-bot-lab'}`.
  - no immediate code change needed for this requirement in postagent work.

## Planned reuse map for `/api/postagent/estimate`
- Core endpoint logic now reuses:
  - `loadSchema()`
  - `getState(sessionId)`
  - `appendTranscript(sessionId, ...)`
  - `normalizeAndSetAnswersFromInput(...)`
  - `runEstimateAgentCore(...)`
  - `decideNextAssistantTurn(...)`
  - shared server tools:
    - `toolGetSchema`
    - `toolNormalizeAndValidate`
    - `toolSetAnswer`
    - `toolNextQuestion`
    - `toolComputeQuote`
- Existing chatbot endpoint (`/api/estimate-agent/chat`) is refactored to delegate to the same core turn handler and keep response format consistent.
