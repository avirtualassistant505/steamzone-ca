# Steam Zone GHL Estimate Remediation Plan

Date: 2026-03-05 (America/Winnipeg)

## Objective

Bring Steam Zone estimate operations back to a single reliable contract:

1. Website form, website chat, and voice AI must all collect the same canonical estimate payload.
2. Pricing, quote generation, and customer email delivery must remain centralized in `/api/estimate-create`.
3. GHL must store quote metadata and structured wizard answers consistently.
4. Deprecated forms, KBs, fields, and prompts must stop influencing production behavior.

## Current priority findings

1. Voice AI prompt still contains legacy "minimum info / text link / callback" behavior that conflicts with full in-call estimate handling.
2. Conversation AI still depends on workflow-trigger routing for estimate generation instead of a typed direct estimate action.
3. Chat agent is attached to two overlapping knowledge bases, creating retrieval ambiguity and drift.
4. Deprecated GHL assets still exist in production: old `Form 0`, generic form names, and exploratory custom fields.
5. Backend normalization still allows partial GHL payloads to succeed by defaulting missing answers.
6. Training/session/conversation persistence has silent fallback behavior that weakens auditability.

## Remediation order

## Phase 1 - Live GHL behavior cleanup

Goal: stop live agents from drifting away from the intended estimate experience.

1. Rewrite the live Voice AI prompt so the primary estimate path matches website chat:
   - Full in-call estimate collection first.
   - Offer the form link only on explicit request.
   - Remove callback-first language unless the caller declines estimate intake.
2. Detach the duplicate knowledge base from the website chat agent and keep one authoritative KB attached.
3. Review website chat instructions and action metadata for contradictory fallback/link wording.
4. Rename active estimate forms in GHL to explicit service names.

Definition of done:
1. Voice AI instructions no longer conflict internally.
2. Website chat references one authoritative KB only.
3. Form list is human-readable in GHL.

## Phase 2 - Direct estimate action path

Goal: remove hidden workflow-mapping risk from chat/voice estimate generation.

1. Create a direct estimate custom action for website chat that posts canonical fields to `/api/estimate-create`.
2. Keep workflow automation only for downstream follow-up, tagging, or nurture steps after a quote exists.
3. Preserve fallback workflow routing temporarily behind a clearly labeled backup action until direct-action validation passes.

Definition of done:
1. Chat and voice both call the estimate API with explicit typed parameters.
2. Final quote generation no longer depends on hidden workflow field mapping.

## Phase 3 - GHL asset cleanup

Goal: remove deprecated assets that can reintroduce bad payloads or confuse staff.

1. Archive or clearly mark the old minimal estimate form `QbZdWQw7h4X7jkW8BEJ3`.
2. Remove exploratory custom fields that are not part of the canonical contract:
   - `storey_select_test`
   - duplicate service selector fields
   - temporary consent test fields that are not used downstream
3. Audit workflows so only current estimate paths remain publishable.
4. Replace any placeholder consent text in remaining legacy assets.

Definition of done:
1. Only supported estimate assets remain active.
2. Staff cannot accidentally wire a deprecated form/field back into production.

## Phase 4 - Backend hardening

Goal: stop silent estimate mismatches from incomplete GHL payloads.

1. Make `strict=true` fail on missing canonical service keys for production GHL form/chat/voice submissions.
2. Keep permissive normalization only for explicit fallback/debug paths.
3. Return structured missing-field diagnostics for faster GHL workflow debugging.
4. Add tests that prove strict-mode rejection for incomplete GHL payloads.

Definition of done:
1. Production GHL estimate paths cannot silently price with defaulted missing answers.
2. Missing inputs are visible immediately in logs and responses.

## Phase 5 - Reliability and monitoring

Goal: make storage and drift failures visible before they become customer issues.

1. Add admin-facing health indicators for:
   - training source (`db` vs `fallback`)
   - estimate session storage mode (`database` vs `memory_fallback`)
   - conversation log storage mode
2. Add per-form submission monitoring by GHL form ID.
3. Add a recurring regression suite for form/chat/voice parity.
4. Align GHL location metadata and outbound links to the canonical production domain.

Definition of done:
1. Silent fallback behavior becomes visible.
2. Deprecated forms and routing drift are detectable quickly.

## Immediate execution plan

Safe fixes to apply now:

1. Update live Voice AI prompt to remove legacy callback-first behavior.
2. Reduce website chat to a single authoritative knowledge base.
3. Rename live estimate forms in GHL for operational clarity.

Next code changes after live cleanup:

1. Tighten `strict=true` handling in `/api/estimate-create`.
2. Improve training-data fallback behavior and cache semantics.
3. Expose persistence/storage health in admin tooling.

## Validation checklist

1. Website chat completes one full quote without sending the form link first.
2. Voice AI can complete one full quote path without reverting to callback-only language.
3. GHL stores `quote_number`, `estimate_low`, `estimate_high`, and `wizard_answers_json`.
4. No deprecated form receives new production submissions.
5. Strict-mode tests fail when required service fields are omitted.
