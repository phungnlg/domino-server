import { getSupabase } from './supabase';
import { getValidMoves, validateAndPlace, getNextPlayerSeat, isBlocked, calculateRoundScore, BoardTile } from './game-engine';
import type { DominoTile } from './tile-set';

interface BotTurnResult {
  phase: string;
  currentPlayerId: string;
  board: BoardTile[];
  openLeft: number;
  openRight: number;
  scores?: { team1: number; team2: number };
  roundScores?: { team1Points: number; team2Points: number; winningTeam: number };
  gameOver?: boolean;
  blocked?: boolean;
  botMoves: { playerId: string; tile: DominoTile | null; end: string | null; moveType: string }[];
}

/**
 * Automatically play bot turns until a human player's turn or the round ends.
 * Returns the final state after all bot moves.
 */
export async function playBotTurns(roomId: string): Promise<BotTurnResult> {
  const supabase = getSupabase();
  const botMoves: BotTurnResult['botMoves'] = [];

  // Loop: keep playing while the current player is a bot
  for (let safety = 0; safety < 20; safety++) {
    // Fetch current game state
    const { data: gameState } = await supabase
      .from('game_states')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (!gameState || gameState.phase !== 'playing') {
      return buildResult(gameState, botMoves);
    }

    // Fetch current player
    const { data: currentPlayer } = await supabase
      .from('players')
      .select('*')
      .eq('id', gameState.current_player_id)
      .single();

    if (!currentPlayer || !currentPlayer.is_bot) {
      // It's a human's turn - stop
      return buildResult(gameState, botMoves);
    }

    // Bot's turn - decide move
    const hand: DominoTile[] = currentPlayer.hand as DominoTile[];
    const board: BoardTile[] = gameState.board as BoardTile[];
    const openLeft: number = gameState.open_left;
    const openRight: number = gameState.open_right;

    const validMoves = getValidMoves(hand, openLeft, openRight);

    if (validMoves.length === 0) {
      // Bot must pass
      await supabase.from('moves').insert({
        room_id: roomId,
        player_id: currentPlayer.id,
        tile: null,
        board_end: null,
        move_type: 'pass',
      });

      botMoves.push({ playerId: currentPlayer.id, tile: null, end: null, moveType: 'pass' });

      const newConsecutivePasses = (gameState.consecutive_passes || 0) + 1;

      if (newConsecutivePasses >= 4) {
        // Game is blocked
        const endResult = await handleBotBlockedGame(supabase, roomId, gameState, newConsecutivePasses);
        return { ...endResult, botMoves };
      }

      // Advance to next player
      const { data: allPlayers } = await supabase
        .from('players')
        .select('*')
        .eq('room_id', roomId)
        .order('seat', { ascending: true });

      const nextSeat = getNextPlayerSeat(currentPlayer.seat);
      const nextPlayer = allPlayers?.find(p => p.seat === nextSeat);

      await supabase.from('game_states').update({
        current_player_id: nextPlayer?.id,
        consecutive_passes: newConsecutivePasses,
        updated_at: new Date().toISOString(),
      }).eq('room_id', roomId);

      continue;
    }

    // Bot strategy: play the highest pip tile, prefer doubles
    const chosenMove = pickBestMove(validMoves);

    const result = validateAndPlace(chosenMove.tile, chosenMove.end, board, openLeft, openRight);
    if (!result) continue; // Should not happen

    // Remove tile from hand
    const updatedHand = hand.filter(t => !(t.left === chosenMove.tile.left && t.right === chosenMove.tile.right));

    await supabase.from('players').update({ hand: updatedHand }).eq('id', currentPlayer.id);
    await supabase.from('moves').insert({
      room_id: roomId,
      player_id: currentPlayer.id,
      tile: chosenMove.tile,
      board_end: chosenMove.end,
      move_type: 'place',
    });

    botMoves.push({ playerId: currentPlayer.id, tile: chosenMove.tile, end: chosenMove.end, moveType: 'place' });

    // Check if bot's hand is empty (round win)
    if (updatedHand.length === 0) {
      const endResult = await handleBotRoundEnd(supabase, roomId, result);
      return { ...endResult, botMoves };
    }

    // Check if blocked
    const { data: allPlayers } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('seat', { ascending: true });

    const updatedAllPlayers = (allPlayers || []).map(p =>
      p.id === currentPlayer.id ? { ...p, hand: updatedHand } : p
    );

    if (isBlocked(
      updatedAllPlayers.map(p => ({ hand: p.hand as DominoTile[] })),
      result.openLeft,
      result.openRight
    )) {
      const endResult = await handleBotBlockedGame(supabase, roomId, { ...gameState, board: result.board, open_left: result.openLeft, open_right: result.openRight }, 0);
      return { ...endResult, botMoves };
    }

    // Advance to next player
    const nextSeat = getNextPlayerSeat(currentPlayer.seat);
    const nextPlayer = allPlayers?.find(p => p.seat === nextSeat);

    await supabase.from('game_states').update({
      board: result.board,
      open_left: result.openLeft,
      open_right: result.openRight,
      current_player_id: nextPlayer?.id,
      consecutive_passes: 0,
      updated_at: new Date().toISOString(),
    }).eq('room_id', roomId);
  }

  // Safety limit reached - fetch final state
  const { data: finalState } = await supabase
    .from('game_states')
    .select('*')
    .eq('room_id', roomId)
    .single();

  return buildResult(finalState, botMoves);
}

/**
 * Simple bot strategy: prefer doubles, then highest pip count.
 */
function pickBestMove(moves: { tile: DominoTile; end: 'left' | 'right' }[]): { tile: DominoTile; end: 'left' | 'right' } {
  // Prefer doubles first (get rid of them early)
  const doubles = moves.filter(m => m.tile.left === m.tile.right);
  if (doubles.length > 0) {
    doubles.sort((a, b) => (b.tile.left + b.tile.right) - (a.tile.left + a.tile.right));
    return doubles[0];
  }
  // Then highest pip count
  const sorted = [...moves].sort((a, b) => (b.tile.left + b.tile.right) - (a.tile.left + a.tile.right));
  return sorted[0];
}

function buildResult(gameState: Record<string, unknown> | null, botMoves: BotTurnResult['botMoves']): BotTurnResult {
  if (!gameState) {
    return {
      phase: 'unknown',
      currentPlayerId: '',
      board: [],
      openLeft: -1,
      openRight: -1,
      botMoves,
    };
  }
  return {
    phase: gameState.phase as string,
    currentPlayerId: gameState.current_player_id as string,
    board: gameState.board as BoardTile[],
    openLeft: gameState.open_left as number,
    openRight: gameState.open_right as number,
    scores: gameState.scores as { team1: number; team2: number },
    botMoves,
  };
}

async function handleBotRoundEnd(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string,
  boardResult: { board: BoardTile[]; openLeft: number; openRight: number },
): Promise<Omit<BotTurnResult, 'botMoves'>> {
  const { data: allPlayers } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  const scores = calculateRoundScore(
    (allPlayers || []).map(p => ({ team: p.team, hand: p.hand as DominoTile[] }))
  );

  const { data: currentState } = await supabase
    .from('game_states')
    .select('scores, round')
    .eq('room_id', roomId)
    .single();

  const currentScores = (currentState?.scores as { team1: number; team2: number }) || { team1: 0, team2: 0 };
  const newScores = {
    team1: currentScores.team1 + scores.team1Points,
    team2: currentScores.team2 + scores.team2Points,
  };

  const { data: room } = await supabase.from('rooms').select('max_score').eq('id', roomId).single();
  const maxScore = room?.max_score || 100;
  const gameOver = newScores.team1 >= maxScore || newScores.team2 >= maxScore;
  const newPhase = gameOver ? 'game_over' : 'round_end';

  await supabase.from('game_states').update({
    board: boardResult.board,
    open_left: boardResult.openLeft,
    open_right: boardResult.openRight,
    scores: newScores,
    phase: newPhase,
    consecutive_passes: 0,
    updated_at: new Date().toISOString(),
  }).eq('room_id', roomId);

  if (gameOver) {
    await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId);
  }

  return {
    phase: newPhase,
    currentPlayerId: '',
    board: boardResult.board,
    openLeft: boardResult.openLeft,
    openRight: boardResult.openRight,
    scores: newScores,
    roundScores: scores,
    gameOver,
  };
}

async function handleBotBlockedGame(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string,
  gameState: Record<string, unknown>,
  consecutivePasses: number,
): Promise<Omit<BotTurnResult, 'botMoves'>> {
  const { data: allPlayers } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });

  const scores = calculateRoundScore(
    (allPlayers || []).map(p => ({ team: p.team, hand: p.hand as DominoTile[] }))
  );

  const { data: currentState } = await supabase
    .from('game_states')
    .select('scores, round')
    .eq('room_id', roomId)
    .single();

  const currentScores = (currentState?.scores as { team1: number; team2: number }) || { team1: 0, team2: 0 };
  const newScores = {
    team1: currentScores.team1 + scores.team1Points,
    team2: currentScores.team2 + scores.team2Points,
  };

  const { data: room } = await supabase.from('rooms').select('max_score').eq('id', roomId).single();
  const maxScore = room?.max_score || 100;
  const gameOver = newScores.team1 >= maxScore || newScores.team2 >= maxScore;
  const newPhase = gameOver ? 'game_over' : 'round_end';

  const board = gameState.board as BoardTile[];

  await supabase.from('game_states').update({
    board,
    scores: newScores,
    phase: newPhase,
    consecutive_passes: 0,
    updated_at: new Date().toISOString(),
  }).eq('room_id', roomId);

  if (gameOver) {
    await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId);
  }

  return {
    phase: newPhase,
    currentPlayerId: '',
    board,
    openLeft: gameState.open_left as number,
    openRight: gameState.open_right as number,
    scores: newScores,
    roundScores: scores,
    blocked: true,
    gameOver,
  };
}
