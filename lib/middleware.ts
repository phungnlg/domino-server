import type { VercelRequest, VercelResponse } from '@vercel/node';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Wraps an API handler with CORS headers and OPTIONS preflight handling.
 */
export function withCors(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void> | void
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    // Set CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    try {
      await handler(req, res);
    } catch (error) {
      console.error('Unhandled error:', error);
      const message =
        error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  };
}

/**
 * Standard error response helper.
 */
export function errorResponse(
  res: VercelResponse,
  message: string,
  status: number = 400
): void {
  res.status(status).json({ error: message });
}

/**
 * Standard success response helper.
 */
export function successResponse(
  res: VercelResponse,
  data: unknown,
  status: number = 200
): void {
  res.status(status).json({ data });
}
