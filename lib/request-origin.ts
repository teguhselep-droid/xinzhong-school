import { env } from 'cloudflare:workers';

function publicOrigin() {
  return env.XINZHONG_PUBLIC_ORIGIN;
}

export function acceptsRequestOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return origin === null || origin === new URL(request.url).origin ||
    (origin.startsWith('https://') && origin === publicOrigin());
}

export function requiresSecureSessionCookie(request: Request) {
  const origin = request.headers.get('origin');
  return new URL(request.url).protocol === 'https:' ||
    (origin?.startsWith('https://') === true && origin === publicOrigin());
}
