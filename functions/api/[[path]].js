// Any other /api/* path: JSON 404 instead of falling through to the static site.

import { error } from '../_lib/http.js';

export function onRequest() {
  return error(404, 'not found');
}
