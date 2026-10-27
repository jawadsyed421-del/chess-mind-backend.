import { Chess } from 'chess.js';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * StockfishService — Wraps the Stockfish WASM engine for position evaluation.
 *
 * Usage:
 *   const sf = new StockfishService();
 *   await sf.init();
 *   const eval = await sf.evaluatePosition(fen, depth);
 *   const bestMove = await sf.getBestMove(fen, depth);
 *   sf.quit();
 */
export class StockfishService {
  constructor() {
    this.engine = null;
    this.ready = false;
    this.messageQueue = [];
    this.currentResolve = null;
    this.outputBuffer = [];
  }

  /**
   * Initialize the Stockfish engine
   */
  async init() {
    try {
      const require = createRequire(import.meta.url);
      const STOCKFISH = require('stockfish');

      if (typeof STOCKFISH === 'function') {
        // The default build loads a ~95 MB network (about 560 MB RAM), which exceeds small hosts.
        // Set STOCKFISH_VARIANT=lite-single (the default on Render) for a ~100 MB engine.
        const variant = process.env.STOCKFISH_VARIANT || (process.env.RENDER ? 'lite-single' : '');
        const enginePath = variant
          ? path.join(path.dirname(require.resolve('stockfish')), 'bin', `stockfish-19-${variant}.js`)
          : undefined;
        const engine = await STOCKFISH(enginePath);
        this.wasmEngine = engine;
        engine.listener = (msg) => this._onMessage(msg);
        engine.print = (msg) => this._onMessage(msg);
        engine.printErr = () => {};

        // Send UCI init
        this._sendCommand('uci');
        await this._waitForMessage('uciok');
        this._sendCommand('isready');
        await this._waitForMessage('readyok');
        this._sendCommand('setoption name Threads value 1');
        this._sendCommand('setoption name Hash value 32');
        this.ready = true;
        console.log('  ✅ Stockfish 19 WASM engine initialized successfully');
        return;
      }

      // If it's a string path for worker
      if (typeof STOCKFISH === 'string') {
        this.engine = new Worker(STOCKFISH);
        this.engine.on('message', (msg) => this._onMessage(msg));
        this.engine.on('error', (err) => console.error('Stockfish worker error:', err));
        this._sendCommand('uci');
        await this._waitForMessage('uciok');
        this._sendCommand('isready');
        await this._waitForMessage('readyok');
        this._sendCommand('setoption name Threads value 1');
        this._sendCommand('setoption name Hash value 32');
        this.ready = true;
        console.log('  ✅ Stockfish Worker engine initialized successfully');
        return;
      }

      await this._initFallback();
    } catch (error) {
      console.warn('  ⚠️ Stockfish WASM load failed, using fallback:', error.message);
      await this._initFallback();
    }
  }

  /**
   * Fallback initialization using child_process to run stockfish binary
   */
  async _initFallback(resolve, reject) {
    try {
      const { spawn } = await import('child_process');

      // Try to find stockfish in PATH
      const stockfishBinary = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish';
      this.process = spawn(stockfishBinary, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => this._onMessage(line));
      });

      this.process.stderr.on('data', (data) => {
        // Ignore stderr
      });

      this.process.on('error', () => {
        console.log('  ℹ️  Stockfish binary not found in PATH. Using heuristic evaluator.');
        this.ready = false;
        this.useHeuristic = true;
        resolve();
      });

      this._sendCommand('uci');
      this._waitForMessage('uciok').then(() => {
        this._sendCommand('isready');
        return this._waitForMessage('readyok');
      }).then(() => {
        this._sendCommand('setoption name Threads value 1');
        this._sendCommand('setoption name Hash value 32');
        this.ready = true;
        console.log('  ✅ Stockfish binary engine initialized');
        resolve();
      }).catch(() => {
        this.useHeuristic = true;
        this.ready = false;
        resolve();
      });
    } catch (error) {
      console.log('  ℹ️  Using heuristic evaluator (Stockfish binary not available).');
      this.useHeuristic = true;
      this.ready = false;
      resolve();
    }
  }

  _sendCommand(cmd) {
    if (this.wasmEngine && typeof this.wasmEngine.sendCommand === 'function') {
      this.wasmEngine.sendCommand(cmd);
    } else if (this.engine && typeof this.engine.postMessage === 'function') {
      this.engine.postMessage(cmd);
    } else if (this.process && this.process.stdin) {
      this.process.stdin.write(cmd + '\n');
    }
  }

  _onMessage(message) {
    const msg = typeof message === 'string' ? message : message.toString();
    this.outputBuffer.push(msg);

    if (this.currentResolve) {
      const { keyword, resolve } = this.currentResolve;
      if (msg.includes(keyword)) {
        this.currentResolve = null;
        resolve(this.outputBuffer.slice());
        this.outputBuffer = [];
      }
    }
  }

  _waitForMessage(keyword, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      // Check if already in buffer
      const found = this.outputBuffer.find(m => m.includes(keyword));
      if (found) {
        resolve(this.outputBuffer.slice());
        this.outputBuffer = [];
        return;
      }

      this.currentResolve = { keyword, resolve };

      setTimeout(() => {
        if (this.currentResolve?.keyword === keyword) {
          this.currentResolve = null;
          reject(new Error(`Stockfish timeout waiting for "${keyword}"`));
        }
      }, timeoutMs);
    });
  }

  /**
   * Evaluate a FEN position and return centipawn score + best move.
   * @param {string} fen - The position in FEN format
   * @param {number} depth - Search depth (12-16 recommended)
   * @returns {{ score: number, bestMove: string, mate: number|null, pv: string }}
   */
  async evaluatePosition(fen, depth = 12, moveTimeMs = 0) {
    if (this.useHeuristic || !this.ready) {
      return this._heuristicEval(fen);
    }

    this.outputBuffer = [];
    this._sendCommand(`position fen ${fen}`);
    // movetime caps the search so a slow host still finishes a whole game quickly
    this._sendCommand(moveTimeMs > 0 ? `go depth ${depth} movetime ${moveTimeMs}` : `go depth ${depth}`);

    const output = await this._waitForMessage('bestmove', 30000);
    return this._parseEvalOutput(output, fen);
  }

  /**
   * Parse Stockfish output lines to extract evaluation and best move.
   */
  _parseEvalOutput(lines, fen) {
    let score = 0;
    let mate = null;
    let bestMove = null;
    let pv = '';

    for (const line of lines) {
      // Extract the deepest "info" line with score
      if (line.includes('info') && line.includes('score')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        const pvMatch = line.match(/ pv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/); // not the "pv" inside "multipv"

        if (cpMatch) {
          score = parseInt(cpMatch[1]) / 100; // Convert centipawns to pawns
        }
        if (mateMatch) {
          mate = parseInt(mateMatch[1]);
          score = mate > 0 ? 100 : -100; // Use large value for mate
        }
        if (pvMatch) {
          pv = pvMatch[1].trim();
        }
      }

      // Extract the bestmove
      if (line.startsWith('bestmove')) {
        const moveMatch = line.match(/bestmove (\S+)/);
        if (moveMatch) {
          bestMove = moveMatch[1];
        }
      }
    }

    // Adjust score relative to side to move
    const chess = new Chess(fen);
    if (chess.turn() === 'b') {
      score = -score;
      if (mate !== null) mate = -mate;
    }

    return { score, bestMove, mate, pv };
  }

  /**
   * Heuristic evaluation for when Stockfish binary is not available.
   * Uses material count + simple positional factors.
   */
  _heuristicEval(fen) {
    const chess = new Chess(fen);
    const board = chess.board();

    const pieceValues = { p: 1, n: 3, b: 3.15, r: 5, q: 9, k: 0 };
    let materialScore = 0;
    let whiteMobility = 0;
    let blackMobility = 0;

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (!piece) continue;
        const val = pieceValues[piece.type] || 0;
        if (piece.color === 'w') {
          materialScore += val;
          // Center control bonus
          if (row >= 2 && row <= 5 && col >= 2 && col <= 5) materialScore += 0.1;
        } else {
          materialScore -= val;
          if (row >= 2 && row <= 5 && col >= 2 && col <= 5) materialScore -= 0.1;
        }
      }
    }

    // Add some randomness to simulate evaluation variation
    const noise = (Math.random() - 0.5) * 0.3;
    const score = Math.round((materialScore + noise) * 100) / 100;

    // Generate a plausible best move
    const moves = chess.moves({ verbose: true });
    const bestMoveObj = moves[0]; // Just pick first legal move for heuristic

    return {
      score,
      bestMove: bestMoveObj ? `${bestMoveObj.from}${bestMoveObj.to}` : null,
      mate: null,
      pv: '',
    };
  }

  /**
   * Convert UCI move notation (e2e4) to SAN notation (e4) for a given position.
   */
  uciToSan(fen, uciMove) {
    if (!uciMove || uciMove === '(none)') return null;

    try {
      const chess = new Chess(fen);
      const from = uciMove.substring(0, 2);
      const to = uciMove.substring(2, 4);
      const promotion = uciMove.length > 4 ? uciMove[4] : undefined;

      const move = chess.move({ from, to, promotion });
      return move ? move.san : uciMove;
    } catch {
      return uciMove;
    }
  }

  /**
   * Shutdown the engine.
   */
  quit() {
    try {
      this._sendCommand('quit');
      if (this.engine && typeof this.engine.terminate === 'function') {
        this.engine.terminate();
      }
      if (this.process) {
        this.process.kill();
      }
    } catch {}
  }
}

// Singleton instance
let _instance = null;

export async function getStockfish() {
  if (!_instance) {
    _instance = new StockfishService();
    await _instance.init();
  }
  return _instance;
}

export default StockfishService;
