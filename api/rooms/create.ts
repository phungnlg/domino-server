import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../lib/middleware';

/**
 * Generate a random 6-character uppercase room code.
 */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const { hostName, userId } = req.body || {};

  if (!hostName || !userId) {
    return errorResponse(res, 'hostName and userId are required');
  }

  const supabase = getSupabase();

  // Generate a unique room code (retry if collision)
  let code = generateRoomCode();
  let retries = 0;
  while (retries < 5) {
    const { data: existing } = await supabase
      .from('rooms')
      .select('id')
      .eq('code', code)
      .single();

    if (!existing) break;
    code = generateRoomCode();
    retries++;
  }

  // Create the room
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .insert({
      code,
      status: 'waiting',
      max_score: 100,
    })
    .select()
    .single();

  if (roomError || !room) {
    return errorResponse(res, `Failed to create room: ${roomError?.message}`, 500);
  }

  // Add the host as player (team 1, seat 0)
  const { data: player, error: playerError } = await supabase
    .from('players')
    .insert({
      room_id: room.id,
      user_id: userId,
      name: hostName,
      team: 1,
      seat: 0,
      hand: [],
      is_bot: false,
    })
    .select()
    .single();

  if (playerError || !player) {
    return errorResponse(res, `Failed to add host player: ${playerError?.message}`, 500);
  }

  // Create initial game state for the room
  const { error: stateError } = await supabase
    .from('game_states')
    .insert({
      room_id: room.id,
      board: [],
      current_player_id: null,
      open_left: -1,
      open_right: -1,
      round: 1,
      scores: { team1: 0, team2: 0 },
      phase: 'waiting',
      consecutive_passes: 0,
    });

  if (stateError) {
    return errorResponse(res, `Failed to create game state: ${stateError.message}`, 500);
  }

  successResponse(res, {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      maxScore: room.max_score,
      createdAt: room.created_at,
    },
    player: {
      id: player.id,
      name: player.name,
      team: player.team,
      seat: player.seat,
    },
  }, 201);
}

export default withCors(handler);
