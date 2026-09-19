jest.mock('openai', () => {
  const create = jest.fn().mockResolvedValue((async function* () {})());
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ chat: { completions: { create } } })),
    __create: create,
  };
});

jest.mock('../../src/common/crypto/credential-cipher', () => ({
  decrypt: () => 'sk_test',
  encrypt: (v: string) => v,
}));

import { OpenAICompatibleAdapter } from '../../src/modules/provider/adapters/openai-compatible.adapter';

const { __create: create } = jest.requireMock('openai') as { __create: jest.Mock };

const PROVIDER = {
  id: 'p1',
  type: 'openai-compatible',
  baseUrl: 'https://api.test',
  apiKeyEncrypted: 'x',
};

describe('OpenAICompatibleAdapter tools', () => {
  beforeEach(() => create.mockClear());

  it('omits tools when none are supplied (unchanged non-search request)', async () => {
    const adapter = new OpenAICompatibleAdapter();
    await adapter.stream(PROVIDER as never, {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const body = create.mock.calls[0][0];
    expect(body.tools).toBeUndefined();
  });

  it('forwards tool definitions and converts tool messages', async () => {
    const adapter = new OpenAICompatibleAdapter();
    await adapter.stream(PROVIDER as never, {
      model: 'm',
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } },
          ],
        },
        { role: 'tool', content: 'result', toolCallId: 'c1' },
      ],
      tools: [
        { type: 'function', function: { name: 'web_search', description: 'd', parameters: { type: 'object' } } },
      ],
    });
    const body = create.mock.calls[0][0];
    expect(body.tools).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search' } }],
    });
    expect(body.messages[1]).toMatchObject({ role: 'tool', content: 'result', tool_call_id: 'c1' });
  });
});
