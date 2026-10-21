import { Chess } from 'chess.js';
import { getStockfish } from './stockfish.js';
import { classifyMistake } from './mistakeClassifier.js';
import { detectTheme } from './themeDetector.js';
import { generateExplanation, generateGameSummary } from './explanationGenerator.js';

/**
 * GameAnalyzer — Full game analysis pipeline.
 *
 * Takes a PGN, runs Stockfish evaluation on every move,
 * classifies mistakes, detects themes, and generates coaching explanations.
 *
 * Pipeline:
 *   PGN → Parse Moves → Evaluate Each Position → Calculate Eval Drops →
 *   Classify Mistakes → Detect Themes → Generate Explanations → Return Results
 */

/**
 * Analyze a complete game.
 *
 * @param {string} pgn - The game PGN
 * @param {string} playerColor - 'white' or 'black'
 * @param {number} depth - Stockfish search depth (default: 14)
 * @param {function} onProgress - Optional callback(moveIndex, totalMoves) for progress updates
 * @returns {object} Full analysis result
 */
// Upper bound per position. Without it a free-tier CPU needs minutes per game.
const MOVE_TIME_MS = Number(process.env.ANALYSIS_MOVETIME_MS) || 350;

export async function analyzeGame(pgn, playerColor, depth = 14, onProgress = null) {
  const startTime = Date.now();
  const searchDepth = Math.max(1, Math.min(parseInt(depth, 10) || 12, 16));
  console.log(`  🔍 Starting game analysis (depth ${searchDepth})...`);

  // Step 1: Parse the PGN into moves
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (err) {
    throw new Error(`Failed to parse PGN: ${err.message}`);
  }

  const history = chess.history({ verbose: true });
  const totalMoves = history.length;

  if (totalMoves === 0) {
    throw new Error('No moves found in the PGN');
  }

  console.log(`  📋 Parsed ${totalMoves} moves. Player is ${playerColor}.`);

  // Step 2: Get Stockfish instance
  const stockfish = await getStockfish();

  // Step 3: Evaluate each position
  const moveEvaluations = [];
  const replayChess = new Chess(); // Replay from start position

  // Initial evaluation for starting position
  let currentEval = await stockfish.evaluatePosition(replayChess.fen(), searchDepth, MOVE_TIME_MS);

  for (let i = 0; i < totalMoves; i++) {
    const move = history[i];
    const fenBefore = replayChess.fen();
    const evalBefore = currentEval;

    // Make the move
    replayChess.move(move.san);
    const fenAfter = replayChess.fen();

    // Evaluate position AFTER the move
    const evalAfter = await stockfish.evaluatePosition(fenAfter, searchDepth, MOVE_TIME_MS);
    currentEval = evalAfter;

    // Convert best move UCI to SAN
    const bestMoveSan = evalBefore.bestMove
      ? stockfish.uciToSan(fenBefore, evalBefore.bestMove)
      : move.san;

    moveEvaluations.push({
      moveIndex: i,
      moveNumber: Math.floor(i / 2) + 1,
      color: move.color,
      moveSan: move.san,
      fenBefore,
      fenAfter,
      evalBefore: evalBefore.score,
      evalAfter: evalAfter.score,
      bestMoveUci: evalBefore.bestMove,
      bestMoveSan: bestMoveSan || move.san,
      mate: evalBefore.mate,
    });

    // Progress callback
    if (onProgress) {
      onProgress(i + 1, totalMoves);
    }

    // Log progress every 10 moves
    if ((i + 1) % 10 === 0) {
      console.log(`  📊 Analyzed ${i + 1}/${totalMoves} moves...`);
    }
  }

  console.log(`  ✅ All ${totalMoves} moves evaluated.`);

  // Step 4: Identify mistakes for the player's moves
  const mistakes = [];

  for (const moveEval of moveEvaluations) {
    const isPlayerMove =
      (playerColor === 'white' && moveEval.color === 'w') ||
      (playerColor === 'black' && moveEval.color === 'b');

    if (!isPlayerMove) continue;

    // Calculate eval drop from the player's perspective
    let evalDrop;
    if (playerColor === 'white') {
      evalDrop = moveEval.evalBefore - moveEval.evalAfter;
    } else {
      evalDrop = moveEval.evalAfter - moveEval.evalBefore;
    }

    if (evalDrop < 0.4) continue; // Not a significant mistake

    // Classify the mistake
    const classification = classifyMistake(evalDrop);
    if (!classification.type) continue;

    // Generate full coaching explanation
    const explanation = generateExplanation({
      fen: moveEval.fenBefore,
      movePlayed: moveEval.moveSan,
      bestMoveSan: moveEval.bestMoveSan,
      evalBefore: moveEval.evalBefore,
      evalAfter: moveEval.evalAfter,
      evalDrop,
      type: classification.type,
      moveNumber: moveEval.moveNumber,
      color: moveEval.color,
    });

    mistakes.push({
      moveIndex: moveEval.moveIndex,
      moveNumber: moveEval.moveNumber,
      color: moveEval.color,
      moveSan: moveEval.moveSan,
      fenBefore: moveEval.fenBefore,
      fenAfter: moveEval.fenAfter,
      bestMoveSan: moveEval.bestMoveSan,
      evalBefore: Math.round(moveEval.evalBefore * 100) / 100,
      evalAfter: Math.round(moveEval.evalAfter * 100) / 100,
      evalDrop: Math.round(evalDrop * 100) / 100,
      type: classification.type,
      severity: classification.severity,
      theme: explanation.theme,
      subTheme: explanation.subTheme,
      explanation: explanation.whyProblem,
      betterMoveExplanation: explanation.betterMoveExplanation,
      practiceRecommendation: explanation.practiceRecommendation,
      gamePhase: explanation.gamePhase,
    });
  }

  // Step 5: Generate game summary
  const summary = generateGameSummary(mistakes);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  🎯 Analysis complete in ${elapsed}s. Found ${mistakes.length} mistakes.`);

  return {
    totalMoves,
    playerColor,
    depth,
    analysisTime: elapsed,
    moveEvaluations,
    mistakes,
    summary,
  };
}

export default { analyzeGame };
