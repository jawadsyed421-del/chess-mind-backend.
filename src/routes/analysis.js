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

// Runs the engine over a game and stores the result.
async function runGameAnalysis(pgn, playerColor, depth, gameId) {
  if (gameId && supabase) {
    await supabase.from('games').update({ analysis_status: 'analyzing' }).eq('id', gameId);
  }
  try {
    const result = await analyzeGame(pgn, playerColor, Math.min(Number(depth) || 12, 16));
    if (gameId) {
      analysisStore.set(gameId, result);
      if (analysisStore.size > 300) analysisStore.delete(analysisStore.keys().next().value); // keep memory bounded
      if (supabase) {
        await supabase.from('games').update({ analysis_status: 'complete' }).eq('id', gameId);
        for (const mistake of result.mistakes) {
          await supabase.from('move_analysis').upsert({
            game_id: gameId,
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
    return result;
  } catch (error) {
    if (gameId && supabase) {
      await supabase.from('games').update({ analysis_status: 'pending' }).eq('id', gameId).catch(() => {});
    }
    throw error;
  }
}

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

    const force = req.body.force === true;

    // Already analysed: answer instantly
    if (game_id && !force && analysisStore.has(game_id)) {
      return res.json({ status: 'complete', analysis: analysisStore.get(game_id), cached: true });
    }

    // Already being analysed (e.g. by the background import job): wait for that run instead of starting another
    let job = game_id ? activeJobs.get(game_id) : null;
    if (!job) {
      // The engine is a single instance, so games and position requests take turns.
      job = engineQueue.then(() => runGameAnalysis(pgn, player_color, depth, game_id));
      engineQueue = job.catch(() => {});
      if (game_id) {
        activeJobs.set(game_id, job);
        job.then(() => activeJobs.delete(game_id), () => activeJobs.delete(game_id));
      }
    }
    const result = await job;

    res.json({
      status: 'complete',
      analysis: result,
    });
  } catch (error) {
    console.error('Analysis error:', error);

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
