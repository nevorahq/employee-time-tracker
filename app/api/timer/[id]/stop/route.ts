import { getContainer } from '@/server/container';
import { timerHandlers } from '@/server/handlers/timer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: RouteContext<'/api/timer/[id]/stop'>) {
  const { id } = await ctx.params;
  return timerHandlers(getContainer()).stop(req, id);
}
