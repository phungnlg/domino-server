import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withCors, successResponse } from '../lib/middleware';

async function handler(_req: VercelRequest, res: VercelResponse) {
  successResponse(res, {
    status: 'ok',
    timestamp: Date.now(),
  });
}

export default withCors(handler);
