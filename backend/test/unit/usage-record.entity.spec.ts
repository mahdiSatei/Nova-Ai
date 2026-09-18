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
});

describe('Model pricing columns', () => {
  it('maps inputPricePer1k with a zero default', () => {
    const { Model } = require('../../src/modules/models/entities/model.entity');
    const options = column('inputPricePer1k', Model);
    expect(options.type).toBe('decimal');
    expect(options.default).toBe(0);
  });

  it('maps outputPricePer1k with a zero default', () => {
    const { Model } = require('../../src/modules/models/entities/model.entity');
    const options = column('outputPricePer1k', Model);
    expect(options.type).toBe('decimal');
    expect(options.default).toBe(0);
  });
});
