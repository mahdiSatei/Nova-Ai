import { getMetadataArgsStorage } from 'typeorm';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('QuotaRule entity', () => {
  it('maps quota_rule with correct columns', () => {
    const { QuotaRule } = require('../../src/modules/quotas/entities/quota-rule.entity');
    expect(column('id', QuotaRule)).toMatchObject({ type: 'uuid' });
    expect(column('tier', QuotaRule)).toMatchObject({ type: 'text' });
    expect(column('tokenLimit', QuotaRule)).toMatchObject({ type: 'bigint' });
    expect(column('label', QuotaRule)).toMatchObject({ type: 'text' });
  });
});
