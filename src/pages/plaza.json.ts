// The plaza's data, for pages other than the home page: the plaza starts behind them when there is
// room for it, and loads this then. The home page carries the same data inline.
import { getPlazaData } from '../lib/plaza';

export async function GET() {
  return new Response(JSON.stringify(await getPlazaData()), {
    headers: { 'Content-Type': 'application/json' },
  });
}
