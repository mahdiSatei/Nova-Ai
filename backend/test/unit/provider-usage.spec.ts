describe('ProviderStreamChunk usage field', () => {
  it('ProviderStreamChunk type includes optional usage', () => {
    // Type-level check: a chunk with usage should compile
    const chunk: import('../../src/modules/provider/adapters/provider-adapter.interface').ProviderStreamChunk = {
      choices: [{ delta: { content: 'hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    expect(chunk.usage?.prompt_tokens).toBe(10);
  });
});
