import type { ExpressContextFunctionArgument } from '@as-integrations/express5';
import type { Response } from 'express';
import type { IncomingMessage } from 'node:http';
import { Users, type IUser } from 'server/DataSources/MongoDB/Users/Model.js';
import { createAssetLoaders } from 'server/DataSources/MongoDB/Assets/loaders.js';
import { createTreeOfLifeLoaders } from 'server/DataSources/MongoDB/TreeOfLife/loaders.js';
import * as accessTokens from 'server/Helpers/accessTokens.js';
import type { Authorization } from 'server/Helpers/session.js';
import { readWsCredentials } from 'server/Helpers/websocket.js';

export type AuthenticatedUser = Pick<IUser, 'userGUID' | 'email' | 'active'>;

export interface Context {
  headers: Record<string, string | string[] | undefined>;
  /** Present for HTTP; absent for WebSocket. */
  res: Response | null;
  user: AuthenticatedUser | null;
  operationName: string | undefined;
  tokenPayload: { userGUID: string } | null;
  /** Sent to the gateway in the response's `extensions`, which sets the cookies from it. */
  authorization: Authorization | null;
  loaders: ReturnType<typeof createLoaders>;
}

function createLoaders() {
  return {
    treeOfLife: createTreeOfLifeLoaders(),
    asset: createAssetLoaders(),
  };
}

async function resolveUser(
  tokenPayload: Context['tokenPayload'],
): Promise<AuthenticatedUser | null> {
  if (!tokenPayload) return null;

  const userRecord = await Users.findOne(
    { userGUID: tokenPayload.userGUID, active: true },
    'userGUID email active',
  );

  if (!userRecord) return null;

  return {
    userGUID: userRecord.userGUID,
    email: userRecord.email,
    active: userRecord.active,
  };
}

function visitor(accessToken: string | undefined): Context['tokenPayload'] {
  const userGUID = accessTokens.subject(accessToken);

  return userGUID ? { userGUID } : null;
}

export async function createContext({ req, res }: ExpressContextFunctionArgument): Promise<Context> {
  const tokenPayload = visitor(req.cookies?.access_token);

  return {
    headers: req.headers as Record<string, string | string[] | undefined>,
    res: res as unknown as Response,
    user: await resolveUser(tokenPayload),
    operationName: req.body?.operationName,
    tokenPayload,
    authorization: null,
    loaders: createLoaders(),
  };
}

export async function createWsContext(args: {
  connectionParams?: Record<string, unknown> | undefined;
  request?: IncomingMessage;
}): Promise<Context> {
  const { accessToken, cookieHeader } = readWsCredentials(args);
  const tokenPayload = visitor(accessToken);

  const headers: Record<string, string | string[] | undefined> = {
    ...(args.request?.headers as Record<string, string | string[] | undefined>),
  };
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }

  return {
    headers,
    res: null,
    user: await resolveUser(tokenPayload),
    operationName: undefined,
    tokenPayload,
    authorization: null,
    loaders: createLoaders(),
  };
}
