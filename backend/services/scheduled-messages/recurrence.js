import { Cron } from 'croner';

function createCron(cron, timezone) {
  return new Cron(cron, { timezone: timezone || 'Europe/Moscow', mode: '5-part' });
}

export function nextRun(cron, timezone, from = new Date()) {
  const job = createCron(cron, timezone);
  try {
    return job.nextRun(from);
  } finally {
    job.stop();
  }
}

export function validateCron(cron) {
  if (typeof cron !== 'string' || cron.trim().split(/\s+/).length !== 5) return false;
  try {
    return nextRun(cron, 'Europe/Moscow') !== null;
  } catch {
    return false;
  }
}

export function minIntervalMinutes(cron, timezone) {
  const job = createCron(cron, timezone);
  try {
    const runs = job.nextRuns(2, new Date());
    if (runs.length < 2) throw new Error('Cron expression has no two future runs');
    return (runs[1].getTime() - runs[0].getTime()) / 60_000;
  } finally {
    job.stop();
  }
}

export function occurrencesBetween(cron, timezone, from, to, cap = 500) {
  const start = new Date(from);
  const end = new Date(to);
  const limit = Math.floor(Number(cap));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end || !Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  const value = typeof cron === 'string' ? cron.trim() : '';
  const expression = /^\d{1,2}:\d{2}$/.test(value) ? `${Number(value.slice(3))} ${Number(value.slice(0, 2))} * * *` : value;
  if (expression.split(/\s+/).length !== 5) return [];

  let job;
  try {
    job = createCron(expression, timezone);
    return job.nextRuns(limit, new Date(start.getTime() - 1)).filter((run) => run <= end);
  } catch {
    return [];
  } finally {
    job?.stop();
  }
}
