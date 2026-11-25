import { withFilter } from 'graphql-subscriptions';

import type { Context } from 'server/Context/index.js';
import { anyProviderAvailable } from 'server/DataSources/AI/failover.js';
import { buildImageProviders } from 'server/DataSources/AI/image/index.js';
import { waitForPlate } from 'server/DataSources/MongoDB/TreeOfLife/plates.js';
import { claimPlate, plateClaimed } from 'server/DataSources/MongoDB/TreeOfLife/claim.js';
import { TreeOfLifeNodes } from 'server/DataSources/MongoDB/TreeOfLife/Model.js';
import { ensureTreeOfLifeNodeByOttId } from 'server/DataSources/MongoDB/TreeOfLife/persist.js';
import { validate } from 'server/Helpers/Validation/validate.js';
import { startingWith } from 'server/Helpers/startingWith.js';
import { TaxonVisualStatus } from 'server/Types/graphql.js';
import { taxonVisualObjectExists } from './generateImage.js';
import { TAXON_VISUAL_UPDATED, taxonVisualPubSub } from './pubsub.js';
import { toResult, toVisualScore } from './result.js';
import { startPlate } from './task.js';
import type { TaxonVisualResult } from './types.js';
import { TaxonVisualSchema } from './validation.js';

/**
 * How many plates a taxon gets before the best one stands.
 *
 * Some taxa the generator cannot draw - a rod-shaped bacterium keeps returning
 * as an insect however the prompt is tightened - and without a ceiling those
 * retry on every view for as long as the score stays low.
 */
const MAX_VISUAL_ATTEMPTS = 3;

const SETTLED: TaxonVisualStatus[] = [
  TaxonVisualStatus.Ready,
  TaxonVisualStatus.Error,
  TaxonVisualStatus.Exhausted,
];

async function resolveNode(ottId: number, name: string, rank: string | null) {
  let existing = await TreeOfLifeNodes.findOne({ ottId }).lean();
  if (!existing) {
    await ensureTreeOfLifeNodeByOttId(ottId);
    existing = await TreeOfLifeNodes.findOne({ ottId }).lean();
  }

  if (!existing) {
    const nodeId = `ott:${ottId}`;
    await TreeOfLifeNodes.findOneAndUpdate(
      { ottId },
      {
        $setOnInsert: {
          nodeId,
          ottId,
          name,
          rank,
          description: null,
          visualStatus: null,
          visualScore: null,
          prompt: null,
          error: null,
          assetId: null,
          numTips: null,
        },
      },
      { upsert: true },
    );
    existing = await TreeOfLifeNodes.findOne({ ottId }).lean();
  }

  return existing;
}

export default {
  Query: {
    taxonVisual: async (
      _: unknown,
      args: { ottId: number; name: string; rank?: string | null },
      context: Context,
    ): Promise<TaxonVisualResult> => {
      const input = validate(TaxonVisualSchema, args);
      const ottId = input.ottId;
      const name = input.name.trim();
      const rank = input.rank?.trim() || null;

      const existing = await resolveNode(ottId, name, rank);
      if (!existing) {
        throw new Error(`Failed to resolve TreeOfLife node for ottId ${ottId}`);
      }

      const nodeId = existing.nodeId;
      const status = existing.visualStatus;
      const resolvedName = existing.name?.trim() || name;
      const resolvedRank = existing.rank?.trim() || rank;

      const owner = context.tokenPayload?.userGUID;
      const wait = () => (owner ? waitForPlate(owner, nodeId, resolvedName) : Promise.resolve());

      // A plate whose run died lets go of its claim, and is drawn again below.
      if (status === TaxonVisualStatus.Pending && plateClaimed(existing)) {
        await wait();

        return toResult({
          ottId,
          nodeId,
          description: existing.description,
          assetId: existing.assetId,
          status: TaxonVisualStatus.Pending,
        });
      }

      if (status === TaxonVisualStatus.Ready && existing.assetId) {
        const inBucket = await taxonVisualObjectExists(ottId);
        if (inBucket) {
          const assetId = String(existing.assetId);

          /*
           * A plate the reviewer passed is finished, whoever drew it. One that
           * failed - or that no reviewer ever saw - is worth another attempt,
           * up to a ceiling.
           */
          const reviewed = existing.visualScore ?? null;
          const settled = reviewed?.pass === true;
          const spent = (existing.visualAttempts ?? 0) >= MAX_VISUAL_ATTEMPTS;

          if (settled || spent) {
            if (!existing.description?.trim() && await claimPlate(ottId)) {
              await startPlate({
                step: 'describe',
                ottId,
                nodeId,
                name: resolvedName,
                rank: resolvedRank,
                assetId,
              });
            }
            return toResult({
              ottId,
              nodeId,
              assetId,
              description: existing.description,
              visualScore: toVisualScore(reviewed),
              status: TaxonVisualStatus.Ready,
            });
          }

          if (await claimPlate(ottId)) {
            await startPlate({
              step: 'regenerate',
              ottId,
              nodeId,
              name: resolvedName,
              rank: resolvedRank,
              assetId,
              previousDescription: existing.description ?? null,
            });
          }

          /*
           * `READY`, not `PENDING`: there is a usable plate on screen right
           * now, and calling it pending told the client to show a spinner over
           * an image it already had - usually for a replacement that never
           * arrived. If the attempt does produce something better, the
           * subscription pushes it.
           */
          return toResult({
            ottId,
            nodeId,
            assetId,
            description: existing.description,
            visualScore: toVisualScore(reviewed),
            status: TaxonVisualStatus.Ready,
          });
        }
      } else if (status === TaxonVisualStatus.Error) {
        return toResult({
          ...existing,
          ottId,
          assetId: null,
          status,
        });
      } else if (status === TaxonVisualStatus.Exhausted) {
        // Sticky only while every image provider is cooling down; otherwise retry.
        if (!anyProviderAvailable(buildImageProviders(''))) {
          return toResult({
            ...existing,
            ottId,
            assetId: null,
            status,
          });
        }
        // Fall through to clear status and re-run full pipeline.
      }

      const claimed = await claimPlate(ottId, {
        $set: {
          name: resolvedName,
          rank: resolvedRank,
          description: null,
          visualStatus: TaxonVisualStatus.Pending,
          visualScore: null,
          error: null,
        },
        $unset: { assetId: 1, imageUrl: 1 },
      });

      await wait();

      // Another request took the plate a moment ago, and its run will tell this visitor too.
      if (claimed) {
        await startPlate({ step: 'generate', ottId, nodeId, name: resolvedName, rank: resolvedRank });
      }

      return {
        status: TaxonVisualStatus.Pending,
        ottId,
        nodeId,
        assetId: null,
        description: null,
        visualScore: null,
        // Generation has just been started, so nothing is exhausted yet.
        exhaustion: null,
      };
    },
  },

  Subscription: {
    taxonVisualUpdated: {
      subscribe: (_parent: unknown, args: { ottId: number }, context?: Context) => startingWith(
        withFilter(
          () => taxonVisualPubSub.asyncIterableIterator(TAXON_VISUAL_UPDATED),
          (
            payload: { taxonVisualUpdated?: TaxonVisualResult } | undefined,
            variables: { ottId?: number } | undefined,
          ) => payload?.taxonVisualUpdated?.ottId === variables?.ottId,
        )(undefined, args, context),
        async () => {
          const doc = await TreeOfLifeNodes.findOne({ ottId: args.ottId }).lean();
          const status = doc?.visualStatus;

          return doc && status && SETTLED.includes(status)
            ? [{ taxonVisualUpdated: toResult({ ...doc, ottId: args.ottId, status }) }]
            : [];
        },
      ),
    },
  },
};
