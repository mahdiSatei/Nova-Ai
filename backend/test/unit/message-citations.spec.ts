import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('Message.citations', () => {
  it('maps a jsonb citations column with an empty-array default', () => {
    const { Message } = require('../../src/modules/conversations/entities/message.entity');
    expect(column('citations', Message)).toMatchObject({ name: 'citations', type: 'jsonb' });
  });
});
