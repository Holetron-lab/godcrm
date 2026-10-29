import { describe, it, expect } from 'vitest';
import { describeSupply, summarizeSupplies, moscowToday } from './procurement';
const today = '2026-10-14';
const order = { amount: 100.10, paid: 20.05, currency: 'RUB', status: 'Заказано', expected_date: today, payment_due: today };
describe('saved supply calculations', () => {
  it('calculates exact minor-unit balances and separates currencies', () => {
    const summary = summarizeSupplies([order, { ...order, currency: 'USD' }], today);
    expect(summary.week).toEqual({ RUB: 80.05, USD: 80.05 });
    expect(describeSupply(order, today).balance).toBe(80.05);
  });
  it('uses Moscow midnight, Monday–Sunday, and the next seven calendar days', () => {
    expect(moscowToday(new Date('2026-10-13T21:00:00Z'))).toBe(today);
    expect(describeSupply({ ...order, payment_due: '2026-10-12' }, today).thisWeek).toBe(true);
    expect(describeSupply({ ...order, payment_due: '2026-10-19' }, today).thisWeek).toBe(false);
    expect(describeSupply({ ...order, expected_date: '2026-10-20' }, today).upcoming).toBe(true);
    expect(describeSupply({ ...order, expected_date: '2026-10-21' }, today).upcoming).toBe(false);
    expect(describeSupply(order, today).overdue).toBe(false);
  });
  it('excludes received deliveries and paid/overpaid balances from alerts', () => {
    const done = describeSupply({ ...order, status: 'Получено', paid: 120, expected_date: '2026-10-01' }, today);
    expect(done).toMatchObject({ balance: -19.9, waiting: false, delayed: false, needsPayment: false, upcoming: false });
  });
  it('requires an invoice, plus delivery and closing documents when received', () => {
    expect(describeSupply(order, today).missingDocuments).toBe(true);
    expect(describeSupply({ ...order, invoice: '/uploads/invoice.pdf' }, today).missingDocuments).toBe(false);
    expect(describeSupply({ ...order, status: 'Получено', invoice: '/uploads/i.pdf' }, today).missingDocuments).toBe(true);
    expect(describeSupply({ ...order, status: 'Получено', invoice: '/uploads/i.pdf', delivery_note: [{ url: '/uploads/n.pdf' }], closing_documents: '/uploads/c.pdf' }, today).missingDocuments).toBe(false);
    expect(describeSupply({ ...order, invoice: [] }, today).missingDocuments).toBe(true);
  });
  it('does not turn missing/invalid amounts or currencies into reassuring zeroes', () => {
    expect(describeSupply({ ...order, amount: '' }, today).balance).toBeNull();
    expect(describeSupply({ ...order, paid: -1 }, today).balance).toBeNull();
    const s = summarizeSupplies([{ ...order, amount: '' }, { ...order, currency: '' }], today);
    expect(s.incomplete).toBe(2);
    expect(s.week).toEqual({});
  });
  it('does not classify missing or invalid dates as overdue', () => {
    expect(describeSupply({ ...order, payment_due: '', expected_date: '2026-02-30' }, today)).toMatchObject({ overdue: false, delayed: false, upcoming: false });
  });
});
