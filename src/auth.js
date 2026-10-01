/* The read API's lock: `Authorization: Bearer <ADMIN_TOKEN>`. No token configured, no access. */

export function authorized(request, env) {
  const want = env.ADMIN_TOKEN;
  if (!want) return false;
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return got.length === want.length && same(got, want);
}

function same(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
