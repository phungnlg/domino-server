import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../lib/middleware';

const BOT_NAMES = ['Bot Alpha', 'Bot Beta', 'Bot Gamma'];

function getTeamForSeat(seat: number): number {
  return seat % 2 === 0 ? 1 : 2;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const { roomId } = req.body || {};
  if (!roomId) {
    return errorResponse(res, 'roomId is required');
  }

  const supabase = getSupabase();

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (roomError || !room) {
    return errorResponse(res, 'Room not found', 404);
  }

  if (room.status !== 'waiting') {
    return errorResponse(res, 'Room is not in waiting state');
  }

  const { data: existingPlayers, error: playersError } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  if (playersError) {
    return errorResponse(res, `Failed to fetch players: ${playersError.message}`, 500);
  }

  const takenSeats = new Set((existingPlayers || []).map(p => p.seat));
  let botIndex = 0;
  const newBots = [];

  for (let seat = 0; seat < 4; seat++) {
    if (!takenSeats.has(seat)) {
      const botName = BOT_NAMES[botIndex] || `Bot ${botIndex + 1}`;
      botIndex++;
      newBots.push({
        room_id: roomId,
        user_id: `bot-${seat}-${Date.now()}`,
        name: botName,
        team: getTeamForSeat(seat),
        seat,
        hand: [],
        is_bot: true,
      });
    }
  }

  if (newBots.length === 0) {
    return errorResponse(res, 'Room is already full');
  }

  const { error: insertError } = await supabase
    .from('players')
    .insert(newBots);

  if (insertError) {
    return errorResponse(res, `Failed to add bots: ${insertError.message}`, 500);
  }

  // Fetch all players
  const { data: allPlayers } = await supabase
    .from('players')
    .select('id, name, team, seat, is_bot')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  successResponse(res, {
    players: allPlayers || [],
    botsAdded: newBots.length,
  });
}

export default withCors(handler);
