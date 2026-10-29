export const supplyViews = {
  all: 'Все поставки', waiting: 'Ждём поставку', payment: 'Нужно оплатить', documents: 'Не хватает документов',
} as const;
export type SupplyView = keyof typeof supplyViews;

export function moscowToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function minorUnits(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const number = Number(value);
  const cents = Math.round(number * 100);
  return Number.isFinite(number) && number >= 0 && Number.isSafeInteger(cents) ? cents : null;
}

function hasFile(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFile);
  if (value && typeof value === 'object') return hasFile((value as Record<string, unknown>).url);
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.trim().startsWith('[') || value.trim().startsWith('{')) {
    try { return hasFile(JSON.parse(value)); } catch { return false; }
  }
  return /^(\/uploads\/|https?:\/\/)/.test(value.trim());
}

export function describeSupply(data: Record<string, unknown>, today: string) {
  const amount = minorUnits(data.amount);
  const paid = minorUnits(data.paid);
  const balance = amount !== null && paid !== null ? (amount - paid) / 100 : null;
  const currency = typeof data.currency === 'string' && ['RUB', 'USD', 'EUR', 'CNY'].includes(data.currency) ? data.currency : null;
  const due = calendarDate(data.payment_due);
  const expected = calendarDate(data.expected_date);
  const start = new Date(`${today}T00:00:00Z`);
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day + 6) % 7);
  const weekStart = start.toISOString().slice(0, 10);
  start.setUTCDate(start.getUTCDate() + 6);
  const weekEnd = start.toISOString().slice(0, 10);
  const upcomingEnd = new Date(`${today}T00:00:00Z`);
  upcomingEnd.setUTCDate(upcomingEnd.getUTCDate() + 6);
  const waiting = ['Заказано', 'Подтверждено', 'В пути'].includes(String(data.status));
  const needsPayment = balance !== null && balance > 0;
  return {
    balance, currency, waiting, needsPayment,
    incomplete: balance === null || currency === null || !due || !expected || (!waiting && data.status !== 'Получено'),
    overdue: needsPayment && due !== null && due < today,
    thisWeek: needsPayment && due !== null && due >= weekStart && due <= weekEnd,
    upcoming: waiting && expected !== null && expected >= today && expected <= upcomingEnd.toISOString().slice(0, 10),
    delayed: waiting && expected !== null && expected < today,
    missingDocuments: !hasFile(data.invoice) || (data.status === 'Получено' && (!hasFile(data.delivery_note) || !hasFile(data.closing_documents))),
  };
}

export function summarizeSupplies(rows: Record<string, unknown>[], today: string) {
  const week: Record<string, number> = {};
  const overdue: Record<string, number> = {};
  let upcoming = 0, delayed = 0, incomplete = 0;
  for (const row of rows) {
    const s = describeSupply(row, today);
    if (s.currency && s.balance !== null) {
      if (s.thisWeek) week[s.currency] = Math.round(((week[s.currency] ?? 0) + s.balance) * 100) / 100;
      if (s.overdue) overdue[s.currency] = Math.round(((overdue[s.currency] ?? 0) + s.balance) * 100) / 100;
    }
    upcoming += Number(s.upcoming); delayed += Number(s.delayed); incomplete += Number(s.incomplete);
  }
  return { week, overdue, upcoming, delayed, incomplete };
}
