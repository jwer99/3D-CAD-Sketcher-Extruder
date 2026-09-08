import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { commerceConfig, handleCommerce } from '../server/commerce';

assert.deepEqual(commerceConfig({}), { salesEmail: 'juandedofeliz@gmail.com', supportUrl: 'https://www.paypal.me/jwer99' });
assert.equal(commerceConfig({ SALES_EMAIL: '' }).salesEmail, null);
assert.equal(commerceConfig({ SUPPORT_PAYMENT_URL: '' }).supportUrl, null);
for (const url of ['javascript:alert(1)', 'http://paypal.me/demo', 'https://paypal.me.evil.example/demo', 'https://user:pass@paypal.me/demo', 'not-a-url']) {
  assert.equal(commerceConfig({ SUPPORT_PAYMENT_URL: url }).supportUrl, null);
}
assert.equal(commerceConfig({ SUPPORT_PAYMENT_URL: 'https://paypal.me/example' }).supportUrl, 'https://paypal.me/example');
assert.equal(commerceConfig({ SUPPORT_PAYMENT_URL: 'https://www.paypal.me/jwer99' }).supportUrl, 'https://www.paypal.me/jwer99');
assert.equal(commerceConfig({ SUPPORT_PAYMENT_URL: 'https://www.paypal.me.evil.example/jwer99' }).supportUrl, null);
assert.equal(commerceConfig({ SALES_EMAIL: 'sales@example.com\r\nBcc:other@example.com' }).salesEmail, null);
assert.equal(commerceConfig({ SALES_EMAIL: 'sales@example.com?subject=bad' }).salesEmail, null);
const env = { SALES_EMAIL: 'sales@example.com', GEMINI_API_KEY: 'must-not-be-exposed' };
const server = createServer((req, res) => handleCommerce(req, res, env));
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/api/commerce`;
  const response = await fetch(endpoint);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { salesEmail: 'sales@example.com', supportUrl: 'https://www.paypal.me/jwer99' });
  const post = await fetch(endpoint, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  console.log('Commerce validation and HTTP checks passed.');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
