const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const START_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_TIME_RE = /^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;
const MAX_RANGES_PER_DAY = 6;

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
  if (payload.name.trim().length > 100) return 'Shift name cannot exceed 100 characters';
  if (!isValidTimezone(payload.timezone || 'Asia/Qatar')) return 'Invalid timezone';

  const weeklyRanges = [];
  for (const [dayIndex, day] of DAYS.entries()) {
    const config = payload[day];
    if (!config) continue;
    if (!Array.isArray(config.ranges)) return `${day} ranges must be an array`;
    if (config.enabled && config.ranges.length === 0) return `${day} must contain at least one time range`;
    if (config.ranges.length > MAX_RANGES_PER_DAY) return `${day} cannot contain more than ${MAX_RANGES_PER_DAY} time ranges`;
    for (const range of config.ranges) {
      if (!START_TIME_RE.test(range?.start || '') || !END_TIME_RE.test(range?.end || '')) return `${day} contains an invalid time`;
      if (range.start === range.end) return `${day} range cannot start and end at the same time`;
      const start = dayIndex * MINUTES_PER_DAY + minutes(range.start);
      let end = dayIndex * MINUTES_PER_DAY + minutes(range.end);
      if (end <= start) end += MINUTES_PER_DAY;
      weeklyRanges.push({ day, start, end });
    }
  }

  const comparable = [...weeklyRanges, ...weeklyRanges.map((range) => ({ ...range, start: range.start + MINUTES_PER_WEEK, end: range.end + MINUTES_PER_WEEK }))]
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < comparable.length; i++) {
    if (comparable[i].start < comparable[i - 1].end && comparable[i].start < MINUTES_PER_WEEK * 2) {
      return `${comparable[i].day} contains an overlapping time range`;
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
