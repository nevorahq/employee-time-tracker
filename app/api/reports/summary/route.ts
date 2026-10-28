import { reportHandlers } from '@/server/handlers/reports';
import { route } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route((c) => reportHandlers(c).summary);
