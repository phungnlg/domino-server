import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../lib/middleware';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const supabase = getSupabase();

  // Fetch rooms that are waiting for players
  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, code, status, max_score, created_at')
    .eq('status', 'waiting')
    .order('created_at', { ascending: false });

  if (roomsError) {
    return errorResponse(res, `Failed to fetch rooms: ${roomsError.message}`, 500);
  }

  if (!rooms || rooms.length === 0) {
    return successResponse(res, { rooms: [] });
  }

  // Fetch player counts for each room
  const roomIds = rooms.map(r => r.id);
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('room_id')
    .in('room_id', roomIds);

  if (playersError) {
    return errorResponse(res, `Failed to fetch players: ${playersError.message}`, 500);
  }

  // Count players per room
  const playerCounts: Record<string, number> = {};
  for (const player of players || []) {
    playerCounts[player.room_id] = (playerCounts[player.room_id] || 0) + 1;
  }

  const roomList = rooms.map(room => ({
    id: room.id,
    code: room.code,
    status: room.status,
    maxScore: room.max_score,
    playerCount: playerCounts[room.id] || 0,
    createdAt: room.created_at,
  }));

  successResponse(res, { rooms: roomList });
}

export default withCors(handler);
