import mongoose from 'mongoose';
import { User, Team, Role, ChatAssignment, Contact, WhatsappPhoneNumber, WabaConfiguration, AssignmentQueue } from '../models/index.js';
import { getChatIdentifier } from './chat-identifier.js';
import { getIO, isUserOnline } from './agent-presence.js';

/**
 * Automatic chat assignment, shared by the automation "Assign Random Agent" step
 * and the WhatsApp "Sequential assignment" (round robin) setting.
 *
 *  1. Sticky: a chat that already has an agent (open, not resolved) keeps that
 *     agent. New messages never move it to someone else.
 *  2. Only agents who are online (have the CRM open) and set to Available can
 *     be picked, and (optional) only agents below the "max open chats" limit.
 *     Agents take turns (round-robin) in a fixed order.
 *  3. Nobody available: the chat waits in the assignment queue and is handed
 *     out, oldest first, as soon as a matching agent becomes available (comes
 *     online, switches to Available, or frees a slot). After the waiting time it
 *     is left in "Unassigned" for manual assignment.
 *
 * All assignment work for one business runs one at a time (per-owner lock), so
 * two triggers at the same moment can never give one chat to two agents.
 *
 * Chats are stored with the same keys as a manual assignment from the chat
 * screen (contact identifier + business display number + phone record id), so
 * the Assigned/Unassigned tabs and the agent's chat list see them the same way.
 */

export const CHAT_ASSIGNED_EVENT = 'chat:assigned';
export const QUEUE_UPDATED_EVENT = 'chat:queue-updated';

export const DEFAULT_ASSIGNMENT_SETTINGS = Object.freeze({ queueEnabled: true, waitHours: 6, maxOpenChats: 0 });
const WAITING_REASONS = ['no_available_agent', 'agents_at_limit'];
const QUEUE_BATCH_SIZE = 500;

const isActiveUser = (user) => !!user && user.status === true && !user.deleted_at;

/** Can take a new chat right now: active, online and not set to Away. */
export const isAgentAvailable = (user) =>
  isActiveUser(user) && user.availability_status !== 'away' && isUserOnline(user._id);

/**
 * Next user after `lastAgentId` (in the fixed `candidates` order) who is available
 * and, when `maxOpenChats` > 0, has fewer open chats than the limit.
 *
 * @returns {{ agent: object|null, atLimit: boolean }} atLimit = someone was available but full.
 */
export const pickNextAvailableAgent = (candidates, lastAgentId, { openCounts = null, maxOpenChats = 0 } = {}) => {
  if (!candidates?.length) return { agent: null, atLimit: false };
  const lastIndex = lastAgentId ? candidates.findIndex((c) => String(c._id) === String(lastAgentId)) : -1;
  let atLimit = false;
  for (let step = 1; step <= candidates.length; step++) {
    const candidate = candidates[(lastIndex + step + candidates.length) % candidates.length];
    if (!isAgentAvailable(candidate)) continue;
    if (maxOpenChats > 0 && (openCounts?.get(String(candidate._id)) || 0) >= maxOpenChats) {
      atLimit = true;
      continue;
    }
    return { agent: candidate, atLimit: false };
  }
  return { agent: null, atLimit };
};

// ---------------------------------------------------------------------------
// One-at-a-time per business
// ---------------------------------------------------------------------------

const ownerLocks = new Map();

const withOwnerLock = (ownerId, task) => {
  const key = String(ownerId);
  const previous = ownerLocks.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => {});
  ownerLocks.set(key, settled);
  settled.then(() => {
    if (ownerLocks.get(key) === settled) ownerLocks.delete(key);
  });
  return run;
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** The business's assignment rules for this phone (defaults for non-WhatsApp channels). */
export const getAssignmentSettings = async (whatsappPhoneNumberId) => {
  const id = whatsappPhoneNumberId ? String(whatsappPhoneNumberId) : null;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return { ...DEFAULT_ASSIGNMENT_SETTINGS };

  const phone = await WhatsappPhoneNumber.findById(id).select('waba_id').lean();
  const config = phone?.waba_id ? await WabaConfiguration.findOne({ waba_id: phone.waba_id }).lean() : null;
  if (!config) return { ...DEFAULT_ASSIGNMENT_SETTINGS };

  return {
    queueEnabled: config.assignment_queue_enabled !== false,
    waitHours: clampInt(config.assignment_wait_hours, 1, 168, DEFAULT_ASSIGNMENT_SETTINGS.waitHours),
    maxOpenChats: clampInt(config.max_open_chats_per_agent, 0, 1000, 0)
  };
};

// ---------------------------------------------------------------------------
// Finding the chat
// ---------------------------------------------------------------------------

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
const findCurrentHandler = async (chatMatch, contact = null) => {
  const assignment = await ChatAssignment.findOne({ ...chatMatch, status: 'assigned', is_solved: false })
    .sort({ updated_at: -1 })
    .lean();

  // An AI Agent set on the contact (and not paused) is handling the chat.
  const aiAgentActive = !!contact?.assigned_chatbot && !contact?.chatbot_paused;

  if (!assignment) return aiAgentActive ? { type: 'chatbot', id: String(contact.assigned_chatbot) } : null;

  if (assignment.agent_id) {
    const agent = await User.findById(assignment.agent_id).select('status deleted_at').lean();
    // An agent who was deleted or switched off can't keep the chat.
    return isActiveUser(agent) ? { type: 'agent', id: String(assignment.agent_id) } : null;
  }

  const botActive = assignment.chatbot_id && (!assignment.chatbot_expires_at || new Date(assignment.chatbot_expires_at) > new Date());
  if (botActive) return { type: 'chatbot', id: String(assignment.chatbot_id) };
  return aiAgentActive ? { type: 'chatbot', id: String(contact.assigned_chatbot) } : null;
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

/** Open (assigned, not resolved) chats per user. */
const countOpenChats = async (userIds) => {
  const ids = userIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const rows = await ChatAssignment.aggregate([
    { $match: { agent_id: { $in: ids }, status: 'assigned', is_solved: false } },
    { $group: { _id: '$agent_id', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

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

/** A chat started or stopped waiting: the owner's chat list refreshes its "Waiting" labels. */
const emitQueueUpdated = (ownerId) => {
  const io = getIO();
  if (!io || !ownerId) return;
  io.emit(QUEUE_UPDATED_EVENT, { user_id: String(ownerId) });
};

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

const queueKeyFilter = (ownerId, keys) => ({
  user_id: ownerId,
  whatsapp_phone_number_id: keys.phoneId,
  contact_identifier: keys.contactIdentifier
});

const enqueueChat = async ({ ownerId, keys, teamId, includeOwner, source, waitHours }) => {
  try {
    const result = await AssignmentQueue.updateOne(
      queueKeyFilter(ownerId, keys),
      {
        // The newest rule wins; the waiting clock starts at the first time it was queued.
        $set: {
          contact_id: keys.contact?._id || null,
          business_number: keys.businessNumber,
          team_id: teamId || null,
          include_owner: !!includeOwner,
          source
        },
        $setOnInsert: { expires_at: new Date(Date.now() + waitHours * 60 * 60 * 1000) }
      },
      { upsert: true }
    );
    if (result.upsertedCount) emitQueueUpdated(ownerId);
    return true;
  } catch (error) {
    if (error?.code === 11000) return true; // already waiting
    throw error;
  }
};

const dequeueChat = async (ownerId, keys) => {
  const result = await AssignmentQueue.deleteOne(queueKeyFilter(ownerId, keys));
  if (result.deletedCount) emitQueueUpdated(ownerId);
};

/**
 * Takes a chat out of the queue (assigned by hand, resolved, given to a chatbot...).
 * Matches by contact (and phone when given).
 */
export const removeChatFromQueue = async ({ ownerId, contactId, whatsappPhoneNumberId = null }) => {
  if (!ownerId || !contactId || !mongoose.Types.ObjectId.isValid(String(contactId))) return 0;
  const filter = { user_id: ownerId, contact_id: contactId };
  if (whatsappPhoneNumberId) filter.whatsapp_phone_number_id = String(whatsappPhoneNumberId);
  const result = await AssignmentQueue.deleteMany(filter);
  if (result.deletedCount) emitQueueUpdated(ownerId);
  return result.deletedCount;
};

/** Waiting-since time per contact id, for the chat list "Waiting" label. */
export const getWaitingSinceByContact = async (ownerId, contactIds) => {
  const ids = (contactIds || []).filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
  if (!ownerId || !ids.length) return new Map();
  const entries = await AssignmentQueue.find({ user_id: ownerId, contact_id: { $in: ids }, expires_at: { $gt: new Date() } })
    .select('contact_id created_at')
    .lean();
  return new Map(entries.map((e) => [String(e.contact_id), e.created_at]));
};

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

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

/** The assignment itself. Callers must hold the owner lock. */
const assignChatCore = async ({
  ownerId,
  contactId,
  contact,
  senderNumber,
  recipientNumber,
  whatsappPhoneNumberId,
  teamId = null,
  includeOwner = false,
  source = 'auto',
  allowQueue = true,
  queuedAt = null
}) => {
  if (!ownerId) return { assigned: false, agentId: null, reason: 'no_owner' };

  const keys = await resolveChatKeys({ contactId, contact, whatsappPhoneNumberId, ownerId, senderNumber, recipientNumber });
  if (!keys) return { assigned: false, agentId: null, reason: 'chat_not_found' };

  if (queuedAt) {
    // Handing out a waiting chat: skip it if the contact was deleted or the chat
    // was resolved after it started waiting.
    if (contactId && (!keys.contact || keys.contact.deleted_at)) return { assigned: false, agentId: null, reason: 'contact_deleted' };
    const resolvedSince = await ChatAssignment.exists({ ...keys.chatMatch, is_solved: true, updated_at: { $gte: queuedAt } });
    if (resolvedSince) return { assigned: false, agentId: null, reason: 'resolved' };
  }

  const current = await findCurrentHandler(keys.chatMatch, keys.contact);
  if (current) {
    await dequeueChat(ownerId, keys);
    return { assigned: false, kept: true, agentId: current.type === 'agent' ? current.id : null, reason: `already_with_${current.type}` };
  }

  const settings = await getAssignmentSettings(keys.phoneId);
  const { candidates, tracker } = await loadCandidates({ ownerId, teamId, includeOwner });
  if (!candidates.length) return { assigned: false, agentId: null, reason: 'no_agents' };

  const openCounts = settings.maxOpenChats > 0 ? await countOpenChats(candidates.map((c) => c._id)) : null;
  const { agent, atLimit } = pickNextAvailableAgent(candidates, tracker?.lastAgentId, { openCounts, maxOpenChats: settings.maxOpenChats });

  if (!agent) {
    const reason = atLimit ? 'agents_at_limit' : 'no_available_agent';
    const queued = allowQueue && settings.queueEnabled
      ? await enqueueChat({ ownerId, keys, teamId, includeOwner, source, waitHours: settings.waitHours })
      : false;
    return { assigned: false, agentId: null, reason, queued };
  }

  if (tracker) await tracker.model.updateOne({ _id: tracker.id }, { $set: { round_robin_last_agent_id: agent._id } });

  await writeAssignment({ keys, agentId: agent._id, ownerId });
  await dequeueChat(ownerId, keys);
  emitChatAssigned({ ownerId, agentId: agent._id, contact: keys.contact, whatsappPhoneNumberId: keys.phoneId, source });

  return { assigned: true, agentId: String(agent._id) };
};

/**
 * Assigns the chat to the next available agent unless it already has one.
 * If nobody is available it waits in the queue (when the business allows it).
 *
 * @returns {{ assigned: boolean, kept?: boolean, queued?: boolean, agentId: string|null, reason?: string }}
 */
export const autoAssignChat = (params) => {
  if (!params?.ownerId) return Promise.resolve({ assigned: false, agentId: null, reason: 'no_owner' });
  return withOwnerLock(params.ownerId, () => assignChatCore({ ...params, allowQueue: params.allowQueue !== false }));
};

/** Hands out one business's waiting chats, oldest first. Caller holds the owner lock. */
const drainOwnerQueue = async (ownerId) => {
  const entries = await AssignmentQueue.find({ user_id: ownerId, expires_at: { $gt: new Date() } })
    .sort({ created_at: 1, _id: 1 })
    .limit(QUEUE_BATCH_SIZE)
    .lean();

  const blockedRules = new Set();
  let assigned = 0;

  for (const entry of entries) {
    const ruleKey = entry.team_id ? `team:${entry.team_id}` : `all:${entry.include_owner}`;
    if (blockedRules.has(ruleKey)) continue;

    let result;
    try {
      result = await assignChatCore({
        ownerId,
        contactId: entry.contact_id,
        senderNumber: entry.contact_identifier,
        recipientNumber: entry.business_number,
        whatsappPhoneNumberId: entry.whatsapp_phone_number_id,
        teamId: entry.team_id,
        includeOwner: entry.include_owner,
        source: 'queue',
        allowQueue: false,
        queuedAt: entry.created_at
      });
    } catch (error) {
      console.error(`[assignment-queue] Could not process waiting chat ${entry._id}:`, error.message);
      continue;
    }

    if (result.assigned) {
      assigned++;
    } else if (WAITING_REASONS.includes(result.reason)) {
      // Nobody free for this rule right now: later chats with the same rule can't be served either.
      blockedRules.add(ruleKey);
      await AssignmentQueue.updateOne({ _id: entry._id }, { $inc: { attempts: 1 }, $set: { last_attempt_at: new Date() } });
    } else if (!result.kept) {
      // Chat gone, resolved, contact deleted or the team has no agents: stop waiting.
      const removed = await AssignmentQueue.deleteOne({ _id: entry._id });
      if (removed.deletedCount) emitQueueUpdated(ownerId);
    }
  }

  return assigned;
};

/**
 * Hands out waiting chats. With an ownerId only that business; without, every
 * business that has waiting chats (the 1-minute safety sweep).
 *
 * @returns {Promise<number>} chats assigned
 */
export const processAssignmentQueue = async ({ ownerId = null } = {}) => {
  const owners = ownerId
    ? [String(ownerId)]
    : (await AssignmentQueue.distinct('user_id', { expires_at: { $gt: new Date() } })).map(String);

  let assigned = 0;
  for (const owner of owners) {
    try {
      assigned += await withOwnerLock(owner, () => drainOwnerQueue(owner));
    } catch (error) {
      console.error(`[assignment-queue] Failed for business ${owner}:`, error.message);
    }
  }
  if (assigned) console.log(`[assignment-queue] Assigned ${assigned} waiting chat(s)`);
  return assigned;
};

/**
 * Assigns the chat to one chosen agent (automation "Assign Agent" step, bot reply).
 * This is an explicit instruction, so it applies even if someone else has the chat
 * and ignores availability and the open-chat limit.
 *
 * @returns {{ assigned: boolean, agentId: string|null, reason?: string }}
 */
export const assignChatToSpecificAgent = ({ ownerId, agentId, contactId, contact, senderNumber, recipientNumber, whatsappPhoneNumberId, source = 'automation' }) => {
  if (!ownerId || !agentId || !mongoose.Types.ObjectId.isValid(String(agentId))) {
    return Promise.resolve({ assigned: false, agentId: null, reason: 'invalid_agent' });
  }

  return withOwnerLock(ownerId, async () => {
    const agent = await User.findById(agentId).select('status deleted_at').lean();
    if (!isActiveUser(agent)) return { assigned: false, agentId: null, reason: 'agent_inactive' };

    const keys = await resolveChatKeys({ contactId, contact, whatsappPhoneNumberId, ownerId, senderNumber, recipientNumber });
    if (!keys) return { assigned: false, agentId: null, reason: 'chat_not_found' };

    const current = await findCurrentHandler(keys.chatMatch);
    if (current?.type === 'agent' && current.id === String(agentId)) {
      await dequeueChat(ownerId, keys);
      return { assigned: false, kept: true, agentId: String(agentId), reason: 'already_with_agent' };
    }

    await writeAssignment({ keys, agentId, ownerId });
    await dequeueChat(ownerId, keys);
    emitChatAssigned({ ownerId, agentId, contact: keys.contact, whatsappPhoneNumberId: keys.phoneId, source });
    return { assigned: true, agentId: String(agentId) };
  });
};
