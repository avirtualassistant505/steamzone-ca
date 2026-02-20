# Estimate Agentic Chatbot Runbook

## Access
- Sandbox page route: `/estimate-bot-lab`
- Existing production estimate flow remains at `/estimate`

## Local run
1. Install dependencies:
   - `npm install`
2. Ensure environment variables are present:
   - `OPENAI_API_KEY` (required for `/api/estimate-agent/chat`)
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (optional; if missing, pricing defaults and in-memory sessions are used)
3. Start dev server:
   - `npm run dev`
4. Open:
   - `http://localhost:5173/estimate-bot-lab`

## API endpoints
- `POST /api/quote`
  - Validates schema-required answers server-side
  - Computes deterministic quote via quote engine
- `POST /api/estimate-agent/chat`
  - Runs OpenAI Responses API + tool-calling intake loop
  - Model is fixed to `gpt-5.2`

## Confirm GHL is excluded only on `/estimate-bot-lab`
1. Open `/estimate-bot-lab`.
2. In browser DevTools Elements/Network, confirm no GHL widget loader is present:
   - No script with `src` containing `widgets.leadconnectorhq.com/loader.js`
3. Open `/` (or `/estimate`).
4. Confirm GHL script is present there with the same attributes as before:
   - `src=https://widgets.leadconnectorhq.com/loader.js`
   - `data-resources-url=https://widgets.leadconnectorhq.com/chat-widget/loader.js`
   - `data-widget-id=698926cae64c73005344d35c`

## Session storage behavior
- Preferred: Supabase table `estimate_sessions`.
  - Fields used: `session_id`, `answers`, `asked_keys`, `transcript`, `last_question_key`, `created_at`, `updated_at`
  - SQL reference: `/Users/ghl/Documents/websites/steamzone.ca/server/sql/estimate_sessions.sql`
- Fallback: in-memory store when Supabase env/table is unavailable.

## Schema sync process when estimate form changes
Single source of truth for chatbot intake schema:
- `/Users/ghl/Documents/websites/steamzone.ca/src/quote/estimateFormSchema.json`

When form changes:
1. Update existing form UI as needed.
2. Update `estimateFormSchema.json` to mirror field labels/types/required/conditionals/options.
3. Update normalization logic in:
   - `/Users/ghl/Documents/websites/steamzone.ca/src/quote/normalization.ts`
4. If pricing logic changed, update deterministic engine in:
   - `/Users/ghl/Documents/websites/steamzone.ca/server/estimateEngine.ts`
   - Quote wrapper remains in `/Users/ghl/Documents/websites/steamzone.ca/src/quote/quoteEngine.ts`
5. Run tests:
   - `npm test`

## Test commands
- Unit/API tests:
  - `npm test`
- Existing E2E tests:
  - `npm run test:e2e`
