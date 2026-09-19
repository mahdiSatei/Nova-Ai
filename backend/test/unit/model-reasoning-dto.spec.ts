import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ModelUpsertDto } from '../../src/modules/models/dto/model-upsert.dto';

// Mirrors the application ValidationPipe: whitelist + forbidNonWhitelisted, so
// unknown nested fields are rejected exactly as they are at the HTTP boundary.
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true } as const;

function invalidProperties(payload: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(ModelUpsertDto, payload), PIPE_OPTIONS).flatMap((error) =>
    error.property === 'reasoning'
      ? Object.values(error.children ?? {}).map((child) => child.property)
      : [error.property],
  );
}

describe('ModelUpsertDto.reasoning', () => {
  it('accepts a full manual configuration', () => {
    const errors = invalidProperties({
      reasoning: { mode: 'manual', supported: true, output: 'summary', streaming: false },
    });
    expect(errors).toEqual([]);
  });

  it('accepts explicit nulls (reset a capability to unknown)', () => {
    const errors = invalidProperties({
      reasoning: { mode: 'manual', supported: null, output: null, streaming: null },
    });
    expect(errors).toEqual([]);
  });

  it('accepts an absent reasoning block', () => {
    expect(invalidProperties({})).toEqual([]);
  });

  it('rejects an unknown mode and unknown output', () => {
    expect(invalidProperties({ reasoning: { mode: 'sometimes' } })).toContain('mode');
    expect(invalidProperties({ reasoning: { output: 'chain_of_thought' } })).toContain('output');
  });

  it('rejects non-boolean support and streaming', () => {
    expect(invalidProperties({ reasoning: { supported: 'yes' } })).toContain('supported');
    expect(invalidProperties({ reasoning: { streaming: 1 } })).toContain('streaming');
  });

  it('rejects unknown nested fields', () => {
    expect(invalidProperties({ reasoning: { effort: 'high' } })).toContain('effort');
  });
});
