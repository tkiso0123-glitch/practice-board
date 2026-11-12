import { handleApi } from './api.js';
import { runDaily } from './cron.js';
import { handleWebhook } from './webhook.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/webhook') {
      if (req.method !== 'POST') return new Response('OK');
      return handleWebhook(req, env, ctx);
    }
    if (url.pathname.startsWith('/api/')) return handleApi(req, env, ctx, url);
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDaily(env));
  },
};
