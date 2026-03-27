import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../lib/middleware';
import { shuffleAndDeal } from '../../lib/tile-set';
import { findStartingPlayer } from '../../lib/game-engine';
import { playBotTurns } from '../../lib/bot-player';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const { roomId } = req.body || {};

  if (!roomId) {
    return errorResponse(res, 'roomId is required');
  }

  const supabase = getSupabase();

  // Fetch the room
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (roomError || !room) {
    return errorResponse(res, 'Room not found', 404);
  }

  if (room.status === 'playing') {
    return errorResponse(res, 'Game is already in progress');
  }

  if (room.status === 'finished') {
    return errorResponse(res, 'Game has already finished');
  }

  // Fetch players ordered by seat
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  if (playersError || !players) {
    return errorResponse(res, `Failed to fetch players: ${playersError?.message}`, 500);
  }

  if (players.length !== 4) {
    return errorResponse(res, `Need exactly 4 players to start. Currently have ${players.length}.`);
  }

  // Shuffle and deal tiles
  const { hands } = shuffleAndDeal(4);

  // Update each player's hand in the database
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const { error: updateError } = await supabase
      .from('players')
      .update({ hand: hands[player.seat] })
      .eq('id', player.id);

    if (updateError) {
      return errorResponse(res, `Failed to deal cards: ${updateError.message}`, 500);
    }

    // Update the in-memory player object for findStartingPlayer
    player.hand = hands[player.seat];
  }

  // Find starting player (highest double)
  const starter = findStartingPlayer(
    players.map(p => ({ id: p.id, hand: p.hand }))
  );

  if (!starter) {
    // Extremely rare - reshuffle would be needed. For now, pick seat 0.
    return errorResponse(res, 'No doubles found. Please restart the game.', 500);
  }

  // Update game state
  const { error: stateError } = await supabase
    .from('game_states')
    .update({
      board: [],
      current_player_id: starter.playerId,
      open_left: -1,
      open_right: -1,
      phase: 'playing',
      consecutive_passes: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);

  if (stateError) {
    return errorResponse(res, `Failed to update game state: ${stateError.message}`, 500);
  }

  // Update room status to playing
  const { error: roomUpdateError } = await supabase
    .from('rooms')
    .update({ status: 'playing' })
    .eq('id', roomId);

  if (roomUpdateError) {
    return errorResponse(res, `Failed to update room status: ${roomUpdateError.message}`, 500);
  }

  // Check if starting player is a bot
  const startingPlayerData = players.find(p => p.id === starter.playerId);
  if (startingPlayerData?.is_bot) {
    const botResult = await playBotTurns(roomId);
    return successResponse(res, {
      message: 'Game started',
      startingPlayer: {
        id: starter.playerId,
        tile: starter.tile,
      },
      players: players.map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        seat: p.seat,
        isBot: p.is_bot,
        handCount: (p.hand as unknown[]).length,
      })),
      botMoves: botResult.botMoves,
      currentPlayerId: botResult.currentPlayerId,
      phase: botResult.phase,
    });
  }

  successResponse(res, {
    message: 'Game started',
    startingPlayer: {
      id: starter.playerId,
      tile: starter.tile,
    },
    players: players.map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      seat: p.seat,
      isBot: p.is_bot,
      handCount: (p.hand as unknown[]).length,
    })),
  });
}

export default withCors(handler);
