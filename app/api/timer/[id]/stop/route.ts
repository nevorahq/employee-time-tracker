import { timerHandlers } from '@/server/handlers/timer';
import { route } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stop = route((c) => timerHandlers(c).stop);

export async function POST(req: Request, ctx: RouteContext<'/api/timer/[id]/stop'>) {
  const { id } = await ctx.params;
  return stop(req, id);
}
