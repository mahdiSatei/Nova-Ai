import { getMetadataArgsStorage } from 'typeorm';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('UsageRecord entity', () => {
  it('maps usage_records with correct columns', () => {
    const { UsageRecord } = require('../../src/modules/usage/entities/usage-record.entity');
    expect(column('id', UsageRecord)).toMatchObject({ type: 'uuid' });
    expect(column('userId', UsageRecord)).toMatchObject({ type: 'text' });
    expect(column('conversationId', UsageRecord)).toMatchObject({ type: 'text' });
    expect(column('messageId', UsageRecord)).toMatchObject({ type: 'text', nullable: true });
    expect(column('modelId', UsageRecord)).toMatchObject({ type: 'text' });
    expect(column('providerId', UsageRecord)).toMatchObject({ type: 'text' });
    expect(column('promptTokens', UsageRecord)).toMatchObject({ type: 'int' });
    expect(column('completionTokens', UsageRecord)).toMatchObject({ type: 'int' });
    expect(column('totalTokens', UsageRecord)).toMatchObject({ type: 'int' });
    expect(column('estimatedCost', UsageRecord)).toMatchObject({ type: 'decimal' });
    expect(column('status', UsageRecord)).toMatchObject({ type: 'text', default: 'pending' });
  });

  it('maps the commercial columns (reasoning tokens, charged cost/credits)', () => {
    const { UsageRecord } = require('../../src/modules/usage/entities/usage-record.entity');
    expect(column('reasoningTokens', UsageRecord)).toMatchObject({ type: 'int', default: 0 });
    expect(column('chargedCost', UsageRecord)).toMatchObject({
      type: 'decimal',
      precision: 14,
      scale: 4,
    });
    expect(column('chargedCredits', UsageRecord)).toMatchObject({
      type: 'decimal',
      precision: 14,
      scale: 4,
    });
  });
});

describe('Model pricing columns', () => {
  it('maps inputPricePer1m with a zero default', () => {
    const { Model } = require('../../src/modules/models/entities/model.entity');
    const options = column('inputPricePer1m', Model);
    expect(options.type).toBe('decimal');
    expect(options.precision).toBe(10);
    expect(options.scale).toBe(4);
    expect(options.default).toBe(0);
  });

  it('maps outputPricePer1m with a zero default', () => {
    const { Model } = require('../../src/modules/models/entities/model.entity');
    const options = column('outputPricePer1m', Model);
    expect(options.type).toBe('decimal');
    expect(options.precision).toBe(10);
    expect(options.scale).toBe(4);
    expect(options.default).toBe(0);
  });
});
