import { getMetadataArgsStorage } from 'typeorm';
import { Model } from '../../src/modules/models/entities/model.entity';
import { User } from '../../src/modules/users/entities/user.entity';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('access-control columns', () => {
  it('maps models.visibility with a public default', () => {
    const options = column('visibility', Model);
    // No explicit `name`, so the DB column is the property name: `visibility`.
    expect(options.name).toBeUndefined();
    expect(options.type).toBe('text');
    expect(options.default).toBe('public');
  });

  it('keeps the model visibility column nullable-free at the SQL level', () => {
    const visibility = column('visibility', Model);
    expect(visibility.nullable).toBeFalsy();
  });

  it('no longer maps a users.access_tier column', () => {
    const columns = getMetadataArgsStorage()
      .columns.filter((c) => c.target === User)
      .map((c) => c.propertyName);
    expect(columns).not.toContain('accessTier');
    expect(columns).not.toContain('access_tier');
  });
});
