import { employeeHandlers } from '@/server/handlers/employees';
import { route } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route((c) => employeeHandlers(c).list);
export const POST = route((c) => employeeHandlers(c).create);
