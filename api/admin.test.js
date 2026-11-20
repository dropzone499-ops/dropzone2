const assert = require('node:assert/strict');
const { after, beforeEach, test } = require('node:test');
const adminApi = require('./admin');

const testPin = 'test-pin';
const originalEnvironment = {
  ADMIN_PIN: process.env.ADMIN_PIN,
  ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
  DROPZONE_ADMIN_MODE: process.env.DROPZONE_ADMIN_MODE,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV
};

function restoreEnvironment() {
  Object.entries(originalEnvironment).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}

beforeEach(() => {
  process.env.ADMIN_PIN = testPin;
  process.env.ADMIN_SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
  process.env.DROPZONE_ADMIN_MODE = 'test';
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  delete process.env.FIREBASE_PROJECT_ID;
  globalThis.__dropzoneAdminPinAttempts = new Map();
  delete globalThis.__dropzoneAdminTestStore;
});

after(restoreEnvironment);

async function dispatch(method, body, { cookie = '', origin = 'http://dropzone.test', ip = '192.0.2.1' } = {}) {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
  await adminApi({
    method,
    headers: {
      host: 'dropzone.test',
      origin,
      cookie,
      'x-forwarded-for': ip
    },
    body,
    socket: { remoteAddress: '127.0.0.1' }
  }, response);
  return response;
}

test('PIN session restores, serves isolated test data, and expires on logout', async () => {
  const login = await dispatch('POST', { action: 'login', pin: testPin });
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.mode, 'test');
  const cookie = login.headers['Set-Cookie'].split(';')[0];

  const session = await dispatch('GET', undefined, { cookie });
  assert.equal(session.statusCode, 200);
  assert.equal(session.body.authenticated, true);

  const snapshot = await dispatch('POST', { action: 'snapshot' }, { cookie });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.body.result.products[0].id, 'test-product-pending');
  assert.equal(snapshot.body.result.users[0].id, 'test-seller');

  const logout = await dispatch('DELETE', undefined, { cookie });
  assert.equal(logout.statusCode, 200);
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/);
  const denied = await dispatch('POST', { action: 'snapshot' });
  assert.equal(denied.statusCode, 401);
});

test('PIN attempts are throttled after five failures', async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await dispatch('POST', { action: 'login', pin: '0000' }, { ip: '192.0.2.2' });
    assert.equal(response.statusCode, 401);
  }
  const blocked = await dispatch('POST', { action: 'login', pin: testPin }, { ip: '192.0.2.2' });
  assert.equal(blocked.statusCode, 429);
});

test('admin mutations reject untrusted origins', async () => {
  const response = await dispatch('POST', { action: 'login', pin: testPin }, {
    origin: 'https://attacker.example'
  });
  assert.equal(response.statusCode, 403);
});

test('local test mode is unavailable on Vercel Preview', async () => {
  process.env.VERCEL_ENV = 'preview';
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => loggedErrors.push(args);
  try {
    const response = await dispatch('POST', { action: 'login', pin: testPin });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, 'firebase_admin_not_configured');
    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0][0], 'Admin API failed.');
  } finally {
    console.error = originalConsoleError;
  }
});
