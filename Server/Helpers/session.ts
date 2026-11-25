import { createHash, randomBytes } from 'node:crypto';

import { Sessions, type ISession } from 'server/DataSources/MongoDB/Sessions/Model.js';
import * as accessTokens from './accessTokens.js';
import { getAccessTokenExpiry, getRefreshTokenExpiry } from './tokenExpiry.js';

type Kind = ISession['kind'];

export type Authorization =
  | { access_token: string; refresh_token: string; aud: Kind }
  | { revoke: true };

export const revoke: Authorization = { revoke: true };

const LEEWAY_MS = 30_000;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

const mint = () => randomBytes(32).toString('base64url');

async function issue(userGUID: string, kind: Kind, refreshToken: string): Promise<Authorization> {
  return {
    access_token: await accessTokens.sign({ sub: userGUID }, getAccessTokenExpiry()),
    refresh_token: refreshToken,
    aud: kind,
  };
}

export async function start(userGUID: string, kind: Kind): Promise<Authorization> {
  if (kind === 'user') {
    await Sessions.deleteMany({ userGUID });
  }

  const refreshToken = mint();

  await Sessions.create({ hash: digest(refreshToken), userGUID, kind, expiresAt: getRefreshTokenExpiry() });

  return issue(userGUID, kind, refreshToken);
}

export async function renew(refreshToken: string | undefined): Promise<Authorization | null> {
  if (!refreshToken) {
    return null;
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
    return null;
  }

  return issue(record.userGUID as string, record.kind as Kind, next);
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
