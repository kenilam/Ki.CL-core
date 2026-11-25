import * as pubsub from '@google-cloud/pubsub';

/**
 * Tells the notifications service (Ki.CL-notifications) that work moved on.
 * Each step is published to its Pub/Sub topic, and core never reads or
 * writes the notifications itself. A step describes itself: the page it
 * links to, how it looks, whether it is still running, and its words as keys
 * in the namespace that holds them.
 */

type Level = 'neutral' | 'confirm' | 'error' | 'info' | 'warning';

export interface NotificationText {
  key: string;
  values: Record<string, unknown>;
}

interface Words {
  title: NotificationText;
  message: NotificationText;
}

const TOPIC = process.env.NOTIFICATIONS_TOPIC;
const LOCAL_URL = process.env.NOTIFICATIONS_URL;

const PATHS: Record<string, (id: string) => string> = {
  image_agent_threads: (id) => `/experiments/image-agent/${id}`,
  kinetic_light_readings: (id) => `/experiments/kinetic-light/${id}`,
  password_changes: () => '/me/password',
  swatches: (id) => `/experiments/swatch/${id}`,
  tree_of_life: (id) => `/experiments/tree-of-life/${id}/details`,
};

const RUNNING = { level: 'info', running: true } as const;
const FAILED = { level: 'error', running: false } as const;
const READY = { level: 'confirm', running: false } as const;

/** How each message looks, by its key and then by the key with its context. */
const LOOKS: Record<string, { level: Level; running: boolean }> = {
  'agent_reply_failure': FAILED,
  'agent_reply_question': { level: 'info', running: false },
  'agent_reply_refusal': { level: 'warning', running: false },
  'agent_reply_running': RUNNING,
  'agent_reply_text': { level: 'info', running: false },
  'api:kinetic_light_error': FAILED,
  'api:swatch_error': FAILED,
  'found_chords': RUNNING,
  'found_notes': RUNNING,
  'password_change_done': READY,
  'password_change_failed': FAILED,
  'password_change_waiting': { level: 'info', running: false },
  'picture_ready': READY,
  'plate_drawing': RUNNING,
  'plate_failed': FAILED,
  'plate_ready': READY,
  'progress_chords': RUNNING,
  'progress_notes': RUNNING,
  'ready_to_play': READY,
  'status_running': RUNNING,
  'swatch_animating': RUNNING,
  'swatch_drawing': RUNNING,
  'swatch_naming': RUNNING,
  'swatch_ready': READY,
};

let topic: pubsub.Topic | undefined;

export function text(key: string, values: Record<string, unknown> = {}): NotificationText {
  return { key, values };
}

async function send(notice: Record<string, unknown>): Promise<void> {
  try {
    if (TOPIC) {
      topic ??= new pubsub.PubSub().topic(TOPIC);
      await topic.publishMessage({ json: notice });
      return;
    }

    // Local work: the same request Pub/Sub would push, straight to a local service.
    if (LOCAL_URL) {
      await fetch(`${LOCAL_URL}/internal/notices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify(notice)).toString('base64') } }),
      });
    }
  } catch (error) {
    console.error('[Notifications] could not send a notice', error);
  }
}

function step(collection: string, documentId: string, { title, message }: Words, at: Date) {
  const look = LOOKS[`${message.key}_${String(message.values.context)}`] ?? LOOKS[message.key] ?? {
    level: 'neutral',
    running: false,
  };

  return {
    source: `${collection}/${documentId}`,
    at: at.toISOString(),
    path: PATHS[collection]?.(documentId) ?? '/',
    ...look,
    // Core's words are in the host's `common`; an `api:` key names core's own namespace, which i18next resolves.
    namespace: 'common',
    title,
    message,
  };
}

/** One visitor's notification for one record. */
export async function notify(
  ownerGUID: string,
  collection: string,
  documentId: string,
  words: Words,
  at = new Date(),
): Promise<void> {
  await send({ owner: ownerGUID, ...step(collection, documentId, words, at) });
}

/** Everyone already waiting on a record, without core knowing who they are. */
export async function notifyWatchers(collection: string, documentId: string, words: Words, at = new Date()): Promise<void> {
  await send(step(collection, documentId, words, at));
}

/** Removes every notification of a deleted account. */
export async function forget(ownerGUID: string): Promise<void> {
  await send({ owner: ownerGUID, forget: true });
}
