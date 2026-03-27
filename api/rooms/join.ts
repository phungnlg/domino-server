import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../lib/middleware';

/**
 * Seat assignment: alternating teams for partner seating.
 * Seat 0: Team 1 (host)
 * Seat 1: Team 2
 * Seat 2: Team 1
 * Seat 3: Team 2
 */
function getTeamForSeat(seat: number): number {
  return seat % 2 === 0 ? 1 : 2;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const { code, playerName, userId } = req.body || {};

  if (!code || !playerName || !userId) {
    return errorResponse(res, 'code, playerName, and userId are required');
  }

  const supabase = getSupabase();

  // Look up room by code
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', code.toUpperCase())
    .single();

  if (roomError || !room) {
    return errorResponse(res, 'Room not found', 404);
  }

  if (room.status !== 'waiting') {
    return errorResponse(res, 'Room is no longer accepting players');
  }

  // Get existing players to determine seat
  const { data: existingPlayers, error: playersError } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', room.id)
    .order('seat', { ascending: true });

  if (playersError) {
    return errorResponse(res, `Failed to fetch players: ${playersError.message}`, 500);
  }

  const playerCount = existingPlayers?.length || 0;

  if (playerCount >= 4) {
    return errorResponse(res, 'Room is full (4 players max)');
  }

  // Check if user already joined
  const alreadyJoined = existingPlayers?.find(p => p.user_id === userId);
  if (alreadyJoined) {
    return errorResponse(res, 'You have already joined this room');
  }

  // Find the next available seat
  const takenSeats = new Set(existingPlayers?.map(p => p.seat) || []);
  let nextSeat = -1;
  for (let s = 0; s < 4; s++) {
    if (!takenSeats.has(s)) {
      nextSeat = s;
      break;
    }
  }

  if (nextSeat === -1) {
    return errorResponse(res, 'No available seats');
  }

  const team = getTeamForSeat(nextSeat);

  // Insert the player
  const { data: player, error: insertError } = await supabase
    .from('players')
    .insert({
      room_id: room.id,
      user_id: userId,
      name: playerName,
      team,
      seat: nextSeat,
      hand: [],
      is_bot: false,
    })
    .select()
    .single();

  if (insertError || !player) {
    return errorResponse(res, `Failed to join room: ${insertError?.message}`, 500);
  }

  // Fetch all players including the newly joined one
  const { data: allPlayers } = await supabase
    .from('players')
    .select('id, name, team, seat')
    .eq('room_id', room.id)
    .order('seat', { ascending: true });

  successResponse(res, {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      players: allPlayers || [],
    },
    player: {
      id: player.id,
      name: player.name,
      team: player.team,
      seat: player.seat,
    },
  });
}

export default withCors(handler);
