import { ProviderToolCall } from '../provider/adapters/provider-adapter.interface';

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

/**
 * OpenAI-style providers stream a tool call's name once and its arguments in
 * fragments keyed by `index`. This merges those fragments into complete calls.
 */
export class ToolCallAccumulator {
  private readonly byIndex = new Map<number, ProviderToolCall>();

  push(deltas: ToolCallDelta[]): void {
    for (const delta of deltas) {
      const current = this.byIndex.get(delta.index) ?? {
        id: '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (delta.id) current.id = delta.id;
      if (delta.function?.name) current.function.name = delta.function.name;
      if (delta.function?.arguments) current.function.arguments += delta.function.arguments;
      this.byIndex.set(delta.index, current);
    }
  }

  get hasCalls(): boolean {
    return this.byIndex.size > 0;
  }

  get calls(): ProviderToolCall[] {
    return [...this.byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call);
  }
}
