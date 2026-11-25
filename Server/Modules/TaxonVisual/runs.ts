import { Types } from 'mongoose';

import { ProviderLimitError } from 'server/DataSources/AI/providerLimitError.js';
import { releasePlate } from 'server/DataSources/MongoDB/TreeOfLife/claim.js';
import { TreeOfLifeNodes } from 'server/DataSources/MongoDB/TreeOfLife/Model.js';
import { settlePlate } from 'server/DataSources/MongoDB/TreeOfLife/plates.js';
import { TaxonVisualExhaustion, TaxonVisualStatus } from 'server/Types/graphql.js';
import { generateTaxonDescription } from './generateDescription.js';
import { runTaxonVisualPipeline } from './pipeline.js';
import { buildTaxonDescriptionPrompt } from './prompt.js';
import { publishTaxonVisualUpdated } from './pubsub.js';
import { isQuotaMessage, toResult, toVisualScore } from './result.js';

// Each run holds the plate's claim (TreeOfLife/claim.ts) and lets go when it ends.

/**
 * Whether waiting will help, when generation ran out of quota.
 *
 * Only `BILLING` when every provider is out of credit - one allowance that
 * refills tomorrow is reason enough to wait, and saying otherwise would send
 * someone to a billing page they do not need.
 */
function exhaustionKind(error: unknown): TaxonVisualExhaustion | null {
  if (!(error instanceof ProviderLimitError)) {
    return null;
  }

  return error.needsBilling ? TaxonVisualExhaustion.Billing : TaxonVisualExhaustion.Refills;
}

function failureStatus(error: unknown): TaxonVisualStatus.Error | TaxonVisualStatus.Exhausted {
  if (error instanceof ProviderLimitError) {
    return TaxonVisualStatus.Exhausted;
  }
  const message = error instanceof Error ? error.message : String(error);
  return isQuotaMessage(message) ? TaxonVisualStatus.Exhausted : TaxonVisualStatus.Error;
}

export async function runGeneration(
  ottId: number,
  nodeId: string,
  name: string,
  rank: string | null,
) {

  try {
    const {
      assetId,
      prompt,
      description,
      imageAttempts,
      imageScore,
    } = await runTaxonVisualPipeline(ottId, name, rank);

    /*
     * Only a real review is stored. `scored: false` means no provider ever
     * looked at the image, and writing numbers for that would put an
     * unreviewed plate on record as a reviewed one - which is exactly how a
     * whole library of them came to look approved.
     */
    const visualScore = toVisualScore(
      imageScore?.scored
        ? {
            overall: imageScore.overall,
            taxonMatch: imageScore.taxon_match,
            pass: imageScore.pass,
          }
        : null,
    );

    console.log(
      `[TaxonVisual] pipeline ready ottId=${ottId} attempts=${imageAttempts} `
      + `score=${imageScore?.overall ?? 'n/a'} pass=${imageScore?.pass ?? 'n/a'}`,
    );

    await TreeOfLifeNodes.findOneAndUpdate(
      { ottId },
      {
        $set: {
          nodeId,
          name,
          rank,
          prompt,
          description,
          assetId: new Types.ObjectId(assetId),
          visualStatus: TaxonVisualStatus.Ready,
          visualScore,
          error: null,
        },
        $unset: { imageUrl: 1 },
      },
    );
    publishTaxonVisualUpdated(toResult({
      ottId,
      nodeId,
      description,
      assetId,
      visualScore,
      status: TaxonVisualStatus.Ready,
    }));
    await settlePlate(nodeId, TaxonVisualStatus.Ready);
  } catch (error) {
    const status = failureStatus(error);
    const message = error instanceof Error ? error.message : 'Image generation failed';
    await TreeOfLifeNodes.findOneAndUpdate(
      { ottId },
      {
        $set: {
          nodeId,
          name,
          rank,
          description: null,
          visualStatus: status,
          visualScore: null,
          visualExhaustion: exhaustionKind(error),
          error: message,
        },
        $unset: { assetId: 1, imageUrl: 1 },
      },
    );
    publishTaxonVisualUpdated(toResult({
      ottId,
      nodeId,
      description: null,
      assetId: null,
      visualScore: null,
      status,
      error: message,
    }));
    await settlePlate(nodeId, status);
  } finally {
    await releasePlate(ottId);
  }
}

export async function runDescriptionOnly(
  ottId: number,
  nodeId: string,
  name: string,
  rank: string | null,
  assetId: string,
) {

  try {
    const description = await generateTaxonDescription(
      buildTaxonDescriptionPrompt(name, rank),
    );
    await TreeOfLifeNodes.findOneAndUpdate(
      { ottId },
      { $set: { description } },
    );
    publishTaxonVisualUpdated(toResult({
      ottId,
      nodeId,
      description,
      assetId,
      status: TaxonVisualStatus.Ready,
    }));
  } catch {
    // Image already READY - keep it; description stays null.
  } finally {
    await releasePlate(ottId);
  }
}

/**
 * Failover asset is provisional: try OpenAI only. On success, replace the
 * asset; on failure, keep the existing failover render.
 */
/**
 * Try again for a plate the reviewer rejected.
 *
 * Was gated on the generator's name: anything not from OpenAI counted as
 * provisional and was re-rendered on every view, forever. That was a stand-in
 * for quality, chosen when the only score available was a fabricated 7 - and a
 * poor one, since it retried good renders as hard as bad ones and stopped
 * retrying a bad OpenAI render entirely. The review score says the thing the
 * vendor name was guessing at, so it is what decides now.
 *
 * The whole chain is used rather than OpenAI alone, so this still works when
 * the preferred provider is out of credit.
 */
export async function runRegeneration(
  ottId: number,
  nodeId: string,
  name: string,
  rank: string | null,
  previousAssetId: string,
  previousDescription: string | null,
) {

  try {
    const {
      assetId,
      prompt,
      description,
      imageScore,
    } = await runTaxonVisualPipeline(ottId, name, rank);

    /*
     * Only a real review is stored. `scored: false` means no provider ever
     * looked at the image, and writing numbers for that would put an
     * unreviewed plate on record as a reviewed one - which is exactly how a
     * whole library of them came to look approved.
     */
    const visualScore = toVisualScore(
      imageScore?.scored
        ? {
            overall: imageScore.overall,
            taxonMatch: imageScore.taxon_match,
            pass: imageScore.pass,
          }
        : null,
    );

    await TreeOfLifeNodes.findOneAndUpdate(
      { ottId },
      {
        $set: {
          nodeId,
          name,
          rank,
          prompt,
          description: description ?? previousDescription,
          assetId: new Types.ObjectId(assetId),
          visualStatus: TaxonVisualStatus.Ready,
          visualScore,
          error: null,
        },
        $inc: { visualAttempts: 1 },
      },
    );
    publishTaxonVisualUpdated(toResult({
      ottId,
      nodeId,
      description: description ?? previousDescription,
      assetId,
      visualScore,
      status: TaxonVisualStatus.Ready,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    /*
     * A failed attempt counts only if something was actually drawn.
     *
     * The ceiling exists to stop retrying a taxon the generator cannot render
     * well - it is a statement about the subject, not about the weather. When
     * every provider is out of quota nothing was attempted at all, and counting
     * that would retire taxa for the duration of an outage and never let them
     * back. Measured: two of one taxon's three attempts were spent this way
     * before the exhaustion was even visible.
     */
    const nothingRendered = error instanceof ProviderLimitError
      || message.includes('exhausted quota')
      || message.includes('No image providers configured');

    if (!nothingRendered) {
      await TreeOfLifeNodes.updateOne({ ottId }, { $inc: { visualAttempts: 1 } });
    }

    console.warn(
      `[TaxonVisual] regeneration failed for ottId ${ottId}`
      + `${nothingRendered ? ' (providers unavailable - attempt not counted)' : ''};`
      + ` keeping existing asset:`,
      message,
    );
    publishTaxonVisualUpdated(toResult({
      ottId,
      nodeId,
      description: previousDescription,
      assetId: previousAssetId,
      status: TaxonVisualStatus.Ready,
    }));
  } finally {
    await releasePlate(ottId);
  }
}
