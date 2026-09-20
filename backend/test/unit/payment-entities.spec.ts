import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { CreditPurchase } from '../../src/modules/payments/entities/credit-purchase.entity';
import { Payment } from '../../src/modules/payments/entities/payment.entity';
import {
  TERMINAL_PAYMENT_STATUSES,
  isTerminalPaymentStatus,
} from '../../src/modules/payments/payment-status';

const columnNames = (target: unknown): string[] =>
  getMetadataArgsStorage()
    .columns.filter((c) => c.target === target)
    .map((c) => (c.options.name as string) ?? c.propertyName);

const column = (target: unknown, propertyName: string) => {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === propertyName,
  );
  if (!found) {
    throw new Error(`missing column ${propertyName}`);
  }
  return found;
};

describe('payment entities', () => {
  it('stores Toman amounts as integers', () => {
    for (const property of ['pricePerCreditToman', 'amountToman']) {
      const col = column(CreditPurchase, property);
      expect(col.options.type).toBe('int');
    }
    expect(column(Payment, 'amountToman').options.type).toBe('int');
    expect(column(Payment, 'providerAmountRial').options.type).toBe('bigint');
    expect(column(CreditPurchase, 'credits').options.type).toBe('int');
  });

  it('snake_cases every multi-word column', () => {
    expect(columnNames(CreditPurchase)).toEqual(
      expect.arrayContaining([
        'user_id',
        'price_per_credit_toman',
        'amount_toman',
        'payment_id',
        'created_at',
        'completed_at',
      ]),
    );
    expect(columnNames(Payment)).toEqual(
      expect.arrayContaining([
        'credit_purchase_id',
        'user_id',
        'amount_toman',
        'provider_amount_rial',
        'provider_track_id',
        'provider_reference',
        'provider_status',
        'provider_raw_data',
        'paid_at',
      ]),
    );
  });

  it('maps to the expected tables', () => {
    const tables = getMetadataArgsStorage()
      .tables.filter((t) => t.target === CreditPurchase || t.target === Payment)
      .map((t) => t.name);

    expect(tables).toEqual(expect.arrayContaining(['credit_purchases', 'payments']));
  });

  it('keeps the migration in step with the entity columns', () => {
    // No database is required for this: it compares the CREATE TABLE bodies in
    // migration 1700000015000 against the decorators above, so a column added to
    // an entity without a migration fails here instead of at deploy time.
    const sql = readFileSync(
      join(
        __dirname,
        '../../src/database/migrations/1700000015000-add-payments-and-credit-purchases.ts',
      ),
      'utf8',
    );

    const tableColumns = (table: string): string[] => {
      const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
      if (start === -1) {
        throw new Error(`could not locate CREATE TABLE for ${table}`);
      }
      // The statement ends at the template literal's closing indented paren.
      const end = sql.indexOf('\n      )', start);
      if (end === -1) {
        throw new Error(`could not find the end of CREATE TABLE for ${table}`);
      }
      return sql
        .slice(start, end)
        .split('\n')
        .map((line) => /^\s*([a-z_][a-z0-9_]*)\s+(UUID|INTEGER|BIGINT|VARCHAR|TIMESTAMPTZ|JSONB)/i.exec(line))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => m[1]);
    };

    const purchaseColumns = tableColumns('credit_purchases');
    expect(purchaseColumns).toEqual(expect.arrayContaining(columnNames(CreditPurchase)));
    expect(purchaseColumns).toContain('id');

    const paymentColumns = tableColumns('payments');
    expect(paymentColumns).toEqual(expect.arrayContaining(columnNames(Payment)));
    expect(paymentColumns).toContain('id');
  });

  it('knows which payment statuses are terminal', () => {
    expect(TERMINAL_PAYMENT_STATUSES).toEqual(['SUCCESS', 'FAILED', 'CANCELLED']);
    expect(isTerminalPaymentStatus('PENDING')).toBe(false);
    expect(isTerminalPaymentStatus('SUCCESS')).toBe(true);
    expect(isTerminalPaymentStatus('CANCELLED')).toBe(true);
  });
});
