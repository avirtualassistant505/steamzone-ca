# Estimate Agentic Chatbot Discovery

## Scope
This document captures discovery only (no implementation changes) for adding a new sandbox route with an OpenAI-powered estimate chatbot while leaving the existing estimate form and existing GHL chatbot behavior unchanged.

## Exact file paths discovered

### Existing estimate form (UI)
- `/Users/ghl/Documents/websites/steamzone.ca/src/pages/GetEstimatePage.tsx`
- `/Users/ghl/Documents/websites/steamzone.ca/src/App.tsx` (route wiring for `/estimate`)

### Existing pricing/quote logic
- `/Users/ghl/Documents/websites/steamzone.ca/server/estimateEngine.ts` (deterministic pricing formulas + defaults)
- `/Users/ghl/Documents/websites/steamzone.ca/src/lib/estimateEngine.ts` (re-export of server engine for shared types)
- `/Users/ghl/Documents/websites/steamzone.ca/api/estimate-create.ts` (server normalization/validation + `calculateEstimate` call)
- `/Users/ghl/Documents/websites/steamzone.ca/api/pricing-get.ts` (loads active pricing config from Supabase, fallback defaults)
- `/Users/ghl/Documents/websites/steamzone.ca/api/pricing-save.ts` (admin save endpoint)

### GHL widget/script injection
- `/Users/ghl/Documents/websites/steamzone.ca/index.html`
  - Global script currently injected in HTML body:
    - `https://widgets.leadconnectorhq.com/loader.js`
    - `data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js"`
    - `data-widget-id="698926cae64c73005344d35c"`

## Route map (current)
- `/` -> marketing/home content
- `/estimate` -> existing multi-step estimate wizard
- `/admin` -> pricing admin
- Other -> Not Found

Source: `/Users/ghl/Documents/websites/steamzone.ca/src/App.tsx`

## Existing estimate form: canonical field/rule inventory

## Global/shared validation
- `postalCode` format regex: `^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$`
- `contact.email` format regex: `^[^\s@]+@[^\s@]+\.[^\s@]+$`
- Contact rules: full name min length 2, phone must contain >=7 digits, consent required
- Zone auto-detection runs when postal code input length >=3; user can still manually change zone

Sources:
- `/Users/ghl/Documents/websites/steamzone.ca/src/pages/GetEstimatePage.tsx`
- `/Users/ghl/Documents/websites/steamzone.ca/server/estimateEngine.ts` (`detectZoneFromPostalCode`)

### Residential Window (`serviceType = window`)

| Step | Key | Label | Type | Options | Required | Validation / Rules | Conditional behavior |
|---|---|---|---|---|---|---|---|
| 1 | `postalCode` | Postal code | text | Canadian postal | Yes | Must match postal regex | Auto-detects `zone` when length >=3 |
| 1 | `zone` | Travel zone | select | `zoneA`, `zoneB`, `zoneC`, `zoneD` | Yes | No additional UI validation | User-overridable after auto-detect |
| 1 | `storey` | House type / storeys | select | `bungalow`, `oneHalf`, `two`, `twoHalf`, `three` | Yes | None | None |
| 2 | `sizeBracket` | Square footage bracket | select | `under1000`, `1000to1500`, `1500to2000`, `2000to2500`, `2500to3000`, `over3000` | Yes | None | None |
| 3 | `scope` | Scope | select | `exterior`, `interior`, `both` | Yes | None | None |
| 3 | `screens` | Screens | select | `none`, `some`, `all` | Yes | None | None |
| 3 | `tracks` | Tracks & sills | select | `basic`, `detailed` | Yes | None | None |
| 3 | `hardToReach` | Hard-to-reach windows | boolean | true/false | No | None | None |
| 3 | `hardWaterRemoval` | Hard water removal needed | boolean | true/false | No | None | None |
| 3 | `constructionDebris` | Construction debris / paint on glass | boolean | true/false | No | None | None |
| 4 | `slidingRemoval` | Sliding windows removal | select | `none`, `threePanel`, `fivePanel` | Yes | None | If not `none`, `slidingQuantity >= 1` |
| 4 | `slidingQuantity` | Sliding quantity | number | integer | Conditionally required | Must be >=1 when `slidingRemoval != none` | Always rendered; required only by condition |
| 4 | `patioDoors` | Patio doors | select | `none`, `takeApart`, `slideOnly` | Yes | None | If not `none`, `patioQuantity >= 1` |
| 4 | `patioQuantity` | Patio quantity | number | integer | Conditionally required | Must be >=1 when `patioDoors != none` | Always rendered; required only by condition |
| 4 | `skylights` | Skylights | select | `none`, `interior`, `exterior`, `both` | Yes | None | If not `none`, `skylightQuantity >= 1` |
| 4 | `skylightQuantity` | Skylight quantity | number | integer | Conditionally required | Must be >=1 when `skylights != none` | Always rendered; required only by condition |
| 4 | `railingGlass` | Railing glass | select | `none`, `oneSide`, `twoSides` | Yes | None | None |
| 4 | `frenchPanes` | French panes | select | `none`, `some`, `lots` | Yes | None | None |
| 4 | `sunroom` | Sunroom | boolean | true/false | No | None | None |
| 4 | `walkoutBasement` | Walkout basement access | boolean | true/false | No | None | None |
| 5 | `contact.fullName` | Full name | text | free text | Yes | min length 2 | Shared contact step |
| 5 | `contact.phone` | Phone number | tel | free text | Yes | >=7 digits after stripping non-digits | Shared contact step |
| 5 | `contact.email` | Email address | email | valid email | Yes | email regex | Shared contact step |
| 5 | `contact.address` | Property address (optional) | text | free text | No | None | Shared contact step |
| 5 | `contact.consentToContact` | Consent checkbox | boolean | true/false | Yes | Must be true | Shared contact step |
| 5 | `contact.marketingOptIn` | Marketing opt-in checkbox | boolean | true/false | No | None | Shared contact step |

### Commercial Window (`serviceType = commercialWindow`)

| Step | Key | Label | Type | Options | Required | Validation / Rules | Conditional behavior |
|---|---|---|---|---|---|---|---|
| 1 | `postalCode` | Postal code | text | Canadian postal | Yes | Postal regex | Auto-detects `zone` when length >=3 |
| 1 | `zone` | Travel zone | select | `zoneA`, `zoneB`, `zoneC`, `zoneD` | Yes | None | User-overridable |
| 1 | `buildingType` | Building type | select | `storefront`, `lowRise`, `midRise`, `highRise` | Yes | None | None |
| 1 | `storeys` | Storeys | select | `ground`, `twoToThree`, `fourToEight`, `ninePlus` | Yes | None | None |
| 2 | `sizeMode` | Estimate glass size method | select | `paneCount`, `frontage` | Yes | None | Controls whether pane count or frontage input is shown |
| 2 | `paneCount` | Pane count | number | integer | Conditionally required | Must be >=1 when `sizeMode = paneCount` | Only visible for `paneCount` mode |
| 2 | `frontageFeet` | Frontage (feet) | number | integer | Conditionally required | Must be >=1 when `sizeMode = frontage` | Only visible for `frontage` mode |
| 2 | `glassDoors` | Glass door count | number | integer | No | Numeric; no explicit min beyond input handling | Always visible |
| 3 | `scope` | Cleaning scope | select | `exterior`, `both` | Yes | None | None |
| 3 | `frequency` | Service frequency | select | `oneTime`, `monthly`, `biweekly`, `weekly` | Yes | None | None |
| 4 | `liftRequired` | Lift/boom access required | boolean | true/false | No | None | None |
| 4 | `afterHours` | After-hours cleaning required | boolean | true/false | No | None | None |
| 4 | `overspray` | Sticker/paint/overspray present | boolean | true/false | No | None | None |
| 4 | `hardWater` | Hard water stain treatment needed | boolean | true/false | No | None | None |
| 5 | `contact.*` | Shared contact fields | mixed | same as above | same as above | same as above | same as above |

### Carpet (`serviceType = carpet`)

| Step | Key | Label | Type | Options | Required | Validation / Rules | Conditional behavior |
|---|---|---|---|---|---|---|---|
| 1 | `postalCode` | Postal code | text | Canadian postal | Yes | Postal regex | Auto-detects `zone` when length >=3 |
| 1 | `zone` | Travel zone | select | `zoneA`, `zoneB`, `zoneC`, `zoneD` | Yes | None | User-overridable |
| 1 | `estimateMode` | Estimate method | select | `rooms`, `sqft` | Yes | None | Controls Step 2 field |
| 2 | `rooms` | Room count | number | integer | Conditionally required | Must be >=2 when `estimateMode = rooms` | Visible only in room mode |
| 2 | `sqftBracket` | Square footage bracket | select | `under500`, `500to1000`, `1000to1500`, `1500to2000`, `over2000` | Conditionally required | None | Visible only in sqft mode |
| 3 | `condition` | Condition | select | `light`, `moderate`, `heavy` | Yes | None | None |
| 4 | `stairsSteps` | Stairs (steps) | number | integer | No | Numeric | None |
| 4 | `hallways` | Hallways / corridors | number | integer | No | Numeric | None |
| 4 | `furnitureMoving` | Furniture moving | select | `none`, `light`, `heavy` | Yes | None | None |
| 4 | `advancedStainRemoval` | Advanced stain removal | boolean | true/false | No | None | None |
| 4 | `odorElimination` | Odor elimination | boolean | true/false | No | None | None |
| 4 | `petTreatment` | Pet treatment | boolean | true/false | No | None | None |
| 4 | `stainProtector` | Stain protector | boolean | true/false | No | None | None |
| 4 | `unusualCondition` | Flooding / mould / unusual condition | boolean | true/false | No | None | None |
| 5 | `schedule` | Preferred timeline | select | `asap`, `nextWeek`, `flexible`, `tomorrow` | No | None | Only shown for carpet and post-construction |
| 5 | `contact.*` | Shared contact fields | mixed | same as above | same as above | same as above | same as above |

### Post-Construction (`serviceType = postConstruction`)

| Step | Key | Label | Type | Options | Required | Validation / Rules | Conditional behavior |
|---|---|---|---|---|---|---|---|
| 1 | `postalCode` | Postal code | text | Canadian postal | Yes | Postal regex | Auto-detects `zone` when length >=3 |
| 1 | `zone` | Travel zone | select | `zoneA`, `zoneB`, `zoneC`, `zoneD` | Yes | None | User-overridable |
| 1 | `projectType` | Project type | select | `residential`, `commercial` | Yes | None | None |
| 1 | `buildType` | Build type | select | `renovation`, `newBuild` | Yes | None | None |
| 2 | `sqftBracket` | Square footage bracket | select | `under1000`, `1000to2500`, `2500to5000`, `over5000` | Yes | None | None |
| 2 | `floors` | Floors / levels | number | integer | Yes | Must be >=1 | None |
| 3 | `stage` | Cleaning stage | select | `rough`, `light`, `final`, `touchUp` | Yes | None | None |
| 3 | `dustLoad` | Dust load | select | `light`, `medium`, `heavy` | Yes | None | None |
| 4 | `interiorWindows` | Interior windows | select | `none`, `small`, `medium`, `large` | Yes | None | None |
| 4 | `scraping` | Sticker/paint scraping | select | `none`, `some`, `lots` | Yes | None | None |
| 4 | `floorDetailing` | Floor detailing | select | `none`, `small`, `medium`, `large` | Yes | None | None |
| 4 | `insideCabinets` | Inside cabinets / drawers | boolean | true/false | No | None | None |
| 4 | `appliances` | Appliance detailing | boolean | true/false | No | None | None |
| 4 | `specialDetailing` | Special detailing (vents/baseboards/doors) | boolean | true/false | No | None | None |
| 4 | `multiTenantAccess` | Multi-tenant access coordination | boolean | true/false | No | None | None |
| 5 | `schedule` | Preferred timeline | select | `asap`, `nextWeek`, `flexible`, `tomorrow` | No | None | Only shown for carpet and post-construction |
| 5 | `contact.*` | Shared contact fields | mixed | same as above | same as above | same as above | same as above |

## Backend normalization and validation behavior (submission path)

Endpoint: `/Users/ghl/Documents/websites/steamzone.ca/api/estimate-create.ts`

Current server behavior on submit:
1. Accepts `POST` only.
2. Requires `serviceType` and `answers` (or flattened body fallback).
3. Validates postal code format.
4. Validates contact (name + phone + email + consent required).
   - Exception for GHL webhook path: name and phone are relaxed (email + consent still required).
5. Normalizes answers via `normalizeEstimateAnswers(...)`:
   - Enum coercion to allowed values.
   - Numeric clamping (`clampInt`) with defaults.
   - Boolean coercion (`asBool`) with broad yes/no synonyms.
6. Loads pricing config from Supabase `pricing_config` table, fallback to `createDefaultPricingConfig()`.
7. Computes quote via deterministic engine: `engine.calculateEstimate(...)`.
8. Stores in `estimate_records` (with idempotency behavior if key provided).

## Where pricing is computed today (client vs server)

Pricing is computed server-side today.
- Frontend wizard (`GetEstimatePage`) posts to `/api/estimate-create`.
- `/api/estimate-create` calls `calculateEstimate(...)` from the server runtime (`server/estimateEngineRuntime.mjs`, generated from `server/estimateEngine.ts`).
- The client does not compute estimate totals at submission time.

## Deterministic pricing logic summary (current)

Primary engine:
- `/Users/ghl/Documents/websites/steamzone.ca/server/estimateEngine.ts`

Key deterministic behavior:
- Service-specific subtotal formulas for:
  - Residential window
  - Commercial window
  - Carpet
  - Post-construction
- Travel fee by zone included in subtotal.
- Per-service minimum charge enforcement.
- Estimate range computed from subtotal:
  - `low = round(subtotal * lowMultiplier)`
  - `high = round(subtotal * highMultiplier)`
- Confidence + booking mode derived from complexity score and red flags.
- Default pricing constants live in `createDefaultPricingConfig()` and can be overridden from Supabase (`pricing_config.id = 'active'`).

## GHL widget injection discovery

Current state:
- GHL widget script is injected globally in static HTML (`index.html`), so it loads on every route in this SPA.

Impact:
- There is currently no route-level guard at runtime for skipping GHL on a specific page.

## Plan to exclude GHL ONLY on `/estimate-bot-lab`

Proposed approach (implementation phase):
1. Move GHL script loading out of static `index.html` and into app runtime (route-aware loader).
2. Add a route check: if route is `/estimate-bot-lab`, do not inject/load GHL script.
3. For all other routes, inject the same script URL + attributes used today so behavior remains unchanged.
4. On route transitions into `/estimate-bot-lab`, ensure GHL script/widget nodes are removed if previously loaded.
5. Verify:
   - `/estimate-bot-lab` has no GHL script/widget in DOM.
   - `/`, `/estimate`, `/admin` still load GHL exactly as before.

## Notes for next phase
- Existing wizard is a 5-step per-service flow with several conditional branches (notably commercial size mode and carpet estimate mode) and shared contact block.
- The new agentic chatbot schema must mirror these fields and conditional requirements 1:1.
- Quote engine must remain deterministic and match `server/estimateEngine.ts` output exactly.
