// Fake Tangelo completion endpoint for the local demo in DEMO.md. Never use
// real Tangelo credentials with it.
//
//   node demo/tangelo/fake-tangelo.mjs
//
// Accepts POST /api/v1/task_completions, logs the headers and body it received,
// and answers like Tangelo: 401 for a wrong credential pair, 422 without an
// employee_email, "completed" the first time a learner finishes a lab and
// "already_completed" on every repeat.
import http from 'node:http';

const PORT = Number(process.env.FAKE_TANGELO_PORT ?? 8787);
const TOKEN = process.env.FAKE_TANGELO_TOKEN ?? 'demo-tangelo-token';
const USER_ID = process.env.FAKE_TANGELO_USER_ID ?? 'demo-service-account-user';
const PATH = '/api/v1/task_completions';

const completed = new Set();

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
  console.log(`<- ${status} ${JSON.stringify(body)}\n`);
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    console.log(`-> ${req.method} ${req.url} at ${new Date().toISOString()}`);
    console.log('   headers:', JSON.stringify(req.headers, null, 2).replace(/\n/g, '\n   '));
    console.log('   body:', raw);

    if (req.method !== 'POST' || req.url !== PATH) {
      return reply(res, 404, { error: 'not found' });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}` || req.headers['x-user-id'] !== USER_ID) {
      return reply(res, 401, { error: 'invalid credentials' });
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(res, 400, { error: 'invalid JSON' });
    }
    if (typeof body.employee_email !== 'string' || body.employee_email === '') {
      return reply(res, 422, { error: 'employee_email is required' });
    }
    const key = `${body.employee_email}\n${body.path_finder_url}`;
    if (completed.has(key)) {
      return reply(res, 200, { status: 'already_completed' });
    }
    completed.add(key);
    return reply(res, 201, { status: 'completed', completed_at: body.completed_at ?? new Date().toISOString() });
  });
});

server.listen(PORT, () => {
  console.log(`fake Tangelo listening on http://localhost:${PORT}${PATH}`);
});
