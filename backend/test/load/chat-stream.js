import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { htmlReport } from './k6-reporter-bundle.js';

// Load test: Auth (register) + Chat streaming (POST /v1/chat/stream).
//
// Cost warning: every iteration burns REAL provider credits. Keep prompts
// tiny, VUs low, and prefer the cheapest working model via LOADTEST_MODEL_ID.
//
// Usage:
//   k6 run test/load/chat-stream.js                       # smoke: 1 VU, 2 iterations
//   k6 run test/load/chat-stream.js -e PROFILE=load       # load: ramp to 10 VUs, ~5 min
//
// Env:
//   BASE_URL           default http://localhost:3000
//   PROFILE            smoke | load (default smoke)
//   LOADTEST_MODEL_ID  default = Gemini 3.1 (google provider; verified working)
//   LOADTEST_PASSWORD  default Loadtest123!

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PROFILE = __ENV.PROFILE || 'smoke';
// Verified working 2026-09-20. The avalai (central) key is currently dead
// (401 invalid_api_key), so kimi/Deepseek fail with all_providers_unavailable.
const MODEL_ID = __ENV.LOADTEST_MODEL_ID || 'ae5359f4-711f-4002-ba2b-363e65fea687';
const PASSWORD = __ENV.LOADTEST_PASSWORD || 'Loadtest123!';
const PROMPT = 'Reply with exactly: ok';

const streamErrors = new Rate('stream_errors');
const timeToFirstByte = new Trend('time_to_first_byte', true);
const streamDuration = new Trend('stream_duration', true);

export const options =
  PROFILE === 'load'
    ? {
        scenarios: {
          chat_load: {
            executor: 'ramping-vus',
            startVUs: 1,
            stages: [
              { duration: '2m', target: 10 },
              { duration: '3m', target: 10 },
            ],
          },
        },
        thresholds: {
          http_req_failed: ['rate<0.01'],
          stream_errors: ['rate<0.01'],
          time_to_first_byte: ['p(95)<20000'],
        },
      }
    : {
        vus: 1,
        iterations: 2,
        thresholds: {
          http_req_failed: ['rate<0.01'],
          stream_errors: ['rate<0.01'],
        },
      };

export function setup() {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const res = http.post(
    `${BASE_URL}/v1/auth/register`,
    JSON.stringify({
      username: `loadtest_${suffix}`.slice(0, 20),
      email: `loadtest_${suffix}@example.com`,
      password: PASSWORD,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status !== 200 && res.status !== 201) {
    fail(`register failed: ${res.status} ${res.body}`);
  }
  const token = res.json().accessToken;
  if (!token) fail('register response has no accessToken');
  return { token };
}

export default function (data) {
  const res = http.post(
    `${BASE_URL}/v1/chat/stream`,
    JSON.stringify({ message: PROMPT, modelId: MODEL_ID }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.token}`,
      },
      timeout: '120s',
    },
  );

  const body = typeof res.body === 'string' ? res.body : '';
  const okStatus = check(res, { 'stream status 200': (r) => r.status === 200 });
  const hasData = check(res, { 'stream has SSE data': () => body.includes('data:') });
  const providerDown = body.includes('all_providers_unavailable');
  check(res, { 'provider available': () => !providerDown });

  streamErrors.add(!(okStatus && hasData && !providerDown));
  if (res.timings) {
    timeToFirstByte.add(res.timings.waiting);
    streamDuration.add(res.timings.duration);
  }
}

// Every run writes test/load/report/<timestamp>-summary.html + .json
// next to the script, so each load test leaves a shareable report.
export function handleSummary(data) {
  const dir = 'test/load/report';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`${dir}/${PROFILE}-${stamp}.html`]: htmlReport(data),
    [`${dir}/${PROFILE}-${stamp}.json`]: JSON.stringify(data, null, 2),
    stdout: `\nReport written to ${dir}/${PROFILE}-${stamp}.html\n`,
  };
}
