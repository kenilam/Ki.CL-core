import type { IncomingMessage } from 'node:http';
import { NoSchemaIntrospectionCustomRule, specifiedRules, validate as graphqlValidate } from 'graphql';

import { parseCookies } from './cookies.js';

/**
 * A browser sends its cookies on the upgrade request; a client that can't sets
 * them in connectionParams instead.
 */
export function readWsCredentials(args: {
  connectionParams?: Readonly<Record<string, unknown>> | undefined;
  request?: IncomingMessage | undefined;
}): { accessToken?: string; cookieHeader?: string } {
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

  return { accessToken: parseCookies(cookieHeader).access_token, cookieHeader };
}

/**
 * graphql-ws runs operations against the schema directly, so it ignores Apollo
 * Server's introspection setting. This applies it on the socket too.
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
