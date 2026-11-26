import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AgentShift, ChatAssignment, Role, User } from '../models/index.js';
import { autoAssignChat } from '../utils/agent-assignment.service.js';
import { trackSocketConnect } from '../utils/agent-presence.js';

const allDays = (ranges, status = 'active') => ({
  name: `${status}-${Math.random()}`,
  timezone: 'UTC',
  status,
  monday: { enabled: true, ranges },
  tuesday: { enabled: true, ranges },
  wednesday: { enabled: true, ranges },
  thursday: { enabled: true, ranges },
  friday: { enabled: true, ranges },
  saturday: { enabled: true, ranges },
  sunday: { enabled: true, ranges }
});

test('real assignment service preserves round-robin and shift eligibility', async () => {
  const databaseName = `wapi_assignment_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    const role = await Role.create({ name: 'agent' });
    const owner = await User.create({ name: 'Owner', email: 'owner@test.local', status: true });
    const agents = [];
    for (let index = 0; index < 5; index++) {
      const agent = await User.create({
        name: `Agent ${index + 1}`,
        email: `agent${index + 1}@test.local`,
        role_id: role._id,
        created_by: owner._id,
        status: true,
        availability_status: 'available'
      });
      agents.push(agent);
      trackSocketConnect({ id: `socket-${index}`, data: { auth: { userId: String(agent._id), ownerId: String(owner._id) } } });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    for (let index = 0; index < 11; index++) {
      const result = await autoAssignChat({
        ownerId: owner._id,
        senderNumber: `customer-${index}`,
        recipientNumber: 'business',
        whatsappPhoneNumberId: 'test-phone',
        allowQueue: false
      });
      assert.equal(result.assigned, true);
    }

    const counts = await ChatAssignment.aggregate([
      { $group: { _id: '$agent_id', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } }
    ]);
    assert.deepEqual(counts.map((row) => row.count).sort((a, b) => b - a), [3, 2, 2, 2, 2]);

    const allDay = await AgentShift.create({ ...allDays([{ start: '00:00', end: '24:00' }]), user_id: owner._id });
    const offShift = await AgentShift.create({ ...allDays([{ start: '01:00', end: '01:01' }]), user_id: owner._id });
    const inactive = await AgentShift.create({ ...allDays([{ start: '00:00', end: '24:00' }], 'inactive'), user_id: owner._id });
    await User.findByIdAndUpdate(agents[0]._id, { shift_id: allDay._id });
    await User.findByIdAndUpdate(agents[1]._id, { shift_id: offShift._id });
    await User.findByIdAndUpdate(agents[2]._id, { shift_id: inactive._id });
    await User.findByIdAndUpdate(agents[3]._id, { availability_status: 'away' });
    await User.findByIdAndUpdate(agents[4]._id, { status: false });
    await User.findByIdAndUpdate(owner._id, { round_robin_last_agent_id: null });

    const eligible = await autoAssignChat({
      ownerId: owner._id,
      senderNumber: 'shift-customer',
      recipientNumber: 'business',
      whatsappPhoneNumberId: 'test-phone',
      allowQueue: false
    });
    assert.equal(eligible.assigned, true);
    assert.equal(eligible.agentId, String(agents[0]._id));
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
