import { timerHandlers } from '@/server/handlers/timer';
import { route } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route((c) => timerHandlers(c).active);
