import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

const document = YAML.parse(
  readFileSync(
    join(__dirname, '../../specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml'),
    'utf8',
  ),
);

describe('model access-control API contract', () => {
  it('documents the admin user access endpoints as admin-only', () => {
    const pairs = [
      ['/v1/admin/users', 'get'],
      ['/v1/admin/users/{id}/access-tier', 'patch'],
    ] as const;
    for (const [path, method] of pairs) {
      const op = document.paths[path]?.[method];
      expect(op).toBeDefined();
      expect(op.security).toEqual([{ bearerAdminAuth: [] }]);
      expect(op.responses['401']).toBeDefined();
      expect(op.responses['403']).toBeDefined();
    }
  });

  it('requires visibility on ModelAdmin and keeps ModelPublic minimal', () => {
    const schemas = document.components.schemas;
    expect(schemas.ModelVisibility.enum).toEqual(['public', 'commercial', 'private']);
    expect(schemas.UserAccessTier.enum).toEqual(['free', 'commercial']);
    expect(schemas.ModelAdmin.allOf[1].required).toContain('visibility');
    expect(schemas.ModelAdmin.allOf[1].properties.visibility.$ref).toBe(
      '#/components/schemas/ModelVisibility',
    );
    expect(Object.keys(schemas.ModelPublic.properties).sort()).toEqual([
      'displayName',
      'id',
      'isDefault',
    ]);
  });

  it('accepts visibility on model create and patch, but never requires it', () => {
    const schemas = document.components.schemas;
    expect(schemas.ModelCreateRequest.properties.visibility).toBeDefined();
    expect(schemas.ModelPatchRequest.properties.visibility).toBeDefined();
    expect(schemas.ModelCreateRequest.required).not.toContain('visibility');
    expect(schemas.ModelPatchRequest.required ?? []).toEqual([]);
  });

  it('documents the entitlement rejection on both user model-selection paths', () => {
    const operations = [
      document.paths['/v1/conversations/{id}/model'].patch,
      document.paths['/v1/users/me/model-preference'].patch,
    ];
    for (const op of operations) {
      expect(op.responses['403']).toBeDefined();
      expect(op.responses['422']).toBeDefined();
    }
  });

  it('documents the default-model visibility constraint', () => {
    expect(document.paths['/v1/admin/models/{id}'].patch.responses['409'].description).toMatch(
      /default/i,
    );
    expect(document.paths['/v1/admin/config'].put.responses['422'].description).toMatch(/public/i);
  });
});
