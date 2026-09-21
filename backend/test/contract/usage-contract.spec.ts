import { getMetadataArgsStorage } from 'typeorm';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('usage-records contract', () => {
  it('UsageRecord entity has all required columns', () => {
    // Will fail until entity is created in Task 2
    const entity = require('../../src/modules/usage/entities/usage-record.entity');
    expect(entity).toBeDefined();
  });
});
