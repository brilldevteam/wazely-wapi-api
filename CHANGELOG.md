# Changelog

## WAPI v3.2 custom upgrade - 2026-07-16

- Upgrade the API to the complete WAPI v3.2 vendor release while retaining existing custom behavior.
- Add recurring campaign scheduling, custom cron support, campaign batching, Google Forms, announcement support, snooze processing, and expanded integrations.
- Preserve agent/team creation fixes, account credential emails, hard user deletion, campaign failure reporting, media validation, carousel upload mapping, and Meta template rollback.
- Restore the purchased installation state omitted from the vendor archive.
- Add the new v3.2 runtime dependencies and regenerate the dependency lockfile.

## Unreleased

- Fix marketing templates being misclassified as Coupon Code or Limited Time Offer (and vice versa) so the Coupon Code / Offer Expiration fields only appear for templates that actually use them.
- Fix WhatsApp media campaign delivery by generating publicly reachable upload URLs, validating media against Meta's approved header type, and rolling back local template changes when Meta rejects an update.
- Preserve carousel card-to-file mappings and reject browser-only blob URLs before sending templates to Meta.
- Hard delete staff/member users so deleted emails can be reused immediately.
- Send account credential emails when users or agents are created, while allowing deleted user emails to be reused safely.
- Capture WhatsApp campaign failure details from Meta status webhooks and store them on campaign recipients, campaign error logs, and message metadata.
