const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isValidTimezone = (timezone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const minutes = (value) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

export const validateShiftSchedule = (payload) => {
  if (!payload?.name?.trim()) return 'Shift name is required';
  if (!isValidTimezone(payload.timezone || 'Asia/Qatar')) return 'Invalid timezone';

  for (const day of DAYS) {
    const config = payload[day];
    if (!config) continue;
    if (!Array.isArray(config.ranges)) return `${day} ranges must be an array`;
    const normalRanges = [];
    for (const range of config.ranges) {
      if (!TIME_RE.test(range?.start || '') || !TIME_RE.test(range?.end || '')) return `${day} contains an invalid time`;
      if (range.start === range.end) return `${day} range cannot start and end at the same time`;
      if (minutes(range.start) < minutes(range.end)) normalRanges.push([minutes(range.start), minutes(range.end)]);
    }
    normalRanges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < normalRanges.length; i++) {
      if (normalRanges[i][0] < normalRanges[i - 1][1]) return `${day} contains overlapping time ranges`;
    }
  }
  return null;
};

const zonedParts = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { day: get('weekday').toLowerCase(), minute: Number(get('hour')) * 60 + Number(get('minute')) };
};

export const isInsideShift = (shift, at = new Date()) => {
  if (!shift) return true;
  if (shift.status !== 'active' || shift.deleted_at) return false;
  const timezone = shift.timezone || 'Asia/Qatar';
  if (!isValidTimezone(timezone)) return false;
  const { day, minute } = zonedParts(at, timezone);
  const dayIndex = DAYS.indexOf(day);
  const previousDay = DAYS[(dayIndex + 6) % 7];

  const todayRanges = shift[day]?.enabled ? shift[day].ranges || [] : [];
  if (todayRanges.some((range) => {
    const start = minutes(range.start);
    const end = minutes(range.end);
    return start < end && minute >= start && minute < end || start > end && minute >= start;
  })) return true;

  const previousRanges = shift[previousDay]?.enabled ? shift[previousDay].ranges || [] : [];
  return previousRanges.some((range) => {
    const start = minutes(range.start);
    const end = minutes(range.end);
    return start > end && minute < end;
  });
};

export const getShiftState = (shift, at = new Date()) => ({
  hasShift: !!shift,
  isInsideShift: isInsideShift(shift, at)
});

export { DAYS as SHIFT_DAYS };
