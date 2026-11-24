import { Unauthenticated } from 'server/Errors/index.js';
import type { Context } from 'server/Context/index.js';
import { translate } from 'server/Helpers/translate.js';
import { parseCookies } from 'server/Helpers/auth.js';
import * as session from 'server/Helpers/session.js';

export default {
  Mutation: {
    refreshToken: async (_: unknown, __: unknown, context: Context) => {
      const token = parseCookies(context.headers['cookie'] as string | undefined).refresh_token;

      if (!token) {
        throw Unauthenticated(translate('api', 'error_refresh_token_missing'));
      }

      if (!(await session.renew(context.res, token))) {
        throw Unauthenticated(translate('api', 'error_refresh_token_invalid'));
      }

      return true;
    },
  },
};
