import mongoose from 'mongoose';
import { User, Team, Role, ChatAssignment, Contact, WhatsappPhoneNumber } from '../models/index.js';
import { getChatIdentifier } from './chat-identifier.js';
import { getIO, isUserOnline } from './agent-presence.js';

/**
 * Automatic chat assignment, shared by the automation "Assign Random Agent" step
 * and the WhatsApp "Round robin assignment" setting.
 *
 *  1. Sticky: a chat that already has an agent (open, not resolved) keeps that
 *     agent. New messages never move it to someone else.
 *  2. Only agents who are online (have the CRM open) and set to Available can
 *     be picked. Agents take turns (round-robin) in a fixed order.
 *  3. If nobody is available the chat stays unassigned (owner sees it in
 *     "Unassigned") and the next message tries again.
 *
 * Chats are stored with the same keys as a manual assignment from the chat
 * screen (contact identifier + business display number + phone record id), so
 * the Assigned/Unassigned tabs and the agent's chat list see them the same way.
 */

export const CHAT_ASSIGNED_EVENT = 'chat:assigned';

const isActiveUser = (user) => !!user && user.status === true && !user.deleted_at;

/** Can take a new chat right now: active, online and not set to Away. */
export const isAgentAvailable = (user) =>
  isActiveUser(user) && user.availability_status !== 'away' && isUserOnline(user._id);

/** Next available user after `lastAgentId` in the fixed `candidates` order, or null. */
export const pickNextAvailableAgent = (candidates, lastAgentId) => {
  if (!candidates?.length) return null;
  const lastIndex = lastAgentId ? candidates.findIndex((c) => String(c._id) === String(lastAgentId)) : -1;
  for (let step = 1; step <= candidates.length; step++) {
    const candidate = candidates[(lastIndex + step + candidates.length) % candidates.length];
    if (isAgentAvailable(candidate)) return candidate;
  }
  return null;
};

const findContact = async ({ contactId, contact, ownerId, senderNumber }) => {
  if (contact?._id) return contact;
  if (contactId && mongoose.Types.ObjectId.isValid(String(contactId))) {
    const found = await Contact.findById(contactId).lean();
    if (found) return found;
  }
  if (senderNumber && ownerId) {
    return Contact.findOne({
      user_id: ownerId,
      deleted_at: null,
      $or: [{ phone_number: senderNumber }, { whatsapp_lid: senderNumber }, { 'metadata.whatsapp_lid': senderNumber }]
    }).lean();
  }
  return null;
};

const buildKeys = ({ contact, contactIdentifier, businessNumber, phoneId }) => ({
  contact,
  contactIdentifier,
  businessNumber,
  phoneId,
  chatMatch: {
    whatsapp_phone_number_id: phoneId,
    $or: [
      { sender_number: contactIdentifier, receiver_number: businessNumber },
      { sender_number: businessNumber, receiver_number: contactIdentifier }
    ]
  }
});

/**
 * The keys a chat's assignment is stored under, exactly like a manual assignment:
 *  - WhatsApp: contact identifier + the phone's display number + the phone record id.
 *  - Other channels (id is not a phone record): the channel id is used as both.
 *  - Last resort (contact unknown): the sender/recipient numbers of the message.
 */
export const resolveChatKeys = async ({ contactId, contact, whatsappPhoneNumberId, ownerId, senderNumber, recipientNumber }) => {
  const contactDoc = await findContact({ contactId, contact, ownerId, senderNumber });
  const contactIdentifier = getChatIdentifier(contactDoc) || null;
  const rawPhoneId = whatsappPhoneNumberId ? String(whatsappPhoneNumberId) : null;

  if (rawPhoneId && mongoose.Types.ObjectId.isValid(rawPhoneId)) {
    const phone = await WhatsappPhoneNumber.findById(rawPhoneId).lean();
    if (phone && contactIdentifier) {
      return buildKeys({ contact: contactDoc, contactIdentifier, businessNumber: phone.display_phone_number || rawPhoneId, phoneId: rawPhoneId });
    }
  } else if (rawPhoneId && contactIdentifier) {
    return buildKeys({ contact: contactDoc, contactIdentifier, businessNumber: rawPhoneId, phoneId: rawPhoneId });
  }

  if (senderNumber && recipientNumber) {
    return buildKeys({
      contact: contactDoc,
      contactIdentifier: String(senderNumber),
      businessNumber: String(recipientNumber),
      phoneId: rawPhoneId || String(recipientNumber)
    });
  }
  return null;
};

/** The agent (or bot) currently handling this chat, or null if it is free to assign. */
const findCurrentHandler = async (chatMatch) => {
  const assignment = await ChatAssignment.findOne({ ...chatMatch, status: 'assigned', is_solved: false })
    .sort({ updated_at: -1 })
    .lean();
  if (!assignment) return null;

  if (assignment.agent_id) {
    const agent = await User.findById(assignment.agent_id).select('status deleted_at').lean();
    // An agent who was deleted or switched off can't keep the chat.
    return isActiveUser(agent) ? { type: 'agent', id: String(assignment.agent_id) } : null;
  }

  const botActive = assignment.chatbot_id && (!assignment.chatbot_expires_at || new Date(assignment.chatbot_expires_at) > new Date());
  return botActive ? { type: 'chatbot', id: String(assignment.chatbot_id) } : null;
};

const loadCandidates = async ({ ownerId, teamId, includeOwner }) => {
  const fields = 'name status deleted_at availability_status created_at round_robin_last_agent_id';

  if (teamId) {
    if (!mongoose.Types.ObjectId.isValid(String(teamId))) return { candidates: [], tracker: null };
    const team = await Team.findOne({ _id: teamId, deleted_at: null }).lean();
    if (!team) return { candidates: [], tracker: null };
    const candidates = await User.find({ team_id: teamId, status: true, deleted_at: null })
      .select(fields)
      .sort({ created_at: 1, _id: 1 })
      .lean();
    return { candidates, tracker: { model: Team, id: team._id, lastAgentId: team.round_robin_last_agent_id } };
  }

  const owner = await User.findById(ownerId).select(fields).lean();
  if (!owner) return { candidates: [], tracker: null };

  const agentRole = await Role.findOne({ name: 'agent' }).select('_id').lean();
  const agents = agentRole
    ? await User.find({ created_by: ownerId, role_id: agentRole._id, status: true, deleted_at: null })
        .select(fields)
        .sort({ created_at: 1, _id: 1 })
        .lean()
    : [];

  const candidates = includeOwner && isActiveUser(owner) ? [owner, ...agents] : agents;
  return { candidates, tracker: { model: User, id: owner._id, lastAgentId: owner.round_robin_last_agent_id } };
};

/** Tells the owner's screens and the agents' screens that a chat was assigned. */
export const emitChatAssigned = ({ ownerId, agentId, contact, contactId, whatsappPhoneNumberId, source }) => {
  const io = getIO();
  if (!io || !ownerId || !agentId) return;
  io.emit(CHAT_ASSIGNED_EVENT, {
    user_id: String(ownerId),
    agent_id: String(agentId),
    contact_id: String(contact?._id || contactId || ''),
    contact_name: contact?.name || contact?.phone_number || '',
    whatsapp_phone_number_id: whatsappPhoneNumberId ? String(whatsappPhoneNumberId) : null,
    source
  });
};

/**
 * Assigns the chat to the next available agent unless it already has one.
 *
 * @returns {{ assigned: boolean, kept?: boolean, agentId: string|null, reason?: string }}
 */
export const autoAssignChat = async ({
  ownerId,
  contactId,
  contact,
  senderNumber,
  recipientNumber,
  whatsappPhoneNumberId,
  teamId = null,
  includeOwner = false,
  source = 'auto'
}) => {
  if (!ownerId) return { assigned: false, agentId: null, reason: 'no_owner' };

  const keys = await resolveChatKeys({ contactId, contact, whatsappPhoneNumberId, ownerId, senderNumber, recipientNumber });
  if (!keys) return { assigned: false, agentId: null, reason: 'chat_not_found' };

  const current = await findCurrentHandler(keys.chatMatch);
  if (current) {
    return { assigned: false, kept: true, agentId: current.type === 'agent' ? current.id : null, reason: `already_with_${current.type}` };
  }

  const { candidates, tracker } = await loadCandidates({ ownerId, teamId, includeOwner });
  if (!candidates.length) return { assigned: false, agentId: null, reason: 'no_agents' };

  const agent = pickNextAvailableAgent(candidates, tracker?.lastAgentId);
  if (!agent) return { assigned: false, agentId: null, reason: 'no_available_agent' };

  if (tracker) await tracker.model.updateOne({ _id: tracker.id }, { $set: { round_robin_last_agent_id: agent._id } });

  await writeAssignment({ keys, agentId: agent._id, ownerId });
  emitChatAssigned({ ownerId, agentId: agent._id, contact: keys.contact, whatsappPhoneNumberId: keys.phoneId, source });

  return { assigned: true, agentId: String(agent._id) };
};

/** Saves the assignment under the chat's keys (updates the existing record or creates one). */
const writeAssignment = async ({ keys, agentId, ownerId }) => {
  const existing = await ChatAssignment.findOne(keys.chatMatch).sort({ updated_at: -1 });
  if (existing) {
    existing.agent_id = agentId;
    existing.assigned_by = ownerId;
    existing.status = 'assigned';
    existing.is_solved = false;
    await existing.save();
    return existing;
  }
  return ChatAssignment.create({
    sender_number: keys.contactIdentifier,
    receiver_number: keys.businessNumber,
    agent_id: agentId,
    assigned_by: ownerId,
    whatsapp_phone_number_id: keys.phoneId,
    status: 'assigned',
    is_solved: false
  });
};

/**
 * Assigns the chat to one chosen agent (automation "Assign Agent" step).
 * This is an explicit instruction, so it applies even if someone else has the chat.
 *
 * @returns {{ assigned: boolean, agentId: string|null, reason?: string }}
 */
export const assignChatToSpecificAgent = async ({ ownerId, agentId, contactId, contact, senderNumber, recipientNumber, whatsappPhoneNumberId, source = 'automation' }) => {
  if (!ownerId || !agentId || !mongoose.Types.ObjectId.isValid(String(agentId))) {
    return { assigned: false, agentId: null, reason: 'invalid_agent' };
  }

  const agent = await User.findById(agentId).select('status deleted_at').lean();
  if (!isActiveUser(agent)) return { assigned: false, agentId: null, reason: 'agent_inactive' };

  const keys = await resolveChatKeys({ contactId, contact, whatsappPhoneNumberId, ownerId, senderNumber, recipientNumber });
  if (!keys) return { assigned: false, agentId: null, reason: 'chat_not_found' };

  const current = await findCurrentHandler(keys.chatMatch);
  if (current?.type === 'agent' && current.id === String(agentId)) {
    return { assigned: false, kept: true, agentId: String(agentId), reason: 'already_with_agent' };
  }

  await writeAssignment({ keys, agentId, ownerId });
  emitChatAssigned({ ownerId, agentId, contact: keys.contact, whatsappPhoneNumberId: keys.phoneId, source });
  return { assigned: true, agentId: String(agentId) };
};
