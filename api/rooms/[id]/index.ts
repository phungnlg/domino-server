import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../../lib/middleware';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return errorResponse(res, 'Room ID is required');
  }

  const supabase = getSupabase();

  // Fetch room
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', id)
    .single();

  if (roomError || !room) {
    return errorResponse(res, 'Room not found', 404);
  }

  // Fetch players in the room
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name, team, seat, is_bot, created_at')
    .eq('room_id', id)
    .order('seat', { ascending: true });

  if (playersError) {
    return errorResponse(res, `Failed to fetch players: ${playersError.message}`, 500);
  }

  successResponse(res, {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      maxScore: room.max_score,
      createdAt: room.created_at,
    },
    players: (players || []).map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      seat: p.seat,
      isBot: p.is_bot,
    })),
  });
}

export default withCors(handler);
