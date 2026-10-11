// Worker entry (wrangler.toml `main`). The router, the page head and the DEV_USER guard are in app.js.
import { worker } from './app.js';

export default worker;
