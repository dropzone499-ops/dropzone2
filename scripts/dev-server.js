const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const adminApi = require('../api/admin');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');
const maxBodyBytes = 4 * 1024 * 1024;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function loadLocalEnvironment() {
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, 'utf8');
  contents.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) return;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  });
}

function respondJson(res, status, data) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('მოთხოვნის ზომა დასაშვებ ზღვარს აჭარბებს.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('მოთხოვნის JSON არასწორია.'), { status: 400 });
  }
}

async function handleAdminRequest(req, res) {
  try {
    if (req.method === 'POST') req.body = await readJsonBody(req);
    const adapter = {
      setHeader: (name, value) => res.setHeader(name, value),
      status(code) {
        res.statusCode = code;
        return this;
      },
      json(data) {
        if (res.writableEnded) return this;
        res.end(JSON.stringify(data));
        return this;
      }
    };
    await adminApi(req, adapter);
    if (!res.writableEnded) res.end();
  } catch (error) {
    respondJson(res, error.status || 500, {
      ok: false,
      error: error.status === 413 ? 'payload_too_large' : 'local_dev_server_error',
      message: error.message || 'ლოკალური მოთხოვნა ვერ შესრულდა.'
    });
  }
}

function resolveStaticPath(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(root, `.${pathname}`);
  return filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
}

async function handleStaticRequest(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    respondJson(res, 405, { error: 'method_not_allowed', message: 'მეთოდი დაუშვებელია.' });
    return;
  }
  const filePath = resolveStaticPath(req.url || '/');
  if (!filePath) {
    respondJson(res, 400, { error: 'invalid_path', message: 'მისამართი არასწორია.' });
    return;
  }
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': stat.size,
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).pipe(res);
  } catch {
    respondJson(res, 404, { error: 'not_found', message: 'ფაილი ვერ მოიძებნა.' });
  }
}

loadLocalEnvironment();
const port = Number(process.env.PORT || 3000);
const server = http.createServer((req, res) => {
  if (req.url?.split('?')[0] === '/api/admin') {
    handleAdminRequest(req, res);
    return;
  }
  handleStaticRequest(req, res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DropZone local test server: http://127.0.0.1:${port}/admin.html`);
  if (process.env.DROPZONE_ADMIN_MODE !== 'test') {
    console.log('Set DROPZONE_ADMIN_MODE=test in .env.local to use isolated test data.');
  }
});
