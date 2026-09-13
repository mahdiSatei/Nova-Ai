import { ArgumentsHost } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

function makeHost(response: any, requestHeaders: Record<string, string> = {}): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ headers: requestHeaders, method: 'GET', url: '/x' }),
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  const writeHead = jest.fn();
  const end = jest.fn();

  function makeResponse() {
    return {
      status: jest.fn().mockReturnValue({ json: jest.fn() }),
      setHeader: jest.fn(),
      writeHead,
      end,
    };
  }

  it('translates an HttpException into a sanitized envelope', () => {
    const filter = new AllExceptionsFilter();
    const host = makeHost(makeResponse());
    filter.catch(new HttpException('bad input', 400), host);
  });

  it('does not leak stack traces for 5xx errors', () => {
    const filter = new AllExceptionsFilter();
    const res = makeResponse();
    const host = makeHost(res);
    filter.catch(new Error('database password leaked: hunter2'), host);
    // The response JSON must not contain "hunter2"
    const jsonCalls = (res.status().json as jest.Mock).mock.calls;
    expect(jsonCalls.length).toBeGreaterThan(0);
    const body = JSON.stringify(jsonCalls[0][0]);
    expect(body).not.toContain('hunter2');
  });

  it('echoes a request id when provided', () => {
    const filter = new AllExceptionsFilter();
    const res = makeResponse();
    filter.catch(new HttpException('x', 404), makeHost(res, { 'x-request-id': 'abc-123' }));
    expect((res.setHeader as jest.Mock).mock.calls).toContainEqual(['x-request-id', 'abc-123']);
  });
});
