import mongoose from 'mongoose';

/**
 * Chats waiting for an agent.
 *
 * A chat is added when auto-assignment (the "Sequential assignment" setting or
 * a flow's "Assign Random Agent" step) finds nobody online and available. It is
 * handed out, oldest first, as soon as a matching agent becomes available, and
 * removed when it is assigned, resolved, assigned by hand, taken by automation,
 * or its contact is deleted. Waiting entries never expire silently.
 *
 * One entry per chat (owner + business phone + contact).
 */
const assignmentQueueSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contact_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', default: null },
  contact_identifier: { type: String, required: true },
  business_number: { type: String, required: true },
  whatsapp_phone_number_id: { type: String, required: true },
  // The rule that queued it: a team, or all agents (optionally including the owner).
  team_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  include_owner: { type: Boolean, default: false },
  source: { type: String, default: 'auto' },
  attempts: { type: Number, default: 0 },
  last_attempt_at: { type: Date, default: null },
  waiting_reason: { type: String, default: 'no_available_agent' }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'assignment_queue'
});

assignmentQueueSchema.index({ user_id: 1, whatsapp_phone_number_id: 1, contact_identifier: 1 }, { unique: true });
assignmentQueueSchema.index({ user_id: 1, created_at: 1 });
assignmentQueueSchema.index({ user_id: 1, team_id: 1, include_owner: 1, created_at: 1 });
assignmentQueueSchema.index({ contact_id: 1 });

export default mongoose.model('AssignmentQueue', assignmentQueueSchema);
