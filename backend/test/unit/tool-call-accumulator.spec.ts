import { ToolCallAccumulator } from '../../src/modules/chat/tool-call-accumulator';

describe('ToolCallAccumulator', () => {
  it('merges streamed argument fragments by index', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"qu' } }]);
    acc.push([{ index: 0, function: { arguments: 'ery":"cats"}' } }]);

    expect(acc.hasCalls).toBe(true);
    expect(acc.calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"cats"}' } },
    ]);
  });

  it('keeps multiple parallel calls separate', () => {
    const acc = new ToolCallAccumulator();
    acc.push([
      { index: 0, id: 'a', type: 'function', function: { name: 'web_search', arguments: '{}' } },
      { index: 1, id: 'b', type: 'function', function: { name: 'web_search', arguments: '{}' } },
    ]);
    expect(acc.calls.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('reports no calls for content-only streams', () => {
    const acc = new ToolCallAccumulator();
    acc.push([]);
    expect(acc.hasCalls).toBe(false);
    expect(acc.calls).toEqual([]);
  });
});
