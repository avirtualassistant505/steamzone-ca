# Repository Agent Defaults

## Deploy behavior (default)

When the user asks to "deploy", use this sequence by default:

1. Commit requested changes to Git.
2. Push the commit to the remote branch.
3. Deploy from the pushed Git commit (Git-based Vercel flow).
4. Verify the live URL and report deployment status.

Do **not** run a direct local `vercel --prod` deployment unless the user explicitly asks for a direct/local deploy.

## Resend email setup (default)

When the user asks to send estimate emails to real customers (not onboarding-only), follow this process.

1. Check current sender mode:
   - If `ESTIMATE_FROM_EMAIL` uses `onboarding@resend.dev`, treat account as onboarding/testing mode.
   - In onboarding mode, Resend only allows sends to the account owner's test inbox.
2. If user wants a fresh Resend account, that is valid:
   - Use new `RESEND_API_KEY`.
   - Re-verify sender domain in the new account.
   - Update app env vars and redeploy.
3. Require a verified custom domain before sending to external recipients:
   - Domain must be added and `verified` in Resend.
   - If DNS is Cloudflare, user must add exactly the records provided by Resend (DKIM TXT, `send` MX, `send` SPF TXT).
   - Keep DNS records as DNS-only (not proxied) where applicable.
4. If Resend plan limit blocks adding another domain:
   - Delete unused/pending domain first, or upgrade plan.
5. After domain verification, set sender:
   - `ESTIMATE_FROM_EMAIL="Steam Zone Quotes <quotes@<verified-domain>>"`
6. Update environment variables in both places:
   - Local: `.env.local`
   - Vercel project env vars: `RESEND_API_KEY`, `ESTIMATE_FROM_EMAIL`, and `ESTIMATE_TO_EMAIL` (if used)
7. Redeploy after Vercel env changes so serverless functions use updated values.
8. Only after all above: send the requested test email and report delivery result.

### Quick validation checklist

- Resend domain status is `verified`.
- Sender uses verified domain (not `onboarding@resend.dev`).
- Local env and Vercel env are aligned.
- Post-redeploy test send succeeds to target recipient.
