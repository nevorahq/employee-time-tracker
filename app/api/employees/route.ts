import { getContainer } from '@/server/container';
import { employeeHandlers } from '@/server/handlers/employees';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: Request) => employeeHandlers(getContainer()).list(req);
export const POST = (req: Request) => employeeHandlers(getContainer()).create(req);
