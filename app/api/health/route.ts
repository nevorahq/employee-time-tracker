import { getContainer } from '@/server/container';
import { healthHandlers } from '@/server/handlers/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: Request) => healthHandlers(getContainer()).check(req);
