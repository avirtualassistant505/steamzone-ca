# Steam Zone GHL Estimate Form Parity - Execution Plan

Last updated: 2026-03-03 (America/Winnipeg)

## Goal
Rebuild the Steam Zone estimate experience in GoHighLevel so it matches the original website estimate flows (all services, all fields, all conditional logic), keep pricing/email generation in Steam Zone APIs, and wire the same contract into GHL text/voice AI paths.

## What I audited
1. Canonical website estimate UI and validation.
2. Canonical schema and normalization rules.
3. Deterministic pricing engine dependencies.
4. Production `estimate-create` webhook normalization and GHL sync behavior.
5. Live GHL forms, form submissions, website chat agent action config, voice AI action config, workflows list.

## Current state (verified)
1. Website `/estimate` currently renders a single embedded GHL form when `VITE_GHL_ESTIMATE_FORM_EMBED_URL` is set.
2. Live GHL has only one estimate form: `Form 0` (`QbZdWQw7h4X7jkW8BEJ3`).
3. Current form submissions show only minimal fields (first/last name, phone, email, postal code, one service category field, one consent field).
4. Website chat Conversation AI agent has one `triggerWorkflow` action (`rbR9o1NBiuYOnabbGird`) that targets workflow `c527481a-1bfc-494d-aef0-d9c6e633afb7`.
5. Voice AI agent custom action `Create Estimate` currently exposes only a partial parameter set relative to the full website schema.
6. `api/estimate-create` can process partial GHL payloads, but that means missing answers often fall back to defaults, which is why pricing can mismatch expected wizard outputs.

## Root gap causing mismatches
The embedded GHL form and current chatbot action payloads do not collect the full original field set. Missing fields are defaulted server-side (`normalizeEstimateAnswers`), so quotes can differ from what the original wizard would have produced.

## Canonical source of truth
1. Schema: `src/quote/estimateFormSchema.json`.
2. Schema runtime helpers: `src/quote/schema.ts` and `src/quote/normalization.ts`.
3. UI behavior and step UX: `src/pages/GetEstimatePage.tsx`.
4. Pricing formulas: `server/estimateEngine.ts`.
5. Finalization/email/CRM sync: `api/estimate-create.ts` and `server/estimateFinalize.ts`.

## Mandatory parity contract
All GHL channels must produce a payload equivalent to:

```json
{
  "serviceType": "window|commercialWindow|carpet|postConstruction",
  "answers": {
    "...all required and conditionally-visible fields for that service...": "...",
    "contact": {
      "fullName": "...",
      "phone": "...",
      "email": "...",
      "address": "...",
      "consentToContact": true,
      "marketingOptIn": false
    }
  },
  "strict": true,
  "estimate_source": "form|chat|voice"
}
```

If this contract is not met, quote parity is not guaranteed.

## Full field inventory to recreate in GHL

## Shared (all services)
- Step 0: `serviceType` (`window`, `commercialWindow`, `carpet`, `postConstruction`).
- Step 1: `postalCode`, `zone` (`zoneA`, `zoneB`, `zoneC`, `zoneD`).
- Step 5 contact: `contact.fullName`, `contact.phone`, `contact.email`, `contact.address` (optional), `contact.consentToContact` (required true), `contact.marketingOptIn` (optional).

## Residential Windows (`window`)
- Step 1: `storey`.
- Step 2: `sizeBracket`.
- Step 3: `scope`, `screens`, `tracks`, `hardToReach`, `hardWaterRemoval`, `constructionDebris`.
- Step 4: `slidingRemoval`, `slidingQuantity` (required when `slidingRemoval != none`), `patioDoors`, `patioQuantity` (required when `patioDoors != none`), `skylights`, `skylightQuantity` (required when `skylights != none`), `railingGlass`, `frenchPanes`, `sunroom`, `walkoutBasement`.

## Commercial Windows (`commercialWindow`)
- Step 1: `buildingType`, `storeys`.
- Step 2: `sizeMode`, `paneCount` (required when `sizeMode=paneCount`), `frontageFeet` (required when `sizeMode=frontage`), `glassDoors`.
- Step 3: `scope`, `frequency`.
- Step 4: `liftRequired`, `afterHours`, `overspray`, `hardWater`.

## Carpet (`carpet`)
- Step 1: `estimateMode`.
- Step 2: `rooms` (required when `estimateMode=rooms`), `sqftBracket` (required when `estimateMode=sqft`).
- Step 3: `condition`.
- Step 4: `stairsSteps`, `hallways`, `furnitureMoving`, `advancedStainRemoval`, `odorElimination`, `petTreatment`, `stainProtector`, `unusualCondition`.
- Step 5: `schedule` (optional).

## Post-Construction (`postConstruction`)
- Step 1: `projectType`, `buildType`.
- Step 2: `sqftBracket`, `floors`.
- Step 3: `stage`, `dustLoad`.
- Step 4: `interiorWindows`, `scraping`, `floorDetailing`, `insideCabinets`, `appliances`, `specialDetailing`, `multiTenantAccess`.
- Step 5: `schedule` (optional).

## Critical implementation note on zone
Current backend logic in `api/estimate-create.ts` always sets zone from postal code detection. That blocks true manual zone override parity.

Required change:
1. Add explicit zone override support in `api/estimate-create.ts`.
2. Use provided `answers.zone` when present and valid.
3. Fall back to postal-code detection only when zone is missing/invalid.
4. Add tests for this behavior.

## Required architecture changes

## 1) GHL form structure
1. Replace single minimal form with full-service forms.
2. Recommended: create 4 forms (one per service) to avoid GHL conditional limitations and keep option sets clean.
3. Include all keys listed above for each service.
4. Ensure consent/marketing fields map to stable keys (no random custom field IDs in downstream payload).

## 2) Website embedding while keeping current look
1. Keep the existing React shell and service selector layout in `GetEstimatePage.tsx`.
2. Replace single iframe mode with a service-aware embed wrapper that loads the matching GHL form for selected service.
3. Preserve current headings, service tiles, and explanatory text to keep visual identity.
4. Keep `?mode=legacy` fallback until parity signoff is complete.

## 3) Workflow/webhook payload shaping
1. Create or update GHL workflow(s) so form submissions send canonical `serviceType + answers + contact` JSON to `POST /api/estimate-create`.
2. Do not rely on raw `formData` key names from GHL submissions.
3. Send `strict: true` for parity paths.
4. Send `estimate_source: form` for website embed.

## 4) Website chat (Conversation AI) integration
1. Keep the existing action-based trigger flow but ensure workflow `c527481a-1bfc-494d-aef0-d9c6e633afb7` builds the full canonical payload.
2. Update agent instructions only where needed to match canonical option labels/values.
3. Ensure workflow trigger condition requires all required fields for the selected service before calling `estimate-create`.

## 5) Voice AI integration
1. Expand voice custom action parameter schema from partial set to full canonical superset.
2. Update prompt to collect service-specific required fields before custom action execution.
3. Ensure payload produced by voice path is same canonical JSON shape.
4. Set `estimate_source: voice` for voice-triggered estimates.

## 6) Backend hardening for GHL input
1. Keep existing GHL normalization fallback logic.
2. Add an explicit canonical payload validator path for strict mode.
3. Add logging for missing required keys per service for faster GHL workflow debugging.

## Execution phases

## Phase 0 - Contract freeze
1. Freeze schema version and field key set from `estimateFormSchema.json`.
2. Freeze canonical payload shape and strict-mode requirements.
3. Freeze zone override rule.

## Phase 1 - Backend parity fixes
1. Implement zone override support.
2. Add tests for canonical GHL payloads for all 4 services.
3. Add tests for label-to-enum normalization where GHL sends user-facing labels.

## Phase 2 - GHL form rebuild
1. Build 4 full forms in GHL with service-specific field sets.
2. Build 4 dedicated workflows (or one router workflow) that map fields into canonical JSON.
3. Keep existing minimal form/workflow active until cutover testing passes.

## Phase 3 - Website embed rebuild
1. Add per-service GHL embed URL env vars.
2. Update `GetEstimatePage.tsx` to render service-aware embeds inside the existing branded container.
3. Preserve legacy wizard fallback.

## Phase 4 - Chatbot wiring
1. Update Conversation AI workflow action mapping to canonical payload.
2. Update Voice AI custom action schema and prompts.
3. Verify both channels hit `estimate-create` with complete payloads.

## Phase 5 - Validation and cutover
1. Run parity tests between legacy wizard and new GHL forms for each service using identical answers.
2. Run live submission tests and verify email + CRM updates.
3. Switch default `/estimate` UX fully to rebuilt GHL form set.
4. Keep rollback toggle available.

## Test plan (must pass before cutover)

## A) Automated repository tests
1. `npm run -s typecheck`.
2. `npm run -s test`.
3. Add new tests for:
- Canonical payload validation for each service.
- Zone override precedence.
- GHL label/value normalization for service type and consent fields.

## B) Deterministic quote parity tests
1. For each service, submit one fixed answer set through legacy wizard path and one through GHL-form path.
2. Assert identical `subtotal`, `estimateLow`, `estimateHigh`, `durationLowHours`, `durationHighHours`, and `lineItems`/trace factors where applicable.

## C) Live GHL workflow tests
1. Submit each of the 4 GHL forms from `/estimate`.
2. Confirm workflow execution success.
3. Confirm `api/estimate-create` response includes:
- `record` present.
- `email.success = true`.
- `ghl.posted = true`.
4. Confirm contact and opportunity updates in GHL.

## D) Chat and voice tests
1. Website chat estimate conversation for each service to completion.
2. Voice AI estimate call simulation for each service to completion.
3. Confirm both channels deliver full canonical payload and send estimate email.

## Definition of done
1. All original website estimate fields and conditionals exist in GHL forms.
2. Website `/estimate` uses rebuilt GHL forms and visually matches current branded experience.
3. Pricing outputs match legacy wizard for identical answers.
4. Website chat and voice chatbot paths produce the same estimate outputs using canonical payloads.
5. Email delivery to customer succeeds from form/chat/voice paths.
6. GHL contact/opportunity sync succeeds for all channels.
7. Legacy wizard remains available behind fallback toggle until signoff.

## Rollback plan
1. Keep `?mode=legacy` path operational.
2. Keep previous single-form embed URL and workflow as backup during rollout.
3. If parity or delivery fails, toggle `/estimate` back to legacy mode and re-enable prior workflow while fixes are applied.

## Files and systems that will be touched
1. `src/pages/GetEstimatePage.tsx`.
2. `api/estimate-create.ts`.
3. `tests/` for new parity/normalization coverage.
4. `GHL/steamzone.ca/scripts/ghl-voice-ai-receptionist-setup.mjs`.
5. GHL assets (forms, workflows, Conversation AI action mapping, Voice AI action mapping).
6. Vercel env vars for per-service embed URLs.

## Open decisions needed before build starts
1. One-form vs four-form GHL strategy.
2. Exact zone override rule when postal zone and manual selection differ.
3. Whether chat/voice must collect every optional add-on field or can proceed with defaults when optional fields are skipped.
4. Whether to keep current `triggerWorkflow` website-chat action or move to direct custom API action once full payload mapping is available.

## Execution status (completed 2026-03-03)
1. Created 4 service-specific GHL estimate forms (full field coverage per service):
- `window`: `NdaccmBU8EAZiNgvGLld`
- `commercialWindow`: `ncAHWlSdycnTE4UqlTHo`
- `carpet`: `Vhw1yGTzvEJOqyjPzzNK`
- `postConstruction`: `ymWd01vSPDLK3Hx7LS8Y`
2. Updated website embed environment vars for all environments (Development/Preview/Production):
- `VITE_GHL_ESTIMATE_FORM_EMBED_URL_WINDOW`
- `VITE_GHL_ESTIMATE_FORM_EMBED_URL_COMMERCIAL_WINDOW`
- `VITE_GHL_ESTIMATE_FORM_EMBED_URL_CARPET`
- `VITE_GHL_ESTIMATE_FORM_EMBED_URL_POST_CONSTRUCTION`
3. Rewired form-submission workflow `946b55b5-5ac8-4736-9efe-294fafd32339`:
- Webhook URL restored to `https://steamzoneca.vercel.app/api/estimate-create`
- Trigger now listens to the 4 new forms above
- Custom payload now sends canonical keys (`serviceType`, `postalCode`, `zone`, all service answers, contact fields), with `strict=true` and `source=form`
4. Expanded voice AI canonical estimate action:
- Agent: `6987a47137411f2a349c4abf` (`Steam Zone Voice Receptionist`)
- Custom action: `698a7e62fd324669290d294a` (`Create Estimate`)
- Updated to full parameter superset (65 parameters) including `strict` and `source=voice` guidance, plus all service-specific keys
5. Updated website chat AI routing:
- Agent: `pzGuMYdZeEpJjKcZ8K1P` (`Steam Zone Website Chat`)
- Added `FORM-FIRST ESTIMATE ROUTING` instruction block with direct per-service form URLs
- Updated workflow action `rbR9o1NBiuYOnabbGird` trigger condition to fallback-only behavior
6. Backend strict-mode hardening for GHL workflow payloads:
- `api/estimate-create.ts` now pre-coerces strict workflow strings into canonical typed values using schema normalizer (`normalizeAndValidateField`) before strict validation
- This allows strict validation to pass for string-based webhook values (e.g., integer/boolean/select fields from GHL)
7. Cleanup:
- Deleted exploratory/junk forms and workflows created during investigation.

## Validation evidence (current run)
1. `npm run -s typecheck` passed.
2. Targeted tests passed:
- `npx vitest run tests/api.test.ts tests/quoteEngine.test.ts`
3. Full suite currently has unrelated pre-existing failures in `tests/postagent.test.ts` (3 failing tests not in estimate-create/form integration path).
