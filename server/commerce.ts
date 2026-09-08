import type { IncomingMessage, ServerResponse } from 'node:http';

// Only explicitly configured public contact/payment details leave the server.
export function commerceConfig(env: NodeJS.ProcessEnv = process.env) {
  const email = (env.SALES_EMAIL ?? 'juandedofeliz@gmail.com').trim();
  let supportUrl: string | null = null;
  try {
    // Public owner-provided link. An explicit empty override disables contributions.
    const url = new URL(env.SUPPORT_PAYMENT_URL ?? 'https://www.paypal.me/jwer99');
    if (url.protocol === 'https:' && !url.username && !url.password &&
        ['buy.stripe.com', 'donate.stripe.com', 'www.paypal.com', 'paypal.me', 'www.paypal.me', 'ko-fi.com', 'www.buymeacoffee.com'].includes(url.hostname)) {
      supportUrl = url.href;
    }
  } catch { /* Unconfigured payments remain unavailable. */ }
  return {
    salesEmail: /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email) ? email : null,
    supportUrl,
  };
}

export function handleCommerce(req: IncomingMessage, res: ServerResponse, env = process.env) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Método no permitido' }));
    return;
  }
  res.end(JSON.stringify(commerceConfig(env)));
}
