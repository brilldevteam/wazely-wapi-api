import mongoose from 'mongoose';
import { AgentShift, User } from '../models/index.js';
import { SHIFT_DAYS, validateShiftSchedule } from '../utils/agent-shift.js';

const ownerId = (req) => req.user?.owner_id || req.user?._id || req.user?.id;
const invalidId = (id) => !mongoose.Types.ObjectId.isValid(String(id || ''));
const shiftError = (res, error) => {
  const isValidation = error?.name === 'ValidationError' || error?.name === 'CastError';
  if (isValidation) console.warn('[agent-shift] Invalid shift data:', error.message);
  else console.error('[agent-shift] Request failed:', error);
  return res.status(isValidation ? 400 : 500).json({ success: false, message: isValidation ? 'Invalid shift data' : 'Could not process shift request' });
};
const cleanPayload = (body) => {
  const payload = {
    name: body.name?.trim(),
    timezone: body.timezone || 'Asia/Qatar',
    status: body.status === 'inactive' ? 'inactive' : 'active'
  };
  for (const day of SHIFT_DAYS) {
    const input = body[day] || {};
    payload[day] = { enabled: !!input.enabled, ranges: input.enabled && Array.isArray(input.ranges) ? input.ranges.map(({ start, end }) => ({ start, end })) : [] };
  }
  return payload;
};

export const listShifts = async (req, res) => {
  try {
    const shifts = await AgentShift.find({ user_id: ownerId(req), deleted_at: null }).sort({ name: 1 }).lean();
    const counts = await User.aggregate([
      { $match: { created_by: new mongoose.Types.ObjectId(String(ownerId(req))), deleted_at: null, shift_id: { $ne: null } } },
      { $group: { _id: '$shift_id', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map((row) => [String(row._id), row.count]));
    return res.json({ success: true, data: shifts.map((shift) => ({ ...shift, assigned_agents: countMap.get(String(shift._id)) || 0 })) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getShift = async (req, res) => {
  if (invalidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid shift ID' });
  try {
    const shift = await AgentShift.findOne({ _id: req.params.id, user_id: ownerId(req), deleted_at: null }).lean();
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });
    return res.json({ success: true, data: shift });
  } catch (error) { return shiftError(res, error); }
};

export const createShift = async (req, res) => {
  try {
    const payload = cleanPayload(req.body || {});
    const validationError = validateShiftSchedule(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const shift = await AgentShift.create({ ...payload, user_id: ownerId(req) });
    return res.status(201).json({ success: true, message: 'Shift created successfully', data: shift });
  } catch (error) {
    return shiftError(res, error);
  }
};

export const updateShift = async (req, res) => {
  if (invalidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid shift ID' });
  try {
    const payload = cleanPayload(req.body || {});
    const validationError = validateShiftSchedule(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const shift = await AgentShift.findOneAndUpdate({ _id: req.params.id, user_id: ownerId(req), deleted_at: null }, { $set: payload }, { returnDocument: 'after', runValidators: true });
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });
    return res.json({ success: true, message: 'Shift updated successfully', data: shift });
  } catch (error) {
    return shiftError(res, error);
  }
};

export const deleteShift = async (req, res) => {
  if (invalidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid shift ID' });
  try {
    const filter = { _id: req.params.id, user_id: ownerId(req), deleted_at: null };
    const shift = await AgentShift.findOne(filter);
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });
    const assignedAgents = await User.countDocuments({ created_by: ownerId(req), shift_id: shift._id, deleted_at: null });
    if (assignedAgents) return res.status(409).json({ success: false, message: `This shift is assigned to ${assignedAgents} agent(s). Reassign them before deleting it.` });
    shift.deleted_at = new Date();
    await shift.save();
    return res.json({ success: true, message: 'Shift deleted successfully' });
  } catch (error) { return shiftError(res, error); }
};

export default { listShifts, getShift, createShift, updateShift, deleteShift };
