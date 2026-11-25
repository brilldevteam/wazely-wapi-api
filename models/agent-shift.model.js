import mongoose from 'mongoose';

const timeRangeSchema = new mongoose.Schema({
  start: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  end: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ }
}, { _id: false });

const daySchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  ranges: { type: [timeRangeSchema], default: [] }
}, { _id: false });

const agentShiftSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  timezone: { type: String, required: true, default: 'Asia/Qatar' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  monday: { type: daySchema, default: () => ({}) },
  tuesday: { type: daySchema, default: () => ({}) },
  wednesday: { type: daySchema, default: () => ({}) },
  thursday: { type: daySchema, default: () => ({}) },
  friday: { type: daySchema, default: () => ({}) },
  saturday: { type: daySchema, default: () => ({}) },
  sunday: { type: daySchema, default: () => ({}) },
  deleted_at: { type: Date, default: null, index: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'agent_shifts'
});

agentShiftSchema.index({ user_id: 1, name: 1, deleted_at: 1 });

export default mongoose.model('AgentShift', agentShiftSchema);
