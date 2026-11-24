import type { IncomingMessage } from 'node:http';
import {
  GraphQLError,
  NoSchemaIntrospectionCustomRule,
  specifiedRules,
  validate as graphqlValidate,
} from 'graphql';

import { Unauthenticated } from 'server/Errors/index.js';
import * as accessTokens from './accessTokens.js';
import { parseCookies, validateApiKey } from './auth.js';
import {
  isAuthOperation,
  isIntrospectionRequest,
  isWhitelistedRequest,
  OPERATION_PREFIX,
} from './graphqlOperations.js';

export interface WsCredentials {
  accessToken?: string;
  apiKey?: string;
  cookieHeader?: string;
}

/**
 * The credentials a WebSocket client sends. A browser puts them in the Cookie
 * header of the upgrade request; a non-browser client may send them in
 * connectionParams instead, so both are read.
 */
export function readWsCredentials(args: {
  connectionParams?: Readonly<Record<string, unknown>> | undefined;
  request?: IncomingMessage | undefined;
}): WsCredentials {
  const { connectionParams, request } = args;

  const headerCookie =
    typeof request?.headers.cookie === 'string' ? request.headers.cookie : undefined;
  const paramCookie =
    typeof connectionParams?.cookie === 'string'
      ? connectionParams.cookie
      : typeof connectionParams?.Cookie === 'string'
        ? connectionParams.Cookie
        : undefined;
  const cookieHeader = headerCookie || paramCookie;
  const cookies = parseCookies(cookieHeader);

  const param = (key: string): string | undefined =>
    typeof connectionParams?.[key] === 'string' ? (connectionParams[key] as string) : undefined;

  return {
    accessToken: cookies.access_token || param('access_token'),
    apiKey: cookies['x-api-key'] || param('x-api-key') || param('apiKey'),
    cookieHeader,
  };
}

/**
 * Validation for the WebSocket transport. graphql-ws runs operations against
 * the schema directly, so it does not honor Apollo Server's introspection
 * setting the way the HTTP path does. This adds the introspection-blocking
 * rule when GRAPHQL_INTROSPECTION is off, so __schema and __type are refused
 * over the socket exactly as they are over HTTP. __typename is still allowed.
 */
export const wsValidate: typeof graphqlValidate = (schema, documentAST, rules, options) =>
  graphqlValidate(
    schema,
    documentAST,
    rules ??
      (process.env.GRAPHQL_INTROSPECTION === 'true'
        ? specifiedRules
        : [...specifiedRules, NoSchemaIntrospectionCustomRule]),
    options,
  );

/**
 * Whether a WebSocket operation may run. This applies the authenticate
 * middleware's rule on the subscription transport, which the upgrade bypasses:
 * introspection is left to wsValidate; every other operation needs the kicl_
 * prefix and a session, the same requirement HTTP enforces. Returns the errors
 * to reject with, or null to allow.
 */
export async function authorizeWsOperation(
  credentials: WsCredentials,
  payload: { operationName?: string | null; query?: string },
): Promise<readonly GraphQLError[] | null> {
  if (isIntrospectionRequest(payload)) return null;

  const { operationName } = payload;
  if (!operationName || !operationName.startsWith(OPERATION_PREFIX)) {
    return [Unauthenticated()];
  }

  if (isWhitelistedRequest(payload) || isAuthOperation(payload)) {
    return credentials.apiKey && validateApiKey(credentials.apiKey) ? null : [Unauthenticated()];
  }

  return (await accessTokens.read(credentials.accessToken, null)).payload ? null : [Unauthenticated()];
}
