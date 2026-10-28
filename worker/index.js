// Worker entry (wrangler.toml `main`). The router, the page head and the DEV_USER guard are in app.js.
import { worker } from './app.js';

export default worker;
// the live-sync Durable Object (wrangler.toml [[durable_objects.bindings]] LIVE); its own file so node can import app.js
export { LiveHub } from './live.js';
