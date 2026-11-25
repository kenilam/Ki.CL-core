import bcrypt from 'bcrypt';
import { validate } from 'server/Helpers/Validation/validate.js';
import { SignInSchema } from './validation.js';
import { Users } from 'server/DataSources/MongoDB/Users/Model.js';
import * as session from 'server/Helpers/session.js';
import { BadUserInput, Forbidden } from 'server/Errors/index.js';
import type { Context } from 'server/Context/index.js';
import { translate } from 'server/Helpers/translate.js';

export default {
  Mutation: {
    signIn: async (_: unknown, args: { signIn: unknown }, context: Context) => {
      const input = validate(SignInSchema, args.signIn);

      const user = await Users.findOne(
        { email: input.email },
        'email password userGUID active',
      );

      if (!user) {
        throw BadUserInput(translate('api', 'error_credentials'));
      }

      if (!user.active) {
        throw Forbidden(translate('api', 'error_account_inactive'));
      }

      const isValidPassword = await bcrypt.compare(input.password, user.password);
      if (!isValidPassword) {
        throw BadUserInput(translate('api', 'error_credentials'));
      }

      context.authorization = await session.start(user.userGUID, 'user');

      return true;
    },
  },
};
