import { createHmac, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { renderOrder } from './formats.js';
import type { StoredOrder } from './store.js';

export function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/**
 * Sends "order created" to MarketHub, signed with HMAC-SHA256 over the raw body.
 * Like real marketplaces, it retries on failure and sometimes delivers the same event twice.
 */
export async function deliverOrderWebhook(order: StoredOrder): Promise<void> {
  const eventId = randomUUID();
  const body = JSON.stringify({ type: 'order.created', order: renderOrder(order) });
  const deliveries = Math.random() < config.duplicateWebhookRate ? 2 : 1;

  for (let delivery = 0; delivery < deliveries; delivery++) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(`${config.apiUrl}/api/webhooks/${order.marketplace}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-event-id': eventId,
            'x-markethub-signature': sign(body, config.webhookSecret),
          },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok || response.status < 500) {
          console.log(`webhook ${order.marketplace} ${order.id} -> ${response.status}${delivery ? ' (duplicate)' : ''}`);
          break;
        }
      } catch (error) {
        console.warn(`webhook ${order.marketplace} ${order.id} attempt ${attempt} failed: ${String(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}
