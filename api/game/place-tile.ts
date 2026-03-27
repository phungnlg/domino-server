import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabase';
import { withCors, errorResponse, successResponse } from '../../lib/middleware';
import {
  validateAndPlace,
  tilesEqual,
  getNextPlayerSeat,
  calculateRoundScore,
  isBlocked,
  BoardTile,
} from '../../lib/game-engine';
import type { DominoTile } from '../../lib/tile-set';
import { playBotTurns } from '../../lib/bot-player';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const { roomId, playerId, tile, end } = req.body || {};

  if (!roomId || !playerId || !tile || !end) {
    return errorResponse(res, 'roomId, playerId, tile, and end are required');
  }

  if (end !== 'left' && end !== 'right') {
    return errorResponse(res, 'end must be "left" or "right"');
  }

  if (typeof tile.left !== 'number' || typeof tile.right !== 'number') {
    return errorResponse(res, 'tile must have numeric left and right values');
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

  // Verify the player has this tile
  const tileIndex = playerHand.findIndex(t => tilesEqual(t, tile));
  if (tileIndex === -1) {
    return errorResponse(res, 'You do not have this tile in your hand');
  }

  const currentBoard: BoardTile[] = gameState.board as BoardTile[];
  const openLeft: number = gameState.open_left;
  const openRight: number = gameState.open_right;

  // Validate and place the tile
  const result = validateAndPlace(tile, end, currentBoard, openLeft, openRight);

  if (!result) {
    return errorResponse(res, 'Invalid tile placement');
  }

  // Remove the tile from the player's hand
  const updatedHand = [...playerHand];
  updatedHand.splice(tileIndex, 1);

  // Update the player's hand in the database
  const { error: handError } = await supabase
    .from('players')
    .update({ hand: updatedHand })
    .eq('id', playerId);

  if (handError) {
    return errorResponse(res, `Failed to update hand: ${handError.message}`, 500);
  }

  // Record the move
  const { error: moveError } = await supabase
    .from('moves')
    .insert({
      room_id: roomId,
      player_id: playerId,
      tile,
      board_end: end,
      move_type: 'place',
    });

  if (moveError) {
    return errorResponse(res, `Failed to record move: ${moveError.message}`, 500);
  }

  // Check if the player's hand is now empty (round win)
  if (updatedHand.length === 0) {
    return await handleRoundEnd(supabase, roomId, currentPlayer, result, res);
  }

  // Fetch all players to check if game is blocked
  const { data: allPlayers, error: allPlayersError } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  if (allPlayersError || !allPlayers) {
    return errorResponse(res, 'Failed to fetch players', 500);
  }

  // Update the current player's hand in allPlayers for accurate block check
  const updatedAllPlayers = allPlayers.map(p =>
    p.id === playerId ? { ...p, hand: updatedHand } : p
  );

  // Check if game is blocked after this move
  if (isBlocked(
    updatedAllPlayers.map(p => ({ hand: p.hand as DominoTile[] })),
    result.openLeft,
    result.openRight
  )) {
    return await handleBlockedGame(supabase, roomId, updatedAllPlayers, result, res);
  }

  // Determine next player (clockwise)
  const nextSeat = getNextPlayerSeat(currentPlayer.seat);
  const nextPlayer = allPlayers.find(p => p.seat === nextSeat);

  if (!nextPlayer) {
    return errorResponse(res, 'Failed to determine next player', 500);
  }

  // Update game state
  const { error: updateError } = await supabase
    .from('game_states')
    .update({
      board: result.board,
      open_left: result.openLeft,
      open_right: result.openRight,
      current_player_id: nextPlayer.id,
      consecutive_passes: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);

  if (updateError) {
    return errorResponse(res, `Failed to update game state: ${updateError.message}`, 500);
  }

  // Check if next player is a bot and auto-play
  const nextPlayerData = allPlayers.find(p => p.seat === nextSeat);
  if (nextPlayerData?.is_bot) {
    const botResult = await playBotTurns(roomId);
    return successResponse(res, {
      board: botResult.board,
      openLeft: botResult.openLeft,
      openRight: botResult.openRight,
      currentPlayerId: botResult.currentPlayerId,
      playerHandCount: updatedHand.length,
      phase: botResult.phase,
      scores: botResult.scores,
      roundScores: botResult.roundScores,
      gameOver: botResult.gameOver,
      blocked: botResult.blocked,
      botMoves: botResult.botMoves,
    });
  }

  successResponse(res, {
    board: result.board,
    openLeft: result.openLeft,
    openRight: result.openRight,
    currentPlayerId: nextPlayer.id,
    playerHandCount: updatedHand.length,
    phase: 'playing',
  });
}

async function handleRoundEnd(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string,
  winner: { id: string; team: number; seat: number },
  boardResult: { board: BoardTile[]; openLeft: number; openRight: number },
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

  // Get current scores from game state
  const { data: currentState } = await supabase
    .from('game_states')
    .select('scores, round')
    .eq('room_id', roomId)
    .single();

  const currentScores = (currentState?.scores as { team1: number; team2: number }) || { team1: 0, team2: 0 };
  const currentRound = currentState?.round || 1;

  const newScores = {
    team1: currentScores.team1 + scores.team1Points,
    team2: currentScores.team2 + scores.team2Points,
  };

  // Check if the game is over (a team reached max score)
  const { data: room } = await supabase
    .from('rooms')
    .select('max_score')
    .eq('id', roomId)
    .single();

  const maxScore = room?.max_score || 100;
  const gameOver = newScores.team1 >= maxScore || newScores.team2 >= maxScore;

  const newPhase = gameOver ? 'game_over' : 'round_end';

  // Update game state
  const { error: updateError } = await supabase
    .from('game_states')
    .update({
      board: boardResult.board,
      open_left: boardResult.openLeft,
      open_right: boardResult.openRight,
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
    board: boardResult.board,
    openLeft: boardResult.openLeft,
    openRight: boardResult.openRight,
    phase: newPhase,
    scores: newScores,
    roundScores: scores,
    winningTeam: scores.winningTeam,
    gameOver,
  });
}

async function handleBlockedGame(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string,
  allPlayers: { id: string; team: number; hand: unknown }[],
  boardResult: { board: BoardTile[]; openLeft: number; openRight: number },
  res: VercelResponse
) {
  const scores = calculateRoundScore(
    allPlayers.map(p => ({
      team: p.team,
      hand: p.hand as DominoTile[],
    }))
  );

  const { data: currentState } = await supabase
    .from('game_states')
    .select('scores, round')
    .eq('room_id', roomId)
    .single();

  const currentScores = (currentState?.scores as { team1: number; team2: number }) || { team1: 0, team2: 0 };
  const currentRound = currentState?.round || 1;

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
      board: boardResult.board,
      open_left: boardResult.openLeft,
      open_right: boardResult.openRight,
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
    board: boardResult.board,
    openLeft: boardResult.openLeft,
    openRight: boardResult.openRight,
    phase: newPhase,
    scores: newScores,
    roundScores: scores,
    winningTeam: scores.winningTeam,
    blocked: true,
    gameOver,
  });
}

export default withCors(handler);
