import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

const document = YAML.parse(
  readFileSync(
    join(__dirname, '../../specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml'),
    'utf8',
  ),
);

describe('multi-provider API contract', () => {
  it('versions the coordinated breaking release', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe('2.0.0');
    expect(document.paths['/v1/admin/provider']).toBeUndefined();
  });

  it.each([
    ['/v1/admin/providers', 'get', '200'],
    ['/v1/admin/providers', 'post', '201'],
    ['/v1/admin/providers/{id}', 'get', '200'],
    ['/v1/admin/providers/{id}', 'patch', '200'],
    ['/v1/admin/providers/{id}', 'delete', '204'],
    ['/v1/admin/providers/{id}/validate', 'post', '200'],
  ])('protects %s %s and documents responses', (path, method, status) => {
    const operation = document.paths[path]?.[method];
    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ bearerAdminAuth: [] }]);
    for (const code of [status, '400', '401', '403', '500']) {
      expect(operation.responses[code]).toBeDefined();
    }
  });

  it('requires provider assignment only on model creation', () => {
    const schemas = document.components.schemas;
    expect(schemas.ModelCreateRequest?.required).toEqual(
      expect.arrayContaining(['displayName', 'actualName', 'providerId']),
    );
    expect(schemas.ModelPatchRequest?.required ?? []).toEqual([]);
    const modelAdminRequired = schemas.ModelAdmin?.allOf?.[1]?.required ?? [];
    expect(modelAdminRequired).toContain('providerId');
    expect(schemas.ModelCreateRequest.properties.providerId).toMatchObject({
      type: 'string', pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 80,
    });
  });

  it('returns only public provider metadata and rejects unknown update fields', () => {
    const schemas = document.components.schemas;
    expect(schemas.ProviderPublic).toBeDefined();
    expect(Object.keys(schemas.ProviderPublic.properties).sort()).toEqual([
      'baseUrl', 'createdAt', 'hasApiKey', 'id', 'isActive', 'lastValidatedAt', 'name', 'type', 'updatedAt',
    ].sort());
    expect(schemas.ProviderPublic.required).toEqual(
      expect.arrayContaining(Object.keys(schemas.ProviderPublic.properties)),
    );
    expect(schemas.ProviderUpdateRequest.additionalProperties).toBe(false);
    expect(Object.keys(schemas.ProviderUpdateRequest.properties).sort()).toEqual([
      'apiKey', 'baseUrl', 'isActive', 'name',
    ]);
  });
});
