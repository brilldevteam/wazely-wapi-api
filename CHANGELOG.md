# Changelog

## Unreleased

- Fix WhatsApp media campaign delivery by generating publicly reachable upload URLs, validating media against Meta's approved header type, and rolling back local template changes when Meta rejects an update.
- Hard delete staff/member users so deleted emails can be reused immediately.
- Send account credential emails when users or agents are created, while allowing deleted user emails to be reused safely.
- Capture WhatsApp campaign failure details from Meta status webhooks and store them on campaign recipients, campaign error logs, and message metadata.
