import mongoose from 'mongoose';
import { END_TIME_RE, START_TIME_RE } from '../utils/agent-shift.js';

const timeRangeSchema = new mongoose.Schema({
  start: { type: String, required: true, match: START_TIME_RE },
  end: { type: String, required: true, match: END_TIME_RE }
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
