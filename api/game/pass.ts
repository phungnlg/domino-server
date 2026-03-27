import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../lib/middleware';
import {
  getValidMoves,
  getNextPlayerSeat,
  calculateRoundScore,
  BoardTile,
} from '../../lib/game-engine';
import type { DominoTile } from '../../lib/tile-set';
import { playBotTurns } from '../../lib/bot-player';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const { roomId, playerId } = req.body || {};

  if (!roomId || !playerId) {
    return errorResponse(res, 'roomId and playerId are required');
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

  if (gameState.phase !== 'playing') {
    return errorResponse(res, 'Game is not in playing phase');
  }

  // Verify it is this player's turn
  if (gameState.current_player_id !== playerId) {
    return errorResponse(res, 'It is not your turn');
  }

  // Fetch the current player
  const { data: currentPlayer, error: playerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();

  if (playerError || !currentPlayer) {
    return errorResponse(res, 'Player not found', 404);
  }

  const playerHand: DominoTile[] = currentPlayer.hand as DominoTile[];
  const openLeft: number = gameState.open_left;
  const openRight: number = gameState.open_right;

  // Verify the player has no valid moves
  const validMoves = getValidMoves(playerHand, openLeft, openRight);
  if (validMoves.length > 0) {
    return errorResponse(res, 'You have valid moves and cannot pass');
  }

  // Record the pass move
  const { error: moveError } = await supabase
    .from('moves')
    .insert({
      room_id: roomId,
      player_id: playerId,
      tile: null,
      board_end: null,
      move_type: 'pass',
    });

  if (moveError) {
    return errorResponse(res, `Failed to record move: ${moveError.message}`, 500);
  }

  const newConsecutivePasses = (gameState.consecutive_passes || 0) + 1;

  // If 4 consecutive passes, game is blocked
  if (newConsecutivePasses >= 4) {
    return await handleBlockedGame(supabase, roomId, gameState, res);
  }

  // Determine next player (clockwise)
  const { data: allPlayers, error: allPlayersError } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  if (allPlayersError || !allPlayers) {
    return errorResponse(res, 'Failed to fetch players', 500);
  }

  const nextSeat = getNextPlayerSeat(currentPlayer.seat);
  const nextPlayer = allPlayers.find(p => p.seat === nextSeat);

  if (!nextPlayer) {
    return errorResponse(res, 'Failed to determine next player', 500);
  }

  // Update game state
  const { error: updateError } = await supabase
    .from('game_states')
    .update({
      current_player_id: nextPlayer.id,
      consecutive_passes: newConsecutivePasses,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);

  if (updateError) {
    return errorResponse(res, `Failed to update game state: ${updateError.message}`, 500);
  }

  // Check if next player is a bot and auto-play
  if (nextPlayer?.is_bot) {
    const botResult = await playBotTurns(roomId);
    return successResponse(res, {
      board: botResult.board,
      openLeft: botResult.openLeft,
      openRight: botResult.openRight,
      currentPlayerId: botResult.currentPlayerId,
      consecutivePasses: 0,
      phase: botResult.phase,
      scores: botResult.scores,
      roundScores: botResult.roundScores,
      gameOver: botResult.gameOver,
      blocked: botResult.blocked,
      botMoves: botResult.botMoves,
    });
  }

  successResponse(res, {
    board: gameState.board,
    openLeft: gameState.open_left,
    openRight: gameState.open_right,
    currentPlayerId: nextPlayer.id,
    consecutivePasses: newConsecutivePasses,
    phase: 'playing',
  });
}

async function handleBlockedGame(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string,
  gameState: Record<string, unknown>,
  res: VercelResponse
) {
  // Fetch all players for scoring
  const { data: allPlayers, error: playersError } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  if (playersError || !allPlayers) {
    return errorResponse(res, 'Failed to fetch players for scoring', 500);
  }

  const scores = calculateRoundScore(
    allPlayers.map(p => ({
      team: p.team,
      hand: p.hand as DominoTile[],
    }))
  );

  const currentScores = (gameState.scores as { team1: number; team2: number }) || { team1: 0, team2: 0 };
  const currentRound = (gameState.round as number) || 1;

  const newScores = {
    team1: currentScores.team1 + scores.team1Points,
    team2: currentScores.team2 + scores.team2Points,
  };

  const { data: room } = await supabase
    .from('rooms')
    .select('max_score')
    .eq('id', roomId)
    .single();

  const maxScore = room?.max_score || 100;
  const gameOver = newScores.team1 >= maxScore || newScores.team2 >= maxScore;
  const newPhase = gameOver ? 'game_over' : 'round_end';

  const { error: updateError } = await supabase
    .from('game_states')
    .update({
      scores: newScores,
      phase: newPhase,
      round: currentRound + (gameOver ? 0 : 1),
      consecutive_passes: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);

  if (updateError) {
    return errorResponse(res, `Failed to update game state: ${updateError.message}`, 500);
  }

  if (gameOver) {
    await supabase
      .from('rooms')
      .update({ status: 'finished' })
      .eq('id', roomId);
  }

  successResponse(res, {
    board: gameState.board,
    openLeft: gameState.open_left,
    openRight: gameState.open_right,
    phase: newPhase,
    scores: newScores,
    roundScores: scores,
    winningTeam: scores.winningTeam,
    blocked: true,
    gameOver,
  });
}

export default withCors(handler);
