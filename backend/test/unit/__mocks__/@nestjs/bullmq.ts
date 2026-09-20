// Jest mock for @nestjs/bullmq to avoid ESM import errors in tests.
// Only the symbols referenced by application code are provided.
export const InjectQueue = () => (_target: unknown, _propertyKey: string | undefined, _parameterIndex: number) => {};
export const BullmqModule = {
  forRoot: () => ({ module: class BullmqModule {} }),
  forRootAsync: () => ({ module: class BullmqModule {} }),
  registerQueue: () => ({ module: class BullmqModule {} }),
  registerQueueAsync: () => ({ module: class BullmqModule {} }),
  use: () => ({ module: class BullmqModule {} }),
};
export const BullModule = BullmqModule;
export function Processor(_queueName?: string) {
  return (_target: unknown) => _target;
}
export class WorkerHost {
  // Minimal host; tests that import file.processor.ts only need construction to succeed.
}
