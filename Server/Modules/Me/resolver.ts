import { Users } from 'server/DataSources/MongoDB/Users/Model.js';
import { Unauthenticated } from 'server/Errors/index.js';
import type { Context } from 'server/Context/index.js';
import { translate } from 'server/Helpers/translate.js';

export default {
  Query: {
    me: async (_: unknown, __: unknown, context: Context) => {
      if (!context.tokenPayload) {
        throw Unauthenticated();
      }

      if (!context.user) {
        return {
          userGUID: context.tokenPayload.userGUID,
          email: null,
          firstName: null,
          lastName: null,
          avatar: null,
          active: false,
          aud: 'anon',
        };
      }

      const user = await Users.findOne(
        { userGUID: context.tokenPayload.userGUID, active: true },
        'userGUID email firstName lastName avatar active',
      );

      if (!user) {
        throw Unauthenticated(translate('api', 'error_user_not_found'));
      }

      return {
        userGUID: user.userGUID,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        active: user.active,
        aud: 'user',
      };
    },
  },
};
