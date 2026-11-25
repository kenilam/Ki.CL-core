import type { Context } from 'server/Context/index.js';
import { parseCookies } from 'server/Helpers/cookies.js';
import * as session from 'server/Helpers/session.js';

export default {
  Mutation: {
    signOut: async (_: unknown, __: unknown, context: Context) => {
      await session.end(parseCookies(context.headers['cookie'] as string | undefined).refresh_token);

      context.authorization = session.revoke;

      return true;
    },
  },
};
