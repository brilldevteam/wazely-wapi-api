import test from 'node:test';
import assert from 'node:assert/strict';
import { isInsideShift, validateShiftSchedule } from '../utils/agent-shift.js';

const schedule = (changes = {}) => ({
  name: 'Night shift', timezone: 'Asia/Qatar', status: 'active', deleted_at: null,
  monday: { enabled: true, ranges: [{ start: '22:00', end: '06:00' }] },
  tuesday: { enabled: false, ranges: [] }, wednesday: { enabled: false, ranges: [] },
  thursday: { enabled: false, ranges: [] }, friday: { enabled: false, ranges: [] },
  saturday: { enabled: false, ranges: [] }, sunday: { enabled: false, ranges: [] }, ...changes
});

test('agents without a shift are always inside shift', () => assert.equal(isInsideShift(null), true));
test('overnight shift includes its opening evening', () => assert.equal(isInsideShift(schedule(), new Date('2026-11-23T20:00:00Z')), true));
test('overnight shift includes the following morning', () => assert.equal(isInsideShift(schedule(), new Date('2026-11-24T02:00:00Z')), true));
test('overnight shift excludes the following daytime', () => assert.equal(isInsideShift(schedule(), new Date('2026-11-24T10:00:00Z')), false));
test('inactive shift is never eligible', () => assert.equal(isInsideShift(schedule({ status: 'inactive' })), false));
test('invalid timezone is rejected', () => assert.match(validateShiftSchedule(schedule({ timezone: 'Not/AZone' })), /timezone/i));
test('same start and end time is rejected', () => assert.match(validateShiftSchedule(schedule({ monday: { enabled: true, ranges: [{ start: '09:00', end: '09:00' }] } })), /same time/i));
test('overlapping daytime ranges are rejected', () => assert.match(validateShiftSchedule(schedule({ monday: { enabled: true, ranges: [{ start: '09:00', end: '13:00' }, { start: '12:00', end: '17:00' }] } })), /overlapping/i));
