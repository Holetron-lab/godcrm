import crypto from 'node:crypto';

const MAX_ENVELOPE_AGE_SECONDS = 120;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signBody(key, body) {
  const transported = JSON.parse(JSON.stringify(body));
  return crypto.createHmac('sha256', key).update(canonicalJson(transported)).digest('hex');
}

export function createEnvelope(key, body) {
  const signedBody = {
    ...body,
    issued_at: body.issued_at ?? Math.floor(Date.now() / 1000),
  };
  return { body: signedBody, sig: signBody(key, signedBody) };
}

export function verifyEnvelope(key, envelope, nowSeconds = Math.floor(Date.now() / 1000)) {
  const body = envelope?.body;
  const signature = envelope?.sig;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  if (!Number.isInteger(body.issued_at)) return null;
  const age = nowSeconds - body.issued_at;
  if (age > MAX_ENVELOPE_AGE_SECONDS || age < -5) return null;
  const expected = Buffer.from(signBody(key, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (!crypto.timingSafeEqual(expected, given)) return null;
  return body;
}
