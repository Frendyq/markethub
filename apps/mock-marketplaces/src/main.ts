import { createApp, createOrder } from './app.js';
import { config, MARKETPLACES } from './config.js';
import { deliverOrderWebhook } from './webhooks.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`mock marketplaces on http://localhost:${config.port} (fail rate ${config.failRate})`);
});

// Customers buy now and then. Half of the orders come by webhook, the other half wait to be polled.
let timer: NodeJS.Timeout | undefined;
if (config.orderIntervalMs > 0) {
  timer = setInterval(() => {
    const marketplace = MARKETPLACES[Math.floor(Math.random() * MARKETPLACES.length)];
    const order = createOrder(marketplace, undefined, Math.random() < 0.8 ? 1 : 2);
    if (order && Math.random() < 0.5) {
      void deliverOrderWebhook(order);
    }
  }, config.orderIntervalMs);
}

function shutdown(): void {
  clearInterval(timer);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
