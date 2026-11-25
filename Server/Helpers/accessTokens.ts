import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { calculateJwkThumbprint, decodeJwt, exportJWK, SignJWT, type JWK } from 'jose';

const ALGORITHM = 'EdDSA';
const TYPE = 'at+jwt';

interface Keys {
  privateKey: KeyObject;
  jwk: JWK;
}

let keys: Promise<Keys> | undefined;

function load(): Promise<Keys> {
  keys ??= (async () => {
    const privateKey = createPrivateKey(process.env.JWT_SIGNING_KEY!);
    const publicJwk = await exportJWK(createPublicKey(privateKey));
    const jwk = { ...publicJwk, kid: await calculateJwkThumbprint(publicJwk), alg: ALGORITHM, use: 'sig' };

    return { privateKey, jwk };
  })();

  return keys;
}

export async function jwks(): Promise<{ keys: JWK[] }> {
  const { jwk } = await load();

  return { keys: [jwk] };
}

export async function sign(payload: { sub: string }, expiresAt: Date): Promise<string> {
  const { privateKey, jwk } = await load();

  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALGORITHM, kid: jwk.kid, typ: TYPE })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(privateKey);
}

export function subject(token: string | undefined): string | null {
  if (!token) {
    return null;
  }

  try {
    return decodeJwt(token).sub ?? null;
  } catch {
    return null;
  }
}
