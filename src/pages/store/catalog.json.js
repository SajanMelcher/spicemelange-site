import { catalogDoc } from '../../../store-core/agent-store.js';
export const prerender = true;
export function GET() {
  return new Response(JSON.stringify(catalogDoc(), null, 2) + '\n', { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
