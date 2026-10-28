import { healthHandlers } from '@/server/handlers/health';
import { route } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route((c) => healthHandlers(c).check);
