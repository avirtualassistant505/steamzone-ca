# Steam Zone GHL Remediation Status

Date: 2026-03-05 (America/Winnipeg)

## Completed live changes

1. Renamed all live estimate forms in GHL:
   - `NdaccmBU8EAZiNgvGLld` -> `Residential Window Estimate Form`
   - `ncAHWlSdycnTE4UqlTHo` -> `Commercial Window Estimate Form`
   - `Vhw1yGTzvEJOqyjPzzNK` -> `Carpet Cleaning Estimate Form`
   - `ymWd01vSPDLK3Hx7LS8Y` -> `Post-Construction Estimate Form`
   - `QbZdWQw7h4X7jkW8BEJ3` -> `Legacy Estimate Intake (Archived)`

2. Removed deprecated exploratory contact custom fields from the live location:
   - `Estimate Consent to Contact`
   - `Estimate Service Category`
   - `Estimate Service Type`
   - `storey_select_test`

3. Updated live location metadata in GHL:
   - `website` -> `https://steamzoneca.vercel.app`
   - `business.website` -> `https://steamzoneca.vercel.app`

4. Verified website chat knowledge-base attachment is reduced to the single authoritative KB:
   - agent `pzGuMYdZeEpJjKcZ8K1P`
   - KB `AAI48TeEQmN9fv7uGWVJ`

5. Verified the live voice agent is using the corrected estimate-first prompt and direct estimate action:
   - agent `6987a47137411f2a349c4abf`
   - action `698a7e62fd324669290d294a` (`Create Estimate`)

## Backend hardening completed locally

1. Strict GHL form submissions now fail if required canonical keys are missing.
2. Strict GHL form submissions no longer silently infer travel zone.
3. Training-data fallback now records cache state correctly and falls back to disk snapshots when DB content is empty.
4. Admin diagnostics now expose:
   - training source
   - session/conversation storage mode
   - form inventory
   - legacy form submission count
   - unexpected custom fields
   - chat KB count and chat action types
   - GHL location website metadata

## Current platform constraint

GHL Conversation AI for website chat does not currently expose a custom API action type in the live product UI for this account. The available website-chat action types are:

- `Appointment Booking`
- `Trigger a Workflow`
- `Contact Info`
- `Stop Bot`
- `Human Handover`
- `Transfer Bot`
- `Auto Followup`

That means website chat cannot currently call `/api/estimate-create` directly as a first-class GHL chat action. The supported production path remains:

1. Chat collects the wizard answers.
2. Chat triggers workflow `c527481a-1bfc-494d-aef0-d9c6e633afb7`.
3. The workflow posts to `/api/estimate-create`.

This is a GHL product constraint, not an unimplemented repo change.
