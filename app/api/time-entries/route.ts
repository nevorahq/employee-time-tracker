import { getContainer } from '@/server/container';
import { timeEntryHandlers } from '@/server/handlers/timeEntries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: Request) => timeEntryHandlers(getContainer()).list(req);
