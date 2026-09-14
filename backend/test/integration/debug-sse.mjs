// Diagnostic: check if NestJS @Sse endpoint actually writes events
// Run with: node test/integration/debug-sse.mjs
import http from 'http';

// We'll test against the actual Nest app if possible
// For now just check what a minimal SSE server does

const server = http.createServer((req, res) => {
  if (req.url === '/sse-test') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Write first event immediately
    res.write('data: {"delta":"Hello"}\n\n');

    // Write second event after 50ms
    setTimeout(() => {
      res.write('data: {"delta":" world"}\n\n');
      res.end();
    }, 50);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(0, async () => {
  const port = server.address().port;
  console.log('Server listening on port', port);

  // Test with raw http.request
  await new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/sse-test',
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk.toString());
        console.log('RAW data event:', chunk.toString().trim());
      });
      res.on('end', () => {
        console.log('RAW end. Full body:', chunks.join(''));
        resolve();
      });
      res.on('error', (e) => {
        console.log('RAW error:', e.message);
        resolve();
      });
    });
    req.end();

    // Abort after 200ms
    setTimeout(() => {
      req.abort();
      console.log('Request aborted');
    }, 200);
  });

  server.close();
});
