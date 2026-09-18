import { getMetadataArgsStorage } from 'typeorm';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('Quota entity', () => {
  it('maps quota with correct columns', () => {
    const { Quota } = require('../../src/modules/quotas/entities/quota.entity');
    expect(column('id', Quota)).toMatchObject({ type: 'uuid' });
    expect(column('userId', Quota)).toMatchObject({ type: 'text' });
    expect(column('tokenLimit', Quota)).toMatchObject({ type: 'bigint' });
    expect(column('tokenUsed', Quota)).toMatchObject({ type: 'bigint', default: 0 });
    expect(column('lastResetAt', Quota)).toMatchObject({ type: 'timestamp', nullable: true });
  });
});
