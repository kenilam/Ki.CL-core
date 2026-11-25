import { notify, notifyWatchers, text } from 'server/DataSources/Notifications/notify.js';
import { TaxonVisualStatus } from 'server/Types/graphql.js';
import { TreeOfLifeNodes } from './Model.js';

const PLATES = TreeOfLifeNodes.collection.collectionName;

function settled(status: TaxonVisualStatus) {
  return text('plate', { context: status === TaxonVisualStatus.Ready ? 'ready' : 'failed' });
}

/**
 * A visitor waiting on a plate. If it settled before this notice, the
 * visitor is told at once, a moment later so the settled step wins.
 */
export async function waitForPlate(ownerGUID: string, nodeId: string, name: string): Promise<void> {
  const title = text('notification_title', { title: name });
  const at = new Date();

  await notify(ownerGUID, PLATES, nodeId, { title, message: text('plate', { context: 'drawing' }) }, at);

  const node = await TreeOfLifeNodes.findOne({ nodeId }).select('visualStatus').lean();
  const status = node?.visualStatus as TaxonVisualStatus | undefined;

  if (status && status !== TaxonVisualStatus.Pending) {
    await notify(ownerGUID, PLATES, nodeId, { title, message: settled(status) }, new Date(at.getTime() + 1));
  }
}

/** Everyone waiting on the plate, whoever they are. */
export async function settlePlate(nodeId: string, status: TaxonVisualStatus): Promise<void> {
  const node = await TreeOfLifeNodes.findOne({ nodeId }).select('name').lean();

  await notifyWatchers(PLATES, nodeId, {
    title: text('notification_title', { title: node?.name ?? nodeId }),
    message: settled(status),
  });
}
