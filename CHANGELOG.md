# Changelog

## WAPI v3.3 custom upgrade - 2026-10-03

- Upgrade the API to the WAPI v3.3 vendor release (social media connections and scheduled publishing, Mollie payments, campaign recovery, WhatsApp status sync, campaign batch stats and resume handling).
- Keep all custom behavior; in campaign creation keep the forwarded-host base URL and `/uploads/campaigns` media links alongside the new v3.3 batch stats, and keep resumed campaigns saving `is_paused = false` before restarting with the new resume option.
- Add the new v3.3 runtime dependencies (`@mollie/api-client`, `oauth`).

## WAPI v3.2 custom upgrade - 2026-07-16

- Upgrade the API to the complete WAPI v3.2 vendor release while retaining existing custom behavior.
- Add recurring campaign scheduling, custom cron support, campaign batching, Google Forms, announcement support, snooze processing, and expanded integrations.
- Preserve agent/team creation fixes, account credential emails, hard user deletion, campaign failure reporting, media validation, carousel upload mapping, and Meta template rollback.
- Restore the purchased installation state omitted from the vendor archive.
- Add the new v3.2 runtime dependencies and regenerate the dependency lockfile.

## Unreleased

- Make agents inherit their tenant owner's active subscription, plan limits, and shared usage while continuing to use team permissions for access control.
- Fix Location-header campaign delivery for both Meta Business API and Baileys connections, preserving coordinates through queued jobs and rejecting header mismatches before sending.
- Remove the Baileys hard-coded `Hello` retry fallback, cache the real outbound message for encryption retries, and send Location cards plus campaign body text on linked-device connections.
- Refresh selected template header and language metadata from Meta and correctly import, update, and publish Location-header templates.
- Fix template update errors showing a generic "Request failed with status code 400" instead of Meta's actual rejection reason, by using the same robust error-message extraction already used when creating templates.
- Fix marketing templates being misclassified as Coupon Code or Limited Time Offer (and vice versa) so the Coupon Code / Offer Expiration fields only appear for templates that actually use them.
- Fix WhatsApp media campaign delivery by generating publicly reachable upload URLs, validating media against Meta's approved header type, and rolling back local template changes when Meta rejects an update.
- Preserve carousel card-to-file mappings and reject browser-only blob URLs before sending templates to Meta.
- Hard delete staff/member users so deleted emails can be reused immediately.
- Send account credential emails when users or agents are created, while allowing deleted user emails to be reused safely.
- Capture WhatsApp campaign failure details from Meta status webhooks and store them on campaign recipients, campaign error logs, and message metadata.
