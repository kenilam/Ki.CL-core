import { notify, notifyWatchers, text } from 'server/DataSources/Notifications/notify.js';
import { Swatches } from 'server/DataSources/MongoDB/Swatches/Model.js';
import { SwatchStage, SwatchStatus } from 'server/Types/graphql.js';
import { nameFor } from './name.js';
import type { SwatchResult } from './result.js';

const SWATCHES = Swatches.collection.collectionName;

function messageOf({ failure, stage, status }: SwatchResult) {
  if (status === SwatchStatus.Failed) {
    return text('api:swatch_error', { context: failure ?? 'unavailable' });
  }

  if (status === SwatchStatus.Ready) {
    return text('swatch', { context: 'ready' });
  }

  return text('swatch', { context: (stage ?? SwatchStage.Naming).toLowerCase() });
}

function titleOf(swatch: SwatchResult) {
  const name = nameFor(swatch);

  return name ? text('notification_title', { title: name }) : text('experiment', { context: 'swatch' });
}

// A shared colour picked while it's being made has several visitors waiting; the notifications service knows who.
export async function notifySwatch(swatch: SwatchResult): Promise<void> {
  const words = { title: titleOf(swatch), message: messageOf(swatch) };
  const at = new Date();

  await notifyWatchers(SWATCHES, swatch.id, words, at);

  if (swatch.startedBy) {
    await notify(swatch.startedBy, SWATCHES, swatch.id, words, at);
  }
}

export async function joinSwatch(ownerGUID: string, swatch: SwatchResult): Promise<void> {
  await notify(ownerGUID, SWATCHES, swatch.id, { title: titleOf(swatch), message: messageOf(swatch) });
}
