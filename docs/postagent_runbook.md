# Postagent Runbook

## What it is
- `POST /api/postagent/estimate` is the new channel-agnostic estimate agent endpoint.
- It reuses the same schema, normalization, and quote tooling as the existing estimate-chat flow.
- The existing `POST /api/estimate-agent/chat` route now calls the same core handler, so both flows share one brain.

## Quick local test
- Start dev server: `npm run dev`
- Open: `http://localhost:5173/estimate-bot-lab`
- Open DevTools → Network and send chat messages in the sandbox.

## Endpoint contract
`POST /api/postagent/estimate`

Request:

```json
{
  "session_id": "optional",
  "turn_id": "optional-uuid-per-user-turn",
  "input_text": "I need a window estimate",
  "channel": "web",
  "metadata": {}
}
```

Response:

```json
{
  "session_id": "abc123",
  "assistant_message": "What service type do you need?",
  "state": {
    "answers": {},
    "asked_keys": [],
    "last_question_key": "serviceType",
    "done": false
  },
  "quote": null,
  "done": false,
  "next_question": {
    "key": "serviceType",
    "question_text": "Service Type: ...",
    "input_ui_hint": {
      "type": "select",
      "options": []
    }
  }
}
```

If `session_id` is not supplied, the endpoint creates a new session and returns one.
If `turn_id` repeats for the same `session_id`, the endpoint returns the previously-processed state for idempotency.

## Finalize endpoint
`POST /api/postagent/finalize`

Request:

```json
{
  "session_id": "<session-id>",
  "send_email": true
}
```

Behavior:
- Validates required answers from the shared schema.
- Computes deterministic quote.
- Calls the same estimate-create pipeline with strict validation and idempotency.
- Marks session finalized metadata and returns quote/email/record details.

## Example cURL
```bash
curl -X POST http://localhost:5173/api/postagent/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "input_text":"Estimate for windows, postal code R5G 2X3, zone A",
    "turn_id":"turn-001",
    "channel":"web",
    "metadata":{"source":"curl-smoke"}
  }'
```

```bash
curl -X POST http://localhost:5173/api/postagent/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "session_id":"<session-id>",
    "turn_id":"turn-002",
    "input_text":"Update: I meant 10 windows and 2k sqft"
  }'
```

```bash
curl -X POST http://localhost:5173/api/postagent/finalize \
  -H "Content-Type: application/json" \
  -d '{
    "session_id":"<session-id>",
    "send_email":true
  }'
```

## Schema sync strategy
- The estimate form and validation behavior continue to come from:
  - `src/quote/estimateFormSchema.json`
  - `src/quote/schema.ts`
  - `src/quote/normalization.ts`
- If form behavior changes, re-run and sanity-check both flows because both routes share these shared modules.

## GHL exclusion check on sandbox
- In `src/App.tsx`, `GhlWidgetLoader` is already rendered with `enabled={route !== '/estimate-bot-lab'}`.
- Open `http://localhost:5173/estimate-bot-lab` and verify the GHL widget DOM/scripts are absent.
- Open any other route and verify widget behavior is unchanged.

## Troubleshooting
- If `/api/postagent/estimate` returns 500 and mentions `OPENAI_API_KEY`, set it in `.env.local` and Vercel.
- If chat turns do not progress, confirm `estimate_sessions` table exists in Supabase, otherwise memory fallback is used automatically.
- If quotes are empty, ensure all required fields are answered; incomplete sessions do not compute pricing.
