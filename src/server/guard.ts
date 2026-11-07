/** The trust boundary of the local server. Every request passes here. See docs/security.md. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

/** Sites ignore ports, and cookies do too, so the port goes in the name. */
export const cookieName = (port: number) => `jevonganize_${port}`;

const digest = (text: string) => createHash('sha256').update(text).digest();

/** Equal-length digests, so `timingSafeEqual` cannot throw and the length does not leak. */
export const sameToken = (given: string | undefined, token: string) =>
  given !== undefined && timingSafeEqual(digest(given), digest(token));

function bearer(c: Context): string | undefined {
  const header = c.req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

/** Host, Origin, Sec-Fetch-Site and token, in that order. Only `/auth` swaps the session check. */
export function guard(port: number, token: string): MiddlewareHandler {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return async (c, next) => {
    const host = c.req.header('host');
    if (host === undefined || !hosts.includes(host)) return c.text('Forbidden', 403);
    const origin = c.req.header('origin');
    if (origin !== undefined && origin !== `http://${host}`) return c.text('Forbidden', 403);
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return c.text('Forbidden', 403);
    }
    const authing = c.req.path === '/auth';
    const given = authing ? c.req.query('t') : (getCookie(c, cookieName(port)) ?? bearer(c));
    if (!sameToken(given, token)) return c.text('Unauthorized', 401);
    return next();
  };
}
