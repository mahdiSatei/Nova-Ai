import { getMetadataArgsStorage } from 'typeorm';
import { Model } from '../../src/modules/models/entities/model.entity';
import { UsageRecord } from '../../src/modules/usage/entities/usage-record.entity';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options as Record<string, unknown>;
}

describe('provider fallback + attempt columns (spec 006)', () => {
  it('models.fallbackModelId is a nullable text column backed by fallback_model_id', () => {
    const opts = column('fallbackModelId', Model);
    expect(opts.name).toBe('fallback_model_id');
    expect(opts.type).toBe('text');
    expect(opts.nullable).toBe(true);
  });

  it('usage_records.attempts defaults to 1', () => {
    const opts = column('attempts', UsageRecord);
    // TypeORM omits `name` when it matches the property name, which is what
    // gives us the `attempts` column.
    expect(opts.name ?? 'attempts').toBe('attempts');
    expect(opts.type).toBe('int');
    expect(opts.default).toBe(1);
  });
});
