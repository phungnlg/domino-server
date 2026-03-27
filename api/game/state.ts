import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../lib/middleware';
import type { DominoTile } from '../../lib/tile-set';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const { roomId, playerId } = req.query;

  if (!roomId || typeof roomId !== 'string') {
    return errorResponse(res, 'roomId query parameter is required');
  }

  const supabase = getSupabase();

  // Fetch game state
  const { data: gameState, error: stateError } = await supabase
    .from('game_states')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (stateError || !gameState) {
    return errorResponse(res, 'Game state not found', 404);
  }

  // Fetch all players
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  if (playersError || !players) {
    return errorResponse(res, 'Failed to fetch players', 500);
  }

  // Sanitize player data - only show full hand for the requesting player
  const sanitizedPlayers = players.map(p => {
    const isRequester = playerId && p.id === playerId;
    const hand = p.hand as DominoTile[];

    return {
      id: p.id,
      name: p.name,
      team: p.team,
      seat: p.seat,
      isBot: p.is_bot,
      handCount: hand.length,
      // Only include actual tiles for the requesting player
      ...(isRequester ? { hand } : {}),
    };
  });

  // Fetch recent moves (last 10)
  const { data: recentMoves } = await supabase
    .from('moves')
    .select('id, player_id, tile, board_end, move_type, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(10);

  successResponse(res, {
    roomId,
    board: gameState.board,
    openLeft: gameState.open_left,
    openRight: gameState.open_right,
    currentPlayerId: gameState.current_player_id,
    round: gameState.round,
    scores: gameState.scores,
    phase: gameState.phase,
    consecutivePasses: gameState.consecutive_passes,
    players: sanitizedPlayers,
    recentMoves: recentMoves || [],
  });
}

export default withCors(handler);
