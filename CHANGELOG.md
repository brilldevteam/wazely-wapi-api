# Changelog

## Wazely CRM rollout updates - 2026-11-26

### Agent shifts and automatic chat assignment
- Add reusable agent shifts per business (`/api/agent-shifts`): IANA timezone, working days, up to 6 time ranges per day, overnight ranges and all-day `00:00–24:00`, and an active/inactive status. Overlapping ranges (including overnight and Saturday→Sunday wrap) are rejected; a shift still assigned to agents cannot be deleted. Agents can be given a shift (`shift_id`); an inactive shift pauses automatic assignment for its agents.
- Rebuild automatic assignment as one shared service used by the flow "Assign Available Agent" and "Assign Agent" steps, keyword-bot "assign agent" replies and the WhatsApp Sequential assignment setting. A chat only goes to an agent who is active, online, set to Available, inside their shift (or has no shift) and below the optional open-chat limit; distribution is round-robin or least open chats; an open chat stays with its agent.
- Add a persistent waiting queue: when no agent is eligible the chat waits (oldest first per assignment rule, no expiry) and is handed out when an agent comes online, switches to Available, starts their shift or frees a slot, after settings change, and by a 1-minute safety sweep. Chats leave the queue when assigned by hand, resolved, taken by a chatbot/AI Agent, or their contact is deleted. On start-up the old 6-hour queue expiry index is removed.
- Track who is online from the authenticated socket (30-second grace for refreshes, immediate offline on logout, reset on restart) and add `GET/PUT /auth/availability` for the Available/Away status.
- Fix the WhatsApp "Sequential assignment" setting, which queried non-existent fields and never assigned anyone; it now runs on every incoming message. Add `assignment_strategy` and `max_open_chats_per_agent` settings.
- Scope team assignment to the business owner, active teams and agent-role users; include the business owner in "All agents" rotation only when explicitly enabled.
- Emit `chat:assigned`, `agent:presence` and `chat:queue-updated` socket events so agents get an instant "New chat assigned" alert and lists update live.

### Chats, agents and security
- Scope chat resolve/reopen to the business's phone and chat (it could previously affect the same customer in another business); assigning a resolved chat reopens it.
- Stop returning password hashes and reset tokens in the Agents list; return live online state and shift instead.
- Keep an agent's team and shift unless they are actually changed when editing; reject malformed team and shift IDs with 400.
- Return clear 400/404 JSON errors for invalid or missing shift IDs and invalid shift data.
- End the server session on logout and close that login's sockets.
- Deliver live socket events only to the business they belong to and require an active session on socket connect; send QR connection status updates to their owner.
- Stop agent tasks leaking across customer accounts.
- QR (Baileys) chats: fix the empty WA Chat list, scope it to the account, and allow opening, replying to and assigning chats for contacts known only by their WhatsApp LID; always send location name/address.

### Other
- Update currency exchange rates automatically every day (live rates with the admin rate as fallback), fix conversion for QAR and other unsupported currencies, and add new currencies to the end of the list.
- Brand the SMTP test email as "Wazely CRM".
- Hide WhatsApp encryption session dumps from the API logs.

## WAPI v3.3 custom upgrade - 2026-10-03

- Upgrade the API to the WAPI v3.3 vendor release (social media connections and scheduled publishing, Mollie payments, campaign recovery, WhatsApp status sync, campaign batch stats and resume handling).
- Keep all custom behavior; in campaign creation keep the forwarded-host base URL and `/uploads/campaigns` media links alongside the new v3.3 batch stats, and keep resumed campaigns saving `is_paused = false` before restarting with the new resume option.
- Add the new v3.3 runtime dependencies (`@mollie/api-client`, `oauth`).
- Send WhatsApp messages to a contact's phone number when one is known, using the business-scoped user ID (BSUID) or username only for phone-less contacts; Meta rejects template sends addressed to a BSUID with error #131000.

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
