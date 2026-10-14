import { Router } from 'express';
import { Chess } from 'chess.js';
import { analyzeGame } from '../services/gameAnalyzer.js';
import { getStockfish } from '../services/stockfish.js';
import { supabase } from '../config/supabase.js';

const router = Router();

// In-memory store for analysis results when Supabase is not configured
const analysisStore = new Map();

// Track active analysis jobs
const activeJobs = new Map();

// The engine is a single instance, so position requests run one at a time.
let engineQueue = Promise.resolve();

/**
 * POST /api/analysis/position
 * Evaluate one position: score (pawns, White's view), best move and the main line, all in SAN.
 */
router.post('/position', async (req, res) => {
  const { fen, depth = 14 } = req.body || {};
  try {
    new Chess(fen);
  } catch {
    return res.status(400).json({ error: 'Invalid FEN' });
  }

  const job = engineQueue.then(async () => {
    const stockfish = await getStockfish();
    const result = await stockfish.evaluatePosition(fen, Math.min(Math.max(Number(depth) || 14, 8), 18));
    const line = new Chess(fen);
    const pvSan = [];
    for (const uci of (result.pv || '').split(' ').filter(Boolean).slice(0, 6)) {
      try {
        pvSan.push(line.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
      } catch {
        break;
      }
    }
    return {
      score: result.score,
      mate: result.mate,
      bestMove: result.bestMove,
      bestMoveSan: stockfish.uciToSan(fen, result.bestMove),
      pv: pvSan,
    };
  });
  engineQueue = job.catch(() => {});

  try {
    res.json(await job);
  } catch (error) {
    console.error('Position eval error:', error.message);
    res.status(500).json({ error: 'Engine evaluation failed' });
  }
});

/**
 * POST /api/analysis/analyze
 * Analyze a game using Stockfish + Mistake Classifier + Theme Detector
 */
router.post('/analyze', async (req, res) => {
  try {
    const { pgn, player_color, game_id, depth = 14 } = req.body;

    if (!pgn) {
      return res.status(400).json({ error: 'PGN is required' });
    }

    if (!player_color || !['white', 'black'].includes(player_color)) {
      return res.status(400).json({ error: 'player_color must be "white" or "black"' });
    }

    // Check if already analyzing this game
    if (game_id && activeJobs.has(game_id)) {
      return res.json({
        status: 'analyzing',
        message: 'This game is already being analyzed. Check back shortly.',
      });
    }

    // Mark as active
    if (game_id) {
      activeJobs.set(game_id, true);

      // Update game status in Supabase
      if (supabase) {
        await supabase
          .from('games')
          .update({ analysis_status: 'analyzing' })
          .eq('id', game_id);
      }
    }

    // Run the full analysis pipeline
    console.log(`\n  ═══════════════════════════════════════`);
    console.log(`  ♟️  ChessMind Analysis Engine Starting`);
    console.log(`  ═══════════════════════════════════════`);

    const result = await analyzeGame(pgn, player_color, Math.min(depth, 16));

    // Store results
    if (game_id) {
      analysisStore.set(game_id, result);
      activeJobs.delete(game_id);

      // Store in Supabase if available
      if (supabase) {
        // Update game status
        await supabase
          .from('games')
          .update({ analysis_status: 'complete' })
          .eq('id', game_id);

        // Store individual move analysis entries
        for (const mistake of result.mistakes) {
          await supabase.from('move_analysis').upsert({
            game_id,
            move_number: mistake.moveNumber,
            player_color: mistake.color === 'w' ? 'white' : 'black',
            fen_before: mistake.fenBefore,
            fen_after: mistake.fenAfter,
            move_played: mistake.moveSan,
            best_move: mistake.bestMoveSan,
            eval_before: mistake.evalBefore,
            eval_after: mistake.evalAfter,
            eval_drop: mistake.evalDrop,
            mistake_type: mistake.type,
            tactical_theme: mistake.theme,
            explanation: mistake.explanation,
            better_move_explanation: mistake.betterMoveExplanation,
          });
        }
      }
    }

    res.json({
      status: 'complete',
      analysis: result,
    });
  } catch (error) {
    console.error('Analysis error:', error);

    // Clean up
    const { game_id } = req.body;
    if (game_id) {
      activeJobs.delete(game_id);
      if (supabase) {
        await supabase
          .from('games')
          .update({ analysis_status: 'pending' })
          .eq('id', game_id)
          .catch(() => {});
      }
    }

    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

/**
 * GET /api/analysis/:gameId
 * Retrieve stored analysis for a game
 */
router.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;

    // Check in-memory store first
    if (analysisStore.has(gameId)) {
      return res.json({
        status: 'complete',
        analysis: analysisStore.get(gameId),
      });
    }

    // Check Supabase
    if (supabase) {
      const { data: mistakes, error } = await supabase
        .from('move_analysis')
        .select('*')
        .eq('game_id', gameId)
        .order('move_number', { ascending: true });

      if (error) throw error;

      if (mistakes && mistakes.length > 0) {
        return res.json({
          status: 'complete',
          analysis: {
            mistakes: mistakes.map(m => ({
              moveIndex: m.move_number * 2 - (m.player_color === 'white' ? 2 : 1),
              moveNumber: m.move_number,
              color: m.player_color === 'white' ? 'w' : 'b',
              moveSan: m.move_played,
              fenBefore: m.fen_before,
              fenAfter: m.fen_after,
              bestMoveSan: m.best_move,
              evalBefore: parseFloat(m.eval_before),
              evalAfter: parseFloat(m.eval_after),
              evalDrop: parseFloat(m.eval_drop),
              type: m.mistake_type,
              theme: m.tactical_theme,
              explanation: m.explanation,
              betterMoveExplanation: m.better_move_explanation,
            })),
          },
        });
      }
    }

    // Check if currently analyzing
    if (activeJobs.has(gameId)) {
      return res.json({
        status: 'analyzing',
        message: 'Analysis is in progress...',
      });
    }

    res.json({ status: 'pending', message: 'No analysis found. Submit game for analysis.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analysis/status/:gameId
 * Quick check if a game has been analyzed
 */
router.get('/status/:gameId', async (req, res) => {
  const { gameId } = req.params;

  if (activeJobs.has(gameId)) {
    return res.json({ status: 'analyzing' });
  }

  if (analysisStore.has(gameId)) {
    return res.json({ status: 'complete' });
  }

  res.json({ status: 'pending' });
});

export default router;
