import { timeEntryHandlers } from '@/server/handlers/timeEntries';
import { route } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route((c) => timeEntryHandlers(c).list);
