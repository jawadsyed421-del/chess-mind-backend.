import { Chess } from 'chess.js';

/**
 * MistakeClassifier — Classifies chess mistakes by severity using evaluation drops.
 *
 * Evaluation Drop Thresholds:
 *   Strategic Error:  0.4 – 1.0 (wrong plan, suboptimal direction)
 *   Positional Error: 1.0 – 2.0 (structural/square weakness)
 *   Tactical Error:   > 2.0     (missed concrete tactic)
 */

const STRATEGIC_MIN = 0.4;
const POSITIONAL_MIN = 1.0;
const TACTICAL_MIN = 2.0;

/**
 * Classify a single move's mistake type based on evaluation drop.
 * @param {number} evalDrop - Absolute evaluation drop in pawns (always positive)
 * @returns {{ type: string|null, severity: string, description: string }}
 */
export function classifyMistake(evalDrop) {
  const absDrop = Math.abs(evalDrop);

  if (absDrop < STRATEGIC_MIN) {
    return { type: null, severity: 'normal', description: 'Acceptable move' };
  }

  if (absDrop < POSITIONAL_MIN) {
    return {
      type: 'strategic',
      severity: 'inaccuracy',
      description: 'Strategic inaccuracy — suboptimal plan or piece placement',
    };
  }

  if (absDrop < TACTICAL_MIN) {
    return {
      type: 'positional',
      severity: 'mistake',
      description: 'Positional mistake — created a lasting structural or spatial weakness',
    };
  }

  return {
    type: 'tactical',
    severity: 'blunder',
    description: 'Tactical blunder — missed a concrete combination or left material hanging',
  };
}

/**
 * Analyze an entire game move-by-move using pre-computed evaluations.
 *
 * @param {Array<{fen: string, move: string, evalBefore: number, evalAfter: number}>} moveEvals
 * @param {string} playerColor - 'white' or 'black'
 * @returns {Array<object>} Classified mistakes for the player's moves only
 */
export function classifyGameMistakes(moveEvals, playerColor) {
  const mistakes = [];

  for (let i = 0; i < moveEvals.length; i++) {
    const entry = moveEvals[i];
    const { fen, move, evalBefore, evalAfter, bestMove, bestMoveSan, moveNumber, color } = entry;

    // Only classify the player's own moves
    const isPlayerMove =
      (playerColor === 'white' && color === 'w') ||
      (playerColor === 'black' && color === 'b');

    if (!isPlayerMove) continue;

    // Calculate evaluation drop from the player's perspective
    // For white: positive eval is good. Drop = evalBefore - evalAfter
    // For black: negative eval is good. Drop = evalAfter - evalBefore (reversed)
    let evalDrop;
    if (playerColor === 'white') {
      evalDrop = evalBefore - evalAfter;
    } else {
      evalDrop = evalAfter - evalBefore;
    }

    // Only classify if it's actually a deterioration
    if (evalDrop < STRATEGIC_MIN) continue;

    const classification = classifyMistake(evalDrop);

    if (classification.type) {
      mistakes.push({
        moveIndex: i,
        moveNumber,
        color,
        fen,
        movePlayed: move,
        bestMove: bestMove,
        bestMoveSan: bestMoveSan,
        evalBefore: Math.round(evalBefore * 100) / 100,
        evalAfter: Math.round(evalAfter * 100) / 100,
        evalDrop: Math.round(evalDrop * 100) / 100,
        type: classification.type,
        severity: classification.severity,
        baseDescription: classification.description,
      });
    }
  }

  return mistakes;
}

/**
 * Get aggregate mistake statistics across multiple games.
 * @param {Array<Array<object>>} allGameMistakes - Array of mistake arrays (one per game)
 * @returns {object} Aggregated weakness profile data
 */
export function aggregateMistakeStats(allGameMistakes) {
  const stats = {
    total: 0,
    strategic: 0,
    positional: 0,
    tactical: 0,
    themes: {},
    avgEvalDrop: { strategic: 0, positional: 0, tactical: 0 },
  };

  const drops = { strategic: [], positional: [], tactical: [] };

  for (const gameMistakes of allGameMistakes) {
    for (const m of gameMistakes) {
      stats.total++;
      stats[m.type]++;
      drops[m.type].push(m.evalDrop);

      if (m.tacticalTheme) {
        stats.themes[m.tacticalTheme] = (stats.themes[m.tacticalTheme] || 0) + 1;
      }
    }
  }

  // Calculate averages
  for (const type of ['strategic', 'positional', 'tactical']) {
    if (drops[type].length > 0) {
      stats.avgEvalDrop[type] =
        Math.round((drops[type].reduce((a, b) => a + b, 0) / drops[type].length) * 100) / 100;
    }
  }

  return stats;
}

export default { classifyMistake, classifyGameMistakes, aggregateMistakeStats };
