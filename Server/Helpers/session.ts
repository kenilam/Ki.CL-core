import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';

import { Sessions, type ISession } from 'server/DataSources/MongoDB/Sessions/Model.js';
import * as accessTokens from './accessTokens.js';
import { setAccessTokenCookie, setAudCookie, setRefreshTokenCookie } from './cookies.js';
import { getAccessTokenExpiry, getRefreshTokenExpiry } from './tokenExpiry.js';

type Kind = ISession['kind'];

const LEEWAY_MS = 30_000;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

const mint = () => randomBytes(32).toString('base64url');

async function issue(res: Response | null, userGUID: string, kind: Kind, refreshToken: string): Promise<void> {
  setAccessTokenCookie(res, await accessTokens.sign({ sub: userGUID }, getAccessTokenExpiry()));
  setRefreshTokenCookie(res, refreshToken);
  setAudCookie(res, kind);
}

export async function start(res: Response | null, userGUID: string, kind: Kind): Promise<void> {
  if (kind === 'user') {
    await Sessions.deleteMany({ userGUID });
  }

  const refreshToken = mint();

  await Sessions.create({ hash: digest(refreshToken), userGUID, kind, expiresAt: getRefreshTokenExpiry() });
  await issue(res, userGUID, kind, refreshToken);
}

export async function renew(res: Response | null, refreshToken: string | undefined): Promise<boolean> {
  if (!refreshToken) {
    return false;
  }

  const now = new Date();
  const hash = digest(refreshToken);
  const next = mint();

  const record = await Sessions.collection.findOneAndUpdate(
    {
      $or: [{ hash }, { previousHash: hash, rotatedAt: { $gt: new Date(now.getTime() - LEEWAY_MS) } }],
      expiresAt: { $gt: now },
    },
    [{ $set: { previousHash: '$hash', hash: digest(next), rotatedAt: now, expiresAt: getRefreshTokenExpiry(now) } }],
    { returnDocument: 'after' },
  );

  if (!record) {
    return false;
  }

  await issue(res, record.userGUID as string, record.kind as Kind, next);

  return true;
}

export async function end(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) {
    return;
  }

  await Sessions.deleteOne({ hash: digest(refreshToken) });
}

export async function endAll(userGUID: string): Promise<void> {
  await Sessions.deleteMany({ userGUID });
}
