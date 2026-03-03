# Steam Zone GHL Estimate Parity - Completion Report

Date: 2026-03-03 (America/Winnipeg)

## Objective
Recreate Steam Zone estimate flows in GoHighLevel with full field parity, wire those forms into website/chat/voice paths, keep pricing/email generation in `api/estimate-create`, and validate production behavior end to end.

## Delivery Status
- Completed: Website now routes by service to 4 dedicated GHL forms (full field sets).
- Completed: Backend strict parsing supports workflow-style string payload coercion.
- Completed: Explicit zone override is honored over postal auto-detection.
- Completed: Voice agent `Create Estimate` action expanded to full canonical parameter superset.
- Completed: Conversation AI agent instructions are form-first and include service-specific form routing links.
- Completed: Production deployment is live from Git commit `acd4141`.

## Live Assets (Verified)

### GHL Forms
- `window`: `NdaccmBU8EAZiNgvGLld`
- `commercialWindow`: `ncAHWlSdycnTE4UqlTHo`
- `carpet`: `Vhw1yGTzvEJOqyjPzzNK`
- `postConstruction`: `ymWd01vSPDLK3Hx7LS8Y`

### Workflows
- `946b55b5-5ac8-4736-9efe-294fafd32339` (`Steam Zone - Estimate Form Submission`) `published`
- `c527481a-1bfc-494d-aef0-d9c6e633afb7` (`Steam Zone - Generate Estimate (Website)`) `published`
- `99dcd666-9646-48a2-8d45-1222084a590e` (`... PRE-FIX BACKUP`) `draft`

### Chat + Voice Agents
- Conversation AI agent: `pzGuMYdZeEpJjKcZ8K1P` (`Steam Zone Website Chat`)
  - `FORM-FIRST ESTIMATE ROUTING` block present.
  - All 4 new form IDs present in instructions/goal content.
  - Fallback workflow action `rbR9o1NBiuYOnabbGird` present.
- Voice AI agent: `6987a47137411f2a349c4abf` (`Steam Zone Voice Receptionist`)
  - Prompt includes `CANONICAL ESTIMATE FIELD CONTRACT`.
  - Action `698a7e62fd324669290d294a` (`Create Estimate`) present with `65` API parameters.

## Website Embed Validation (Production)
Route tested: `https://steamzoneca.vercel.app/estimate`

Service selector iframe mapping observed:
- `window` -> `https://api.leadconnectorhq.com/widget/form/NdaccmBU8EAZiNgvGLld`
- `commercialWindow` -> `https://api.leadconnectorhq.com/widget/form/ncAHWlSdycnTE4UqlTHo`
- `carpet` -> `https://api.leadconnectorhq.com/widget/form/Vhw1yGTzvEJOqyjPzzNK`
- `postConstruction` -> `https://api.leadconnectorhq.com/widget/form/ymWd01vSPDLK3Hx7LS8Y`

Legacy fallback tested:
- `https://steamzoneca.vercel.app/estimate?mode=legacy`
- Result: legacy wizard loads, no GHL iframe rendered.

Mobile sanity check:
- 390x844 viewport loads service tiles + active iframe.

## GHL Form Field Parity Snapshot (Rendered Labels)

### window form labels include
- Service Type, Postal Code, Travel Zone
- House Type / Storeys, Square Footage Bracket, Cleaning Scope
- Screens, Tracks & Sills
- Hard-to-reach windows, Hard water removal, Construction debris / paint
- Sliding removal + quantity, Patio doors + quantity, Skylights + quantity
- Railing glass, French panes, Sunroom, Walkout basement
- Contact fields + consent + marketing

### commercialWindow form labels include
- Service Type, Postal Code, Travel Zone
- Building type, Storeys
- Glass size method, Pane count, Frontage, Glass door count
- Cleaning Scope, Service frequency
- Lift required, After-hours, Overspray, Hard water
- Contact fields + consent + marketing

### carpet form labels include
- Service Type, Postal Code, Travel Zone
- Estimate method, Room count, Square footage bracket
- Condition
- Stairs, Hallways, Furniture moving
- Advanced stain removal, Odor elimination, Pet treatment, Stain protector
- Flooding/mould/unusual condition, Preferred timeline
- Contact fields + consent + marketing

### postConstruction form labels include
- Service Type, Postal Code, Travel Zone
- Project type, Build type
- Square footage bracket, Floors / levels
- Cleaning stage, Dust load
- Interior windows, Sticker/paint scraping
- Floor detailing, Inside cabinets, Appliance detailing
- Special detailing, Multi-tenant access, Preferred timeline
- Contact fields + consent + marketing

## API / Pricing Validation (Production)
Endpoint tested: `POST https://steamzoneca.vercel.app/api/estimate-create`

### strict=true (all 4 services)
- `window`: 200, quote generated.
- `commercialWindow`: 200, quote generated.
- `carpet`: 200, quote generated.
- `postConstruction`: 200, quote generated.

### zone override precedence
- Sent postal code `R5G 2X3` with explicit `zone: zoneC`.
- Response preserved `zoneC` and priced with that zone.

### chat fallback compatibility
- Sent partial payload with `strict=false`, `source=chat`.
- Response 200 with quote generated.

### GHL sync behavior note
- Reusing same contact identity can return GHL API duplicate opportunity errors (`400 Can not create duplicate opportunity for the contact`).
- Using a fresh identity posts successfully (`ghl.posted=true`).

## Repo Validation
- `npm run -s typecheck` passed.
- `npx vitest run tests/api.test.ts tests/quoteEngine.test.ts tests/normalizeAndValidate.test.ts` passed (`40/40`).
- Full `npm run -s test` currently has `3` failing tests in `tests/postagent.test.ts` unrelated to estimate-form parity scope.

## Deployment Verification
Deployment inspected:
- URL: `https://steamzone-5fkurfvno-colin-ungers-projects-430edda4.vercel.app`
- Status: `Ready` (Production)
- Aliases on deployment:
  - `https://steamzone.ca`
  - `https://www.steamzone.ca`
  - `https://steamzoneca.vercel.app`

## Important DNS/Domain Observation
HTTP checks show `https://steamzone.ca` and `https://www.steamzone.ca` currently 301 to `https://www.steamzoneca.com/` (non-Vercel redirect path). Production behavior validated against `https://steamzoneca.vercel.app`.

## Conclusion
The estimate parity migration is implemented and production-validated on the Vercel deployment path (`steamzoneca.vercel.app`): full-service GHL forms, website service-aware embeds, strict payload handling, zone override correctness, and voice/chat agent contract updates are in place.
