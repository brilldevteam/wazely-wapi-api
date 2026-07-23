# Changelog

## Unreleased

- Fix marketing templates being misclassified as Coupon Code or Limited Time Offer (and vice versa) so the Coupon Code / Offer Expiration fields only appear for templates that actually use them.
- Fix WhatsApp media campaign delivery by generating publicly reachable upload URLs, validating media against Meta's approved header type, and rolling back local template changes when Meta rejects an update.
- Preserve carousel card-to-file mappings and reject browser-only blob URLs before sending templates to Meta.
- Hard delete staff/member users so deleted emails can be reused immediately.
- Send account credential emails when users or agents are created, while allowing deleted user emails to be reused safely.
- Capture WhatsApp campaign failure details from Meta status webhooks and store them on campaign recipients, campaign error logs, and message metadata.
