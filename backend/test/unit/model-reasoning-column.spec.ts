import { getMetadataArgsStorage } from 'typeorm';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('Model.reasoningConfig', () => {
  it('maps a jsonb reasoning_config column with an empty-object default', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Model } = require('../../src/modules/models/entities/model.entity');
    const options = column('reasoningConfig', Model);
    expect(options).toMatchObject({ name: 'reasoning_config', type: 'jsonb' });
    expect(String(options.default as unknown)).toContain('{}');
  });
});
