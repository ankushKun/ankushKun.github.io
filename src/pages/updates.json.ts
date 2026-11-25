// /updates.json: every page a returning visitor might not have seen yet, by section (src/lib/updates.ts). Fetched
// only when a page's hash differs from the one this browser last read (src/scripts/updates/store.ts).
import { getUpdates } from '../lib/updates';

export async function GET() {
  return new Response(JSON.stringify(await getUpdates()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
