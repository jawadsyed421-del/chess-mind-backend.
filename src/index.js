import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import profileRoutes from './routes/profile.js';
import gamesRoutes from './routes/games.js';
import analysisRoutes from './routes/analysis.js';
import { getStockfish } from './services/stockfish.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  // Any localhost / 127.0.0.1 port, so Vite can fall back to 5174, 5175... when 5173 is busy.
  origin: [
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
    // Deployed frontends: comma-separated list, e.g. CORS_ORIGINS=https://chess-mind.vercel.app
    ...(process.env.CORS_ORIGINS || '').split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean),
  ],
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ChessMind API',
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api/profile', profileRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/analysis', analysisRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  console.log(`\n  ♟️  ChessMind API running on http://localhost:${PORT}`);
  console.log(`  📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`  🧠 Initializing Stockfish engine...`);
  try {
    await getStockfish();
  } catch (err) {
    console.warn('  ⚠️  Stockfish init warning:', err.message);
  }
  console.log(`  🚀 ChessMind is ready!\n`);
});
