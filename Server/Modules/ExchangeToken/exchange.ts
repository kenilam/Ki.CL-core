import { randomUUID } from 'node:crypto';
import type { Context } from 'server/Context/index.js';
import { CaptchaRequired } from 'server/Errors/index.js';
import * as accessTokens from 'server/Helpers/accessTokens.js';
import { parseCookies } from 'server/Helpers/auth.js';
import * as session from 'server/Helpers/session.js';
import { turnstileToken, verifyTurnstile } from 'server/Helpers/turnstile.js';

/** Must match the `action` the client renders the widget with. */
const TURNSTILE_ACTION = 'exchange-token';

const LOG = '[ExchangeToken]';

/**
 * A forged, spent or missing Turnstile token throws CAPTCHA_REQUIRED. When
 * Cloudflare can't answer, the visitor still gets a session, so the site stays
 * up for new visitors.
 */
async function checkTurnstile(context: Pick<Context, 'headers'>): Promise<void> {
  const verdict = await verifyTurnstile({
    token: turnstileToken(context.headers),
    action: TURNSTILE_ACTION,
  });

  if (verdict.ok) {
    return;
  }

  if (verdict.reason === 'rejected') {
    console.log(`${LOG} Turnstile rejected: ${verdict.codes.join(',')}`);
    throw CaptchaRequired();
  }

  console.warn(`${LOG} Turnstile unavailable: ${verdict.codes.join(',')}`);
}

/**
 * Gives the caller a session: keeps the one they have, renews it from its
 * refresh token, or starts a new anonymous one after a Turnstile check.
 * Resolves to whether cookies were set. A forged or old access token clears
 * the cookies and starts a new session, whatever refresh token came with it.
 */
export async function exchangeToken(context: Pick<Context, 'headers' | 'res'>): Promise<boolean> {
  const cookies = parseCookies(context.headers['cookie'] as string | undefined);
  const access = await accessTokens.read(cookies.access_token, context.res);

  if (access.payload) {
    return false;
  }

  if (!access.invalid && (await session.renew(context.res, cookies.refresh_token))) {
    return true;
  }

  await checkTurnstile(context);
  await session.start(context.res, randomUUID(), 'anon');

  return true;
}
