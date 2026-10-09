import { classifyMistake } from './mistakeClassifier.js';
import { detectTheme } from './themeDetector.js';

/**
 * ExplanationGenerator — Converts engine analysis into human-readable coaching text.
 *
 * Takes raw Stockfish evaluation data for a mistake and produces:
 *   1. What the player did
 *   2. Why the move was a problem
 *   3. What they could have done instead
 *   4. What type of weakness this represents
 *   5. What the player should practice because of it
 */

/**
 * Generate a complete coaching explanation for a single mistake.
 *
 * @param {object} mistakeData
 * @param {string} mistakeData.fen - Position before the move
 * @param {string} mistakeData.movePlayed - What the player played (SAN)
 * @param {string} mistakeData.bestMoveSan - Engine's best move (SAN)
 * @param {number} mistakeData.evalBefore - Eval before the move
 * @param {number} mistakeData.evalAfter - Eval after the move
 * @param {number} mistakeData.evalDrop - How much eval dropped
 * @param {string} mistakeData.type - 'strategic', 'positional', or 'tactical'
 * @param {number} mistakeData.moveNumber - Move number in the game
 * @param {string} mistakeData.color - 'w' or 'b'
 *
 * @returns {object} Complete coaching explanation
 */
export function generateExplanation(mistakeData) {
  const {
    fen,
    movePlayed,
    bestMoveSan,
    evalBefore,
    evalAfter,
    evalDrop,
    type,
    moveNumber,
    color,
  } = mistakeData;

  // Get theme detection
  const themeResult = detectTheme(fen, movePlayed, bestMoveSan, type, evalDrop);

  // Determine game phase
  const phase = getGamePhase(moveNumber);

  // Build the full explanation
  const explanation = {
    // What the player did
    whatHappened: buildWhatHappened(movePlayed, bestMoveSan, evalDrop, type, moveNumber, color),

    // Why it was a problem
    whyProblem: themeResult.explanation,

    // What they could have done
    betterMove: bestMoveSan,
    betterMoveExplanation: themeResult.betterMoveExplanation,

    // Classification
    mistakeType: type,
    severity: evalDrop > 3 ? 'severe' : evalDrop > 1.5 ? 'significant' : 'moderate',
    evalDrop: Math.round(evalDrop * 100) / 100,

    // Theme
    theme: themeResult.theme,
    subTheme: themeResult.subTheme,

    // Coaching recommendation
    practiceRecommendation: buildPracticeRecommendation(type, themeResult.theme, themeResult.subTheme),

    // Game context
    gamePhase: phase,
    moveNumber,
  };

  return explanation;
}

/**
 * Build "What Happened" text.
 */
function buildWhatHappened(movePlayed, bestMoveSan, evalDrop, type, moveNumber, color) {
  const colorName = color === 'w' ? 'White' : 'Black';
  const severityWord = evalDrop > 3 ? 'critical' : evalDrop > 1.5 ? 'significant' : 'notable';

  return `On move ${moveNumber}, ${colorName} played ${movePlayed} instead of the stronger ${bestMoveSan}. This was a ${severityWord} ${type} error, losing approximately ${evalDrop.toFixed(1)} pawns of advantage.`;
}

/**
 * Build practice recommendation based on mistake type and theme.
 */
function buildPracticeRecommendation(type, theme, subTheme) {
  const recommendations = {
    tactical: {
      Fork: {
        focus: 'Fork Recognition',
        advice: 'Practice puzzles involving double attacks. Look for moves that attack two pieces simultaneously, especially with knights.',
        puzzleTheme: 'fork',
      },
      Pin: {
        focus: 'Pin Exploitation',
        advice: 'Study positions where bishops, rooks, or queens pin pieces to the king or queen. Practice identifying when enemy pieces are aligned.',
        puzzleTheme: 'pin',
      },
      Skewer: {
        focus: 'Skewer Awareness',
        advice: 'Practice identifying when your valuable pieces are on the same line. Always check if moving a piece exposes something behind it.',
        puzzleTheme: 'skewer',
      },
      'Hanging Piece': {
        focus: 'Piece Safety',
        advice: 'Before every move, check: "Is every one of my pieces defended?" This simple habit prevents the most common material losses.',
        puzzleTheme: 'hangingPiece',
      },
      'Missed Check': {
        focus: 'Forcing Moves',
        advice: 'Always consider checks, captures, and threats first. These forcing moves limit your opponent\'s options.',
        puzzleTheme: 'check',
      },
      'Missed Capture': {
        focus: 'Material Awareness',
        advice: 'Before making your move, scan the board for any available captures, especially ones that win material.',
        puzzleTheme: 'capture',
      },
      Checkmate: {
        focus: 'Checkmate Patterns',
        advice: 'Study common checkmate patterns. When your opponent\'s king has limited squares, always look for finishing combinations.',
        puzzleTheme: 'mate',
      },
      'Discovered Attack': {
        focus: 'Discovered Attacks',
        advice: 'Practice identifying positions where moving one piece reveals an attack from another piece behind it.',
        puzzleTheme: 'discoveredAttack',
      },
    },
    positional: {
      'Pawn Structure': {
        focus: 'Pawn Structure Understanding',
        advice: 'Study how pawn moves are irreversible. Every pawn advance changes the character of the position permanently.',
        puzzleTheme: 'pawnStructure',
      },
      'Weak Squares': {
        focus: 'Square Control',
        advice: 'Learn to recognize when advancing pawns creates permanent holes. Strong players anchor pieces on weak squares.',
        puzzleTheme: 'weakSquares',
      },
      'Piece Activity': {
        focus: 'Active Piece Placement',
        advice: 'Keep your pieces actively placed on central and open squares. Avoid passive retreats unless forced.',
        puzzleTheme: 'pieceActivity',
      },
    },
    strategic: {
      Development: {
        focus: 'Opening Development',
        advice: 'In the opening, develop all minor pieces before launching attacks. Each undeveloped piece is a soldier sitting out the battle.',
        puzzleTheme: 'development',
      },
      'King Safety': {
        focus: 'King Safety Awareness',
        advice: 'Castle early, don\'t push pawns in front of your king unnecessarily, and always be aware of your king\'s vulnerability.',
        puzzleTheme: 'kingSafety',
      },
      Planning: {
        focus: 'Positional Planning',
        advice: 'Before making a move, ask: "What does this position need?" Identify the key features (open files, weak squares, pawn breaks) and form a plan around them.',
        puzzleTheme: 'planning',
      },
    },
  };

  const typeRecs = recommendations[type] || {};
  const themeRec = typeRecs[theme];

  if (themeRec) {
    return themeRec;
  }

  // Default recommendation
  return {
    focus: `${type.charAt(0).toUpperCase() + type.slice(1)} Improvement`,
    advice: `Continue studying ${type} positions and practice identifying the key features of similar positions.`,
    puzzleTheme: type,
  };
}

/**
 * Determine game phase from move number.
 */
function getGamePhase(moveNumber) {
  if (moveNumber <= 12) return 'opening';
  if (moveNumber <= 30) return 'middlegame';
  return 'endgame';
}

/**
 * Generate a summary of all mistakes in a game for the analysis page.
 *
 * @param {Array<object>} mistakes - Array of classified mistakes
 * @returns {object} Game summary with counts and key insights
 */
export function generateGameSummary(mistakes) {
  const summary = {
    totalMistakes: mistakes.length,
    strategic: mistakes.filter(m => m.type === 'strategic').length,
    positional: mistakes.filter(m => m.type === 'positional').length,
    tactical: mistakes.filter(m => m.type === 'tactical').length,
    biggestMistake: null,
    themes: [],
    overallAssessment: '',
  };

  if (mistakes.length === 0) {
    summary.overallAssessment = 'Excellent game! No significant mistakes detected.';
    return summary;
  }

  // Find biggest mistake
  summary.biggestMistake = mistakes.reduce((worst, m) =>
    m.evalDrop > (worst?.evalDrop || 0) ? m : worst
  , null);

  // Collect unique themes
  const themeSet = new Set();
  for (const m of mistakes) {
    if (m.theme) themeSet.add(m.theme);
  }
  summary.themes = [...themeSet];

  // Overall assessment
  if (summary.tactical >= 2) {
    summary.overallAssessment = `Tactical accuracy needs work — ${summary.tactical} tactical errors detected. Focus on calculating forcing moves (checks, captures, threats) before committing to a move.`;
  } else if (summary.positional >= 2) {
    summary.overallAssessment = `Positional understanding is the main area for improvement. ${summary.positional} positional errors suggest difficulty evaluating pawn structures and piece placement.`;
  } else if (summary.strategic >= 2) {
    summary.overallAssessment = `Strategic planning can be improved. ${summary.strategic} strategic inaccuracies indicate the chosen plans didn't match what the position required.`;
  } else {
    summary.overallAssessment = `A mixed game with ${summary.totalMistakes} mistake(s) across different categories. Review each one to understand the pattern.`;
  }

  return summary;
}

export default { generateExplanation, generateGameSummary };
