import { getContainer } from '@/server/container';
import { timerHandlers } from '@/server/handlers/timer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req: Request) => timerHandlers(getContainer()).start(req);
