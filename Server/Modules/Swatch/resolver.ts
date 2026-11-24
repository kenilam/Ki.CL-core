import { withFilter } from 'graphql-subscriptions';
import { mongo, Types } from 'mongoose';

import type { Context } from 'server/Context/index.js';
import { Swatches } from 'server/DataSources/MongoDB/Swatches/Model.js';
import {
  BadUserInput,
  TooManyRequests,
  Unauthenticated,
} from 'server/Errors/index.js';
import { translate } from 'server/Helpers/translate.js';
import { startingWith } from 'server/Helpers/startingWith.js';
import { validate } from 'server/Helpers/Validation/validate.js';
import { SwatchSource, SwatchStatus } from 'server/Types/graphql.js';
import { nameFor } from './name.js';
import { joinSwatch } from './notify.js';
import { SWATCH_UPDATED, swatchPubSub } from './pubsub.js';
import { allowanceFor, assertWithinQuota } from './quota.js';
import { recoverStalled } from './recover.js';
import { toResult, type SwatchResult } from './result.js';
import { pick, upload } from './start.js';
import { PickSchema, UploadSchema } from './validation.js';

const EXAMPLES = 5;
const LIST = 500;

function requireOwner(context: Context): string {
  const owner = context.tokenPayload?.userGUID;
  if (!owner) {
    throw Unauthenticated();
  }
  return owner;
}

// A second run for the same caller trips the one-at-a-time index.
function busyOnDuplicate(error: unknown): never {
  if (error instanceof mongo.MongoServerError && error.code === 11000) {
    throw TooManyRequests(translate('api', 'swatch_error_busy'));
  }
  throw error;
}

export default {
  Swatch: {
    name: (swatch: SwatchResult) => nameFor(swatch),
    failure: (swatch: SwatchResult) =>
      swatch.failure ? translate('api', 'swatch_error', { context: swatch.failure }) : null,
    mine: (swatch: SwatchResult, _: unknown, context: Context) =>
      Boolean(swatch.ownerGUID) && swatch.ownerGUID === context.tokenPayload?.userGUID,
  },
  Query: {
    swatch: async (_: unknown, args: { id: string }, context: Context) => {
      requireOwner(context);

      if (!Types.ObjectId.isValid(args.id)) {
        return null;
      }

      await recoverStalled({ _id: args.id });

      const swatch = await Swatches.findById(args.id).lean();

      return swatch ? toResult(swatch) : null;
    },
    swatchList: async (_: unknown, __: unknown, context: Context) => {
      requireOwner(context);

      const swatches = await Swatches
        .find({ status: SwatchStatus.Ready })
        .sort({ startedAt: -1 })
        .limit(LIST)
        .lean();

      return swatches.map(toResult);
    },
    swatches: async (_: unknown, __: unknown, context: Context) => {
      const owner = requireOwner(context);

      await recoverStalled({ startedBy: owner });

      const swatches = await Swatches.find({ ownerGUID: owner }).sort({ createdAt: -1 }).lean();

      return swatches.map(toResult);
    },
    swatchPicks: async (_: unknown, __: unknown, context: Context) => {
      requireOwner(context);

      const picks = await Swatches
        .find({ source: SwatchSource.Pick, status: { $ne: SwatchStatus.Failed } })
        .sort({ createdAt: 1 })
        .lean();

      return picks.map(toResult);
    },
    swatchExamples: async (_: unknown, __: unknown, context: Context) => {
      requireOwner(context);

      const examples = await Swatches
        .find({ example: true, status: SwatchStatus.Ready })
        .sort({ createdAt: 1 })
        .limit(EXAMPLES)
        .lean();

      return examples.map(toResult);
    },
    swatchAllowance: async (_: unknown, __: unknown, context: Context) => {
      const owner = requireOwner(context);

      await recoverStalled({ startedBy: owner });

      return allowanceFor(owner);
    },
  },
  Mutation: {
    swatchUpload: async (_: unknown, args: unknown, context: Context) => {
      const owner = requireOwner(context);

      await recoverStalled({ startedBy: owner });
      await assertWithinQuota(owner);

      const { file } = validate(UploadSchema, args);
      const bytes = Buffer.from(file.data, 'base64');

      if (bytes.length === 0) {
        throw BadUserInput(translate('api', 'swatch_error_empty'));
      }

      return upload(owner, bytes).catch(busyOnDuplicate);
    },
    swatchPick: async (_: unknown, args: unknown, context: Context) => {
      const owner = requireOwner(context);
      const { hex } = validate(PickSchema, args);

      await recoverStalled({ source: SwatchSource.Pick, hex });

      const existing = await Swatches.findOne({ source: SwatchSource.Pick, hex }).lean();

      if (existing && existing.status !== SwatchStatus.Failed) {
        if (existing.status === SwatchStatus.Making) {
          await joinSwatch(owner, toResult(existing));
        }

        return toResult(existing);
      }

      requireOwner(context);

      return pick(owner, hex, existing?._id ?? null).catch(busyOnDuplicate);
    },
  },
  Subscription: {
    swatchUpdated: {
      subscribe: (_parent: unknown, args: { id: string }, context?: Context) => startingWith(
        withFilter(
          (_parent, _args, context?: Context) => {
            if (!context) {
              throw Unauthenticated();
            }
            requireOwner(context);
            return swatchPubSub.asyncIterableIterator(SWATCH_UPDATED);
          },
          (payload: { swatchUpdated?: SwatchResult } | undefined, variables: { id?: string } | undefined) =>
            Boolean(payload?.swatchUpdated && payload.swatchUpdated.id === variables?.id),
        )(undefined, args, context),
        async () => {
          const swatch = Types.ObjectId.isValid(args.id) ? await Swatches.findById(args.id).lean() : null;

          return swatch ? [{ swatchUpdated: toResult(swatch) }] : [];
        },
      ),
    },
  },
};
