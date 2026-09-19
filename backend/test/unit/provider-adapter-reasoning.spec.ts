import { OpenAICompatibleAdapter } from '../../src/modules/provider/adapters/openai-compatible.adapter';

const create = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create } } })),
}));

jest.mock('../../src/common/crypto/credential-cipher', () => ({
  decrypt: () => 'sk_test',
  encrypt: (v: string) => v,
}));

const OPENROUTER = {
  id: 'p1',
  type: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKeyEncrypted: 'x',
};
const OPENAI = {
  id: 'p2',
  type: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEncrypted: 'x',
};

function emptyStream() {
  return (async function* () {})();
}

describe('OpenAICompatibleAdapter reasoning requests', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(emptyStream());
  });

  it('sends no reasoning parameters when reasoning is off (unchanged request body)', async () => {
    await new OpenAICompatibleAdapter().stream(OPENROUTER as never, {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const body = create.mock.calls[0][0];
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.include_reasoning).toBeUndefined();
  });

  it('requests the provider high/default reasoning mode with a summary', async () => {
    await new OpenAICompatibleAdapter().stream(OPENROUTER as never, {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: true, summary: true },
    });

    expect(create.mock.calls[0][0]).toMatchObject({
      reasoning: { effort: 'high' },
      include_reasoning: true,
    });
  });

  it('omits the summary switch when the model exposes no summary', async () => {
    await new OpenAICompatibleAdapter().stream(OPENROUTER as never, {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: true, summary: false },
    });

    const body = create.mock.calls[0][0];
    expect(body.reasoning).toEqual({ effort: 'high' });
    expect(body.include_reasoning).toBeUndefined();
  });

  it('uses the documented high effort knob for other OpenAI-compatible providers', async () => {
    await new OpenAICompatibleAdapter().stream(OPENAI as never, {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: true, summary: false },
    });

    const body = create.mock.calls[0][0];
    expect(body.reasoning_effort).toBe('high');
    expect(body.reasoning).toBeUndefined();
  });
});

describe('OpenAICompatibleAdapter reasoning responses', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('normalizes provider reasoning fields into delta.reasoning and drops the raw field', async () => {
    create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { reasoning_content: 'step one' } }] };
        yield { choices: [{ delta: { reasoning: 'step two' } }] };
        yield { choices: [{ delta: { content: 'answer' } }] };
      })(),
    );

    const adapter = new OpenAICompatibleAdapter();
    const stream = await adapter.stream(OPENAI as never, {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: true, summary: true },
    });

    const chunks: any[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks[0].choices[0].delta.reasoning).toBe('step one');
    expect(chunks[0].choices[0].delta.reasoning_content).toBeUndefined();
    expect(chunks[1].choices[0].delta.reasoning).toBe('step two');
    expect(chunks[2].choices[0].delta.content).toBe('answer');
    expect(chunks[2].choices[0].delta.reasoning).toBeUndefined();
  });

  it('passes ordinary chunks through untouched when reasoning is off', async () => {
    create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] };
      })(),
    );

    const adapter = new OpenAICompatibleAdapter();
    const stream = await adapter.stream(OPENAI as never, {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const chunks: any[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual([{ choices: [{ delta: { content: 'hi' } }] }]);
  });
});
