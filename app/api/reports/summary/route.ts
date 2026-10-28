import { getContainer } from '@/server/container';
import { reportHandlers } from '@/server/handlers/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: Request) => reportHandlers(getContainer()).summary(req);
