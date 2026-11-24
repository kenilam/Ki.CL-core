import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import type { Response } from 'express';
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  errors,
  exportJWK,
  jwtVerify,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';

import type { TokenPayload } from './auth.js';
import { clearAuthCookies } from './cookies.js';

const ALGORITHM = 'EdDSA';

interface Keys {
  privateKey: KeyObject;
  jwk: JWK;
  keySet: JWTVerifyGetKey;
}

let keys: Promise<Keys> | undefined;

function load(): Promise<Keys> {
  keys ??= (async () => {
    const privateKey = createPrivateKey(process.env.JWT_SIGNING_KEY!);
    const publicJwk = await exportJWK(createPublicKey(privateKey));
    const jwk = { ...publicJwk, kid: await calculateJwkThumbprint(publicJwk), alg: ALGORITHM, use: 'sig' };

    return { privateKey, jwk, keySet: createLocalJWKSet({ keys: [jwk] }) };
  })();

  return keys;
}

export async function jwks(): Promise<{ keys: JWK[] }> {
  const { jwk } = await load();

  return { keys: [jwk] };
}

export async function sign(
  payload: Pick<TokenPayload, 'userGUID' | 'aud' | 'human'>,
  expiresAt: Date,
): Promise<string> {
  const { privateKey, jwk } = await load();

  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM, kid: jwk.kid })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(privateKey);
}

export async function read(
  token: string | undefined,
  res: Response | null,
): Promise<{ payload: TokenPayload | null; invalid: boolean }> {
  if (!token) {
    return { payload: null, invalid: false };
  }

  const { keySet } = await load();

  try {
    const { payload } = await jwtVerify<TokenPayload>(token, keySet, { algorithms: [ALGORITHM] });

    return { payload, invalid: false };
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      return { payload: null, invalid: false };
    }

    clearAuthCookies(res);

    return { payload: null, invalid: true };
  }
}
