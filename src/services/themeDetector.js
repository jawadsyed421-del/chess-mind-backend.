import { Chess } from 'chess.js';

/**
 * ThemeDetector — Detects tactical and positional themes from chess positions.
 *
 * For tactical errors (evalDrop > 2.0), it analyzes the BEST move that was missed
 * to determine what kind of tactic the player failed to see or allowed.
 *
 * For positional errors (evalDrop 1.0-2.0), it looks at structural patterns.
 * For strategic errors (evalDrop 0.4-1.0), it identifies planning issues.
 */

/**
 * Detect the tactical/positional/strategic theme of a mistake.
 *
 * @param {string} fenBefore - Position FEN before the player's move
 * @param {string} movePlayed - The move the player actually made (SAN)
 * @param {string} bestMoveSan - The engine's recommended move (SAN)
 * @param {string} mistakeType - 'tactical', 'positional', or 'strategic'
 * @param {number} evalDrop - How much eval dropped
 * @returns {{ theme: string, subTheme: string|null, explanation: string, betterMoveExplanation: string }}
 */
export function detectTheme(fenBefore, movePlayed, bestMoveSan, mistakeType, evalDrop) {
  if (mistakeType === 'tactical') {
    return detectTacticalTheme(fenBefore, movePlayed, bestMoveSan, evalDrop);
  }

  if (mistakeType === 'positional') {
    return detectPositionalTheme(fenBefore, movePlayed, bestMoveSan, evalDrop);
  }

  return detectStrategicTheme(fenBefore, movePlayed, bestMoveSan, evalDrop);
}

/**
 * Detect the specific tactical pattern the player missed or allowed.
 */
function detectTacticalTheme(fenBefore, movePlayed, bestMoveSan, evalDrop) {
  const chess = new Chess(fenBefore);
  const turn = chess.turn(); // 'w' or 'b'

  // Try to play the best move and analyze the resulting position
  let bestMoveResult = null;
  try {
    const chessCopy = new Chess(fenBefore);
    bestMoveResult = chessCopy.move(bestMoveSan);
  } catch {}

  // Try to play the actual move and analyze resulting position
  let playerMoveResult = null;
  try {
    const chessCopy2 = new Chess(fenBefore);
    playerMoveResult = chessCopy2.move(movePlayed);
  } catch {}

  // ----- CHECK-BASED THEMES -----
  if (bestMoveResult && bestMoveResult.san.includes('+')) {
    // The best move was a check the player missed
    const checkResult = analyzeCheckTheme(fenBefore, bestMoveResult);
    if (checkResult) return checkResult;
  }

  // ----- CAPTURE THEMES -----
  if (bestMoveResult && bestMoveResult.captured) {
    // Best move was a capture the player missed
    const captureResult = analyzeCaptureTheme(fenBefore, bestMoveResult, evalDrop);
    if (captureResult) return captureResult;
  }

  // ----- FORK DETECTION -----
  const forkResult = detectFork(fenBefore, bestMoveSan);
  if (forkResult) return forkResult;

  // ----- PIN DETECTION -----
  const pinResult = detectPin(fenBefore, bestMoveSan, movePlayed);
  if (pinResult) return pinResult;

  // ----- SKEWER DETECTION -----
  const skewerResult = detectSkewer(fenBefore, bestMoveSan);
  if (skewerResult) return skewerResult;

  // ----- HANGING PIECE DETECTION -----
  const hangingResult = detectHangingPiece(fenBefore, movePlayed);
  if (hangingResult) return hangingResult;

  // ----- BACK RANK / MATING THEMES -----
  if (bestMoveResult && bestMoveResult.san.includes('#')) {
    return {
      theme: 'Checkmate',
      subTheme: 'Missed Checkmate',
      explanation: `You missed a forced checkmate with ${bestMoveSan}. Instead you played ${movePlayed}.`,
      betterMoveExplanation: `${bestMoveSan} delivers checkmate immediately.`,
    };
  }

  // ----- FALLBACK: General tactical miss -----
  return {
    theme: evalDrop > 4 ? 'Major Tactical Blunder' : 'Tactical Miss',
    subTheme: null,
    explanation: `You played ${movePlayed} which lost ${evalDrop.toFixed(1)} pawns of advantage. The engine preferred ${bestMoveSan}.`,
    betterMoveExplanation: `${bestMoveSan} maintains the tactical integrity of the position and prevents material loss.`,
  };
}

/**
 * Detect fork patterns — a single piece attacking 2+ valuable targets after a move.
 */
function detectFork(fen, bestMoveSan) {
  try {
    const chess = new Chess(fen);
    const move = chess.move(bestMoveSan);
    if (!move) return null;

    const movedPiece = move.piece;
    const to = move.to;
    const opponentColor = chess.turn(); // After the move, it's opponent's turn

    // Get all squares attacked by the moved piece from its new square
    const attackedSquares = getAttackedSquares(chess, to, movedPiece, move.color);

    // Check how many opponent high-value pieces are attacked
    const attackedPieces = [];
    for (const sq of attackedSquares) {
      const target = chess.get(sq);
      if (target && target.color === opponentColor) {
        const value = getPieceValue(target.type);
        if (value >= 3 || target.type === 'k') { // Knights, bishops, rooks, queens, kings
          attackedPieces.push({ square: sq, piece: target, value });
        }
      }
    }

    if (attackedPieces.length >= 2) {
      const pieceNames = attackedPieces.map(p => getPieceName(p.piece.type)).join(' and ');
      const attackerName = getPieceName(movedPiece);

      return {
        theme: 'Fork',
        subTheme: `${attackerName} Fork`,
        explanation: `Your opponent's position allowed a ${attackerName.toLowerCase()} fork attacking the ${pieceNames} simultaneously. You missed playing ${bestMoveSan}.`,
        betterMoveExplanation: `${bestMoveSan} places the ${attackerName.toLowerCase()} on ${to}, attacking both the ${pieceNames} at once — only one can be saved.`,
      };
    }
  } catch {}
  return null;
}

/**
 * Detect pin patterns — a piece is pinned to a more valuable piece behind it.
 */
function detectPin(fen, bestMoveSan, movePlayed) {
  try {
    const chess = new Chess(fen);

    // Check if the best move creates an absolute or relative pin
    const move = chess.move(bestMoveSan);
    if (!move) return null;

    const movedPiece = move.piece;
    const to = move.to;

    // Check sliding pieces (bishop, rook, queen) for pin creation
    if (['b', 'r', 'q'].includes(movedPiece)) {
      const opponentColor = chess.turn();

      // Look along the piece's attack lines for pin patterns
      const directions = getDirections(movedPiece);
      for (const [dr, dc] of directions) {
        const pieces = scanLine(chess, to, dr, dc);
        if (pieces.length >= 2) {
          const first = pieces[0];
          const second = pieces[1];

          if (first.piece.color === opponentColor && second.piece.color === opponentColor) {
            const firstValue = getPieceValue(first.piece.type);
            const secondValue = getPieceValue(second.piece.type);

            // Pin: less valuable piece in front, more valuable behind
            if (secondValue > firstValue || second.piece.type === 'k') {
              const pinnedName = getPieceName(first.piece.type);
              const behindName = getPieceName(second.piece.type);

              return {
                theme: 'Pin',
                subTheme: `${pinnedName} Pinned to ${behindName}`,
                explanation: `You missed ${bestMoveSan} which pins the opponent's ${pinnedName.toLowerCase()} to their ${behindName.toLowerCase()}. The pinned piece cannot move without exposing the ${behindName.toLowerCase()}.`,
                betterMoveExplanation: `${bestMoveSan} creates a pin along the ${movedPiece === 'b' ? 'diagonal' : movedPiece === 'r' ? 'file/rank' : 'line'}, immobilizing the ${pinnedName.toLowerCase()}.`,
              };
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Detect skewer patterns — attacking a valuable piece that must move, exposing another behind.
 */
function detectSkewer(fen, bestMoveSan) {
  try {
    const chess = new Chess(fen);
    const move = chess.move(bestMoveSan);
    if (!move) return null;

    const movedPiece = move.piece;
    const to = move.to;

    if (['b', 'r', 'q'].includes(movedPiece)) {
      const opponentColor = chess.turn();
      const directions = getDirections(movedPiece);

      for (const [dr, dc] of directions) {
        const pieces = scanLine(chess, to, dr, dc);
        if (pieces.length >= 2) {
          const first = pieces[0];
          const second = pieces[1];

          if (first.piece.color === opponentColor && second.piece.color === opponentColor) {
            const firstValue = getPieceValue(first.piece.type);
            const secondValue = getPieceValue(second.piece.type);

            // Skewer: more valuable piece in front, less valuable behind
            if (firstValue > secondValue && first.piece.type !== 'k') {
              const frontName = getPieceName(first.piece.type);
              const behindName = getPieceName(second.piece.type);

              return {
                theme: 'Skewer',
                subTheme: `${frontName} Skewered`,
                explanation: `${bestMoveSan} attacks the ${frontName.toLowerCase()}, which must move, exposing the ${behindName.toLowerCase()} behind it.`,
                betterMoveExplanation: `${bestMoveSan} creates a skewer — the ${frontName.toLowerCase()} is forced to step aside, allowing capture of the ${behindName.toLowerCase()}.`,
              };
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Detect if the player's move left a piece hanging (undefended and attackable).
 */
function detectHangingPiece(fen, movePlayed) {
  try {
    const chess = new Chess(fen);
    const move = chess.move(movePlayed);
    if (!move) return null;

    // After the player's move, check if any of their pieces are now attacked and undefended
    const playerColor = move.color;
    const opponentColor = playerColor === 'w' ? 'b' : 'w';

    const board = chess.board();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (!piece || piece.color !== playerColor) continue;
        if (piece.type === 'k') continue; // Skip king

        const sq = squareName(row, col);
        const isAttacked = chess.isAttacked(sq, opponentColor);

        if (isAttacked && getPieceValue(piece.type) >= 3) {
          // Check if the piece is defended
          // Temporarily remove the piece and see if its square was attacked by player
          const isDefended = chess.isAttacked(sq, playerColor);

          if (!isDefended) {
            const pieceName = getPieceName(piece.type);
            return {
              theme: 'Hanging Piece',
              subTheme: `Undefended ${pieceName}`,
              explanation: `After ${movePlayed}, your ${pieceName.toLowerCase()} on ${sq} is left undefended and can be captured for free.`,
              betterMoveExplanation: `The engine move avoids leaving the ${pieceName.toLowerCase()} hanging and maintains material safety.`,
            };
          }
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Analyze check-based tactical themes.
 */
function analyzeCheckTheme(fen, bestMoveResult) {
  if (bestMoveResult.captured) {
    return {
      theme: 'Discovered Attack',
      subTheme: 'Check with Capture',
      explanation: `You missed ${bestMoveResult.san} which captures material while giving check — the opponent cannot recapture immediately.`,
      betterMoveExplanation: `${bestMoveResult.san} wins material by combining a capture with a check, gaining tempo.`,
    };
  }

  return {
    theme: 'Missed Check',
    subTheme: 'Forcing Move',
    explanation: `You missed the forcing check ${bestMoveResult.san}. Checks limit the opponent's options and often lead to winning material or improving position.`,
    betterMoveExplanation: `${bestMoveResult.san} gives check, forcing the opponent to respond to the threat before anything else.`,
  };
}

/**
 * Analyze capture-based tactical themes.
 */
function analyzeCaptureTheme(fen, bestMoveResult, evalDrop) {
  const capturedValue = getPieceValue(bestMoveResult.captured);
  const attackerValue = getPieceValue(bestMoveResult.piece);

  if (capturedValue > attackerValue) {
    return {
      theme: 'Missed Capture',
      subTheme: 'Winning Exchange',
      explanation: `You missed capturing a ${getPieceName(bestMoveResult.captured).toLowerCase()} worth more than your ${getPieceName(bestMoveResult.piece).toLowerCase()}.`,
      betterMoveExplanation: `${bestMoveResult.san} wins material by capturing a higher-value piece.`,
    };
  }

  if (capturedValue === attackerValue) {
    return {
      theme: 'Missed Capture',
      subTheme: 'Equal Exchange',
      explanation: `You missed an important trade with ${bestMoveResult.san} that would have simplified the position in your favor.`,
      betterMoveExplanation: `${bestMoveResult.san} exchanges pieces while maintaining your positional advantage.`,
    };
  }

  return null;
}

// ------ POSITIONAL THEME DETECTION ------

function detectPositionalTheme(fenBefore, movePlayed, bestMoveSan, evalDrop) {
  const chess = new Chess(fenBefore);

  // Check for pawn structure damage
  const pawnResult = detectPawnStructureIssue(chess, movePlayed);
  if (pawnResult) return pawnResult;

  // Check for weak square creation
  const weakSquareResult = detectWeakSquareCreation(chess, movePlayed);
  if (weakSquareResult) return weakSquareResult;

  // Check for piece activity issues
  const activityResult = detectPieceActivity(chess, movePlayed, bestMoveSan);
  if (activityResult) return activityResult;

  return {
    theme: 'Positional Weakness',
    subTheme: 'Structural Concession',
    explanation: `${movePlayed} creates a lasting positional disadvantage worth about ${evalDrop.toFixed(1)} pawns. The engine preferred ${bestMoveSan} to maintain positional balance.`,
    betterMoveExplanation: `${bestMoveSan} preserves positional integrity — keeping pawn structure sound and piece activity high.`,
  };
}

function detectPawnStructureIssue(chess, movePlayed) {
  try {
    const beforeBoard = chess.board();
    const chessAfter = new Chess(chess.fen());
    const move = chessAfter.move(movePlayed);
    if (!move) return null;

    // Check if a pawn move created doubled pawns or an isolated pawn
    if (move.piece === 'p') {
      const afterBoard = chessAfter.board();
      const playerColor = move.color;

      // Count pawns per file before and after
      const pawnsBefore = countPawnsPerFile(beforeBoard, playerColor);
      const pawnsAfter = countPawnsPerFile(afterBoard, playerColor);

      // Doubled pawns: any file went from 1 pawn to 2
      for (let file = 0; file < 8; file++) {
        if (pawnsAfter[file] > pawnsBefore[file] && pawnsAfter[file] >= 2) {
          const fileName = 'abcdefgh'[file];
          return {
            theme: 'Pawn Structure',
            subTheme: 'Doubled Pawns',
            explanation: `${movePlayed} created doubled pawns on the ${fileName}-file, weakening your structure permanently.`,
            betterMoveExplanation: `Avoiding doubled pawns keeps your pawn chain flexible and strong.`,
          };
        }
      }
    }

    // If it's a capture that damages structure
    if (move.captured && move.piece === 'p') {
      return {
        theme: 'Pawn Structure',
        subTheme: 'Structural Damage',
        explanation: `The pawn capture ${movePlayed} damaged your pawn structure, creating long-term weaknesses.`,
        betterMoveExplanation: `The engine avoids structural concessions and recaptures in a way that maintains pawn integrity.`,
      };
    }
  } catch {}
  return null;
}

function detectWeakSquareCreation(chess, movePlayed) {
  try {
    const move = new Chess(chess.fen()).move(movePlayed);
    if (!move) return null;

    // If a pawn advances, the squares it used to control become weak
    if (move.piece === 'p') {
      return {
        theme: 'Weak Squares',
        subTheme: 'Pawn Advance Weakness',
        explanation: `${movePlayed} advanced a pawn, permanently giving up control of nearby squares that your opponent can now occupy.`,
        betterMoveExplanation: `The engine keeps pawns stable or advances them only when the timing is right to avoid creating weak squares.`,
      };
    }
  } catch {}
  return null;
}

function detectPieceActivity(chess, movePlayed, bestMoveSan) {
  try {
    const move = new Chess(chess.fen()).move(movePlayed);
    if (!move) return null;

    // Piece retreating to back rank often indicates passivity
    const toRank = parseInt(move.to[1]);
    const isRetreat = (move.color === 'w' && toRank <= 2) || (move.color === 'b' && toRank >= 7);

    if (isRetreat && ['n', 'b', 'r', 'q'].includes(move.piece)) {
      return {
        theme: 'Piece Activity',
        subTheme: 'Passive Retreat',
        explanation: `${movePlayed} retreats the ${getPieceName(move.piece).toLowerCase()} to a passive square. Active pieces belong in the center and on open lines.`,
        betterMoveExplanation: `${bestMoveSan} keeps pieces actively placed, contributing to the fight for key squares.`,
      };
    }
  } catch {}
  return null;
}

// ------ STRATEGIC THEME DETECTION ------

function detectStrategicTheme(fenBefore, movePlayed, bestMoveSan, evalDrop) {
  const chess = new Chess(fenBefore);

  // Detect moves that don't contribute to development
  const devResult = detectDevelopmentIssue(chess, movePlayed, bestMoveSan);
  if (devResult) return devResult;

  // Detect king safety issues
  const kingSafetyResult = detectKingSafety(chess, movePlayed, bestMoveSan);
  if (kingSafetyResult) return kingSafetyResult;

  return {
    theme: 'Planning',
    subTheme: 'Suboptimal Direction',
    explanation: `${movePlayed} doesn't align with what the position requires. The evaluation dropped by ${evalDrop.toFixed(1)}, suggesting a wrong plan or direction.`,
    betterMoveExplanation: `${bestMoveSan} follows a more harmonious plan, improving coordination and positioning for the middlegame.`,
  };
}

function detectDevelopmentIssue(chess, movePlayed, bestMoveSan) {
  try {
    const moveNum = parseInt(chess.fen().split(' ')[5]) || 1;
    if (moveNum > 12) return null; // Only relevant in the opening

    const move = new Chess(chess.fen()).move(movePlayed);
    if (!move) return null;

    // Moving the same piece twice in the opening
    if (move.piece !== 'p' && moveNum <= 10) {
      // Check if other pieces are still undeveloped
      const board = chess.board();
      const color = move.color;
      const homeRank = color === 'w' ? 7 : 0;

      let undeveloped = 0;
      for (let col = 0; col < 8; col++) {
        const piece = board[homeRank][col];
        if (piece && piece.color === color && ['n', 'b'].includes(piece.type)) {
          undeveloped++;
        }
      }

      if (undeveloped >= 2) {
        return {
          theme: 'Development',
          subTheme: 'Premature Activity',
          explanation: `${movePlayed} moves an already-developed piece while ${undeveloped} minor pieces remain on their starting squares. Develop all pieces before starting an attack.`,
          betterMoveExplanation: `${bestMoveSan} prioritizes completing development, bringing more pieces into the fight.`,
        };
      }
    }
  } catch {}
  return null;
}

function detectKingSafety(chess, movePlayed, bestMoveSan) {
  try {
    const move = new Chess(chess.fen()).move(movePlayed);
    if (!move) return null;

    // If the player's king hasn't castled and they made a non-castling king move
    if (move.piece === 'k' && !move.san.includes('O')) {
      return {
        theme: 'King Safety',
        subTheme: 'Delayed Castling',
        explanation: `Moving the king with ${movePlayed} forfeits the right to castle. King safety is critical in the opening and middlegame.`,
        betterMoveExplanation: `${bestMoveSan} keeps castling options open or addresses the position without compromising king safety.`,
      };
    }

    // Moving pawns in front of castled king
    if (move.piece === 'p') {
      const kingPos = findKing(chess, move.color);
      if (kingPos) {
        const kingFile = kingPos.charCodeAt(0) - 97;
        const pawnFile = move.to.charCodeAt(0) - 97;

        if (Math.abs(kingFile - pawnFile) <= 1) {
          return {
            theme: 'King Safety',
            subTheme: 'Weakened King Shelter',
            explanation: `${movePlayed} advances a pawn in front of your king, creating potential weaknesses in your king shelter.`,
            betterMoveExplanation: `${bestMoveSan} improves your position without compromising the king's pawn shield.`,
          };
        }
      }
    }
  } catch {}
  return null;
}

// ------ UTILITY FUNCTIONS ------

function getPieceValue(type) {
  const values = { p: 1, n: 3, b: 3.15, r: 5, q: 9, k: 100 };
  return values[type] || 0;
}

function getPieceName(type) {
  const names = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
  return names[type] || 'Piece';
}

function squareName(row, col) {
  return 'abcdefgh'[col] + (8 - row);
}

function getAttackedSquares(chess, fromSquare, pieceType, color) {
  // Use chess.js to find all squares a piece on fromSquare attacks
  const attacked = [];
  const allSquares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      allSquares.push(squareName(r, c));
    }
  }

  // Get the piece's legal moves from that square (captures and non-captures)
  const moves = chess.moves({ square: fromSquare, verbose: true });
  // Note: after the move chess.turn() flipped, so we look at the post-move state
  // Instead, we check if the piece's potential moves attack any opponent squares
  // For attack detection, we use a simpler geometric approach

  const file = fromSquare.charCodeAt(0) - 97;
  const rank = parseInt(fromSquare[1]) - 1;

  const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const bishopDirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const rookDirs = [[-1,0],[1,0],[0,-1],[0,1]];

  if (pieceType === 'n') {
    for (const [dr, dc] of knightMoves) {
      const nr = rank + dr;
      const nc = file + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        attacked.push(squareName(7 - nr, nc));
      }
    }
  } else if (pieceType === 'b') {
    for (const [dr, dc] of bishopDirs) {
      addLinearAttacks(chess, attacked, rank, file, dr, dc);
    }
  } else if (pieceType === 'r') {
    for (const [dr, dc] of rookDirs) {
      addLinearAttacks(chess, attacked, rank, file, dr, dc);
    }
  } else if (pieceType === 'q') {
    for (const [dr, dc] of [...bishopDirs, ...rookDirs]) {
      addLinearAttacks(chess, attacked, rank, file, dr, dc);
    }
  } else if (pieceType === 'p') {
    const dir = color === 'w' ? 1 : -1;
    for (const dc of [-1, 1]) {
      const nr = rank + dir;
      const nc = file + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        attacked.push(squareName(7 - nr, nc));
      }
    }
  } else if (pieceType === 'k') {
    for (const [dr, dc] of [...bishopDirs, ...rookDirs]) {
      const nr = rank + dr;
      const nc = file + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        attacked.push(squareName(7 - nr, nc));
      }
    }
  }

  return attacked;
}

function addLinearAttacks(chess, attacked, rank, file, dr, dc) {
  let r = rank + dr;
  let c = file + dc;
  while (r >= 0 && r < 8 && c >= 0 && c < 8) {
    const sq = squareName(7 - r, c);
    attacked.push(sq);
    const piece = chess.get(sq);
    if (piece) break; // Blocked
    r += dr;
    c += dc;
  }
}

function getDirections(pieceType) {
  const bishop = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const rook = [[-1,0],[1,0],[0,-1],[0,1]];
  if (pieceType === 'b') return bishop;
  if (pieceType === 'r') return rook;
  if (pieceType === 'q') return [...bishop, ...rook];
  return [];
}

function scanLine(chess, fromSquare, dr, dc) {
  const pieces = [];
  const file = fromSquare.charCodeAt(0) - 97;
  const rank = parseInt(fromSquare[1]) - 1;

  let r = rank + dr;
  let c = file + dc;

  while (r >= 0 && r < 8 && c >= 0 && c < 8) {
    const sq = squareName(7 - r, c);
    const piece = chess.get(sq);
    if (piece) {
      pieces.push({ square: sq, piece });
      if (pieces.length >= 2) break;
    }
    r += dr;
    c += dc;
  }

  return pieces;
}

function countPawnsPerFile(board, color) {
  const counts = new Array(8).fill(0);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.type === 'p' && piece.color === color) {
        counts[col]++;
      }
    }
  }
  return counts;
}

function findKing(chess, color) {
  const board = chess.board();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.type === 'k' && piece.color === color) {
        return squareName(row, col);
      }
    }
  }
  return null;
}

export default { detectTheme };
