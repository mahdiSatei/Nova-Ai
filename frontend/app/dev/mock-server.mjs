// Zero-dependency mock of the OpenAPI contract for local UI testing.
// Run: node dev/mock-server.mjs   (listens on :3000, matches vite proxy)
import { createServer } from 'node:http'

const JWT = 'mock.' + Buffer.from(JSON.stringify({ role: 'user' })).toString('base64url') + '.sig'

const store = {
  users: new Map([['admin@test.com', { password: 'admin-password-1', role: 'admin' }]]),
  models: [
    { id: 'm-1', displayName: 'GPT-4o mini', isDefault: true },
    { id: 'm-2', displayName: 'Claude Haiku', isDefault: false },
  ],
  conversations: [],
  messages: new Map(),
}

const authUser = (req) => {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? { email: 'mock-user', role: 'user' } : null
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID() })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const err = (res, status, code, message) =>
  json(res, status, { code, message, requestId: crypto.randomUUID() })

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
  })

const authResponse = (u) => ({
  user: { id: 'u-1', email: u.email, role: u.role, createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() },
  accessToken: JWT,
  refreshToken: 'mock.refresh',
  expiresIn: 900,
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  const m = req.method
  console.log(`${m} ${p}`)

  if (p === '/healthz') return res.end('ok')

  if (p === '/v1/auth/register' && m === 'POST') {
    const b = await readBody(req)
    if (!b.email || !b.password) return err(res, 400, 'validation_failed', 'One or more fields failed validation.')
    if (b.password.length < 8) return err(res, 400, 'validation_failed', 'One or more fields failed validation.', )
    if (store.users.has(b.email)) return err(res, 409, 'email_taken', 'That email is already registered.')
    store.users.set(b.email, { password: b.password, role: 'user' })
    return json(res, 201, authResponse({ email: b.email, role: 'user' }))
  }

  if ((p === '/v1/auth/login' || p === '/v1/admin/auth/login') && m === 'POST') {
    const b = await readBody(req)
    const u = store.users.get(b.email)
    const generic = () => err(res, 401, 'invalid_credentials', 'The provided credentials were invalid.')
    if (!u || u.password !== b.password) return generic()
    if (p.startsWith('/v1/admin') && u.role !== 'admin') return generic()
    return json(res, 200, authResponse({ email: b.email, role: u.role }))
  }

  if (p === '/v1/auth/refresh' && m === 'POST') {
    return json(res, 200, { accessToken: JWT, refreshToken: 'mock.refresh', expiresIn: 900, user: authResponse({ email: 'mock-user', role: 'user' }).user })
  }
  if (p === '/v1/auth/logout' && m === 'POST') return json(res, 204)

  if (p === '/v1/models' && m === 'GET') {
    if (!authUser(req)) return err(res, 401, 'invalid_token', 'The provided token is invalid or expired.')
    return json(res, 200, { items: store.models })
  }

  if (p === '/v1/chat/stream' && m === 'POST') {
    if (!authUser(req)) return err(res, 401, 'invalid_token', 'invalid')
    const b = await readBody(req)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const text = [
      'Hello! You said: "' + b.message + '".',
      '',
      'Here is **markdown** rendering:',
      '',
      '- a *bullet* list',
      '- with `inline code`',
      '',
      '```js',
      'function greet(name) {',
      '  return `hi ${name}`',
      '}',
      '```',
      '',
      'Done.',
    ].join('\n')
    for (const ch of Array.from(text)) {
      res.write(`data: ${JSON.stringify({ delta: ch })}\n\n`)
      await new Promise((r) => setTimeout(r, 10))
    }
    res.write('event: done\ndata: {}\n\n')
    return res.end()
  }

  if (p === '/v1/conversations' && m === 'GET') return json(res, 200, { items: store.conversations })
  const convMatch = p.match(/^\/v1\/conversations\/([^/]+)$/)
  if (convMatch) {
    const conv = store.conversations.find((c) => c.id === convMatch[1])
    if (!conv) return err(res, 404, 'not_found', 'The requested resource was not found.')
    if (m === 'GET') return json(res, 200, { ...conv, messages: store.messages.get(conv.id) ?? [] })
    if (m === 'DELETE') {
      store.conversations = store.conversations.filter((c) => c.id !== conv.id)
      return json(res, 204)
    }
  }

  return err(res, 404, 'not_found', 'Mock: no handler for ' + m + ' ' + p)
})

server.listen(3000, () => console.log('mock API on http://localhost:3000 (admin@test.com / admin-password-1)'))
