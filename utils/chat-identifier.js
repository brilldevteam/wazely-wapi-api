/**
 * The number a chat is stored under for a contact. QR (Baileys) contacts can be
 * known only by their WhatsApp LID (no phone_number); their messages and
 * assignments use that LID. Other channels use their platform id.
 */
export const getChatIdentifier = (contact) =>
  contact?.phone_number ||
  contact?.whatsapp_lid ||
  contact?.metadata?.whatsapp_lid ||
  contact?.facebook_page_scoped_id ||
  contact?.instagram_scoped_id ||
  contact?.telegram_chat_id ||
  contact?.twitter_user_id ||
  null;
