// GET /templates/versions.json: public remote config for the Grok Bot templates' weekly update check.
// Versions and changelog summaries only; no paid content.
import { versionsDoc } from '../../../store-core/versions.js';
export function GET() {
  return new Response(JSON.stringify(versionsDoc(), null, 2) + '\n', { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
