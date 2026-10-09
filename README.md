# ♟️ ChessMind — Backend API & Improvement Engine

> **Stockfish 19 Engine, Multi-Platform Game Sync & Mistake Intelligence API**  
> Powers the ChessMind coaching platform with automated Chess.com / Lichess archive ingestion, move-by-move Stockfish evaluation, evaluation drop categorization, tactical & positional theme detection, and coaching explanations.

---

## 🛠️ Architecture & Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express 5 + CORS
- **Chess Engine**: `stockfish` (v19 WASM Multithreaded)
- **Rules & Geometry**: `chess.js` (v1)
- **HTTP Client**: Axios (Public Chess.com & Lichess REST APIs)
- **Database (Optional)**: Supabase / PostgreSQL with Row-Level Security (`supabase_schema.sql`)
- **Persistence**: Graceful in-memory fallback for local prototype testing when Supabase keys are not set.

---

## 🧠 Mistake Classification Engine

The engine computes the absolute evaluation drop $\Delta\text{eval}$ from the player's perspective on every move:

| Classification | Eval Drop ($\Delta$) | Description |
| :--- | :--- | :--- |
| **Strategic Error** | `0.4 – 1.0` pawns | Suboptimal plan, wrong direction, or passive piece placement |
| **Positional Error** | `1.0 – 2.0` pawns | Created lasting structural/square weakness or conceded an outpost |
| **Tactical Blunder** | `> 2.0` pawns | Missed combination, allowed fork/pin, or left material hanging |

### Tactical & Positional Theme Detector
Detects specific tactical patterns:
- **Fork**: Double attacks on unprotected pieces or king
- **Pin**: Absolute and relative pins on high-value targets
- **Skewer**: Attack through a piece to an exposed defender behind it
- **Hanging Piece**: Free material left without adequate defense
- **Missed Check / Checkmate**: Missed forcing lines
- **Pawn Structure / Weak Squares**: Structural damage & open file concessions

---

## 📡 API Endpoints

### 1. Health & Engine Status
- `GET /api/health` — Checks API liveness and engine availability.

### 2. Profile & Account Integration
- `POST /api/profile/connect` — Connects a public Chess.com or Lichess account (no password required).
  - Body: `{ platform: "chesscom" | "lichess", username: "string" }`
- `GET /api/profile/:platform/:username` — Fetches player profile details and ratings.

### 3. Game Archives & Sync
- `POST /api/games/fetch` — Ingests up to $N$ recent games from Chess.com or Lichess, parses PGNs, extracts opening names, and deduplicates against existing records.
  - Body: `{ platform: "chesscom" | "lichess", username: "string", max_games: 30 }`
- `GET /api/games/list?platform=...&username=...` — Lists imported games.
- `GET /api/games/:id` — Retrieves a specific game by ID with full PGN.

### 4. Game Analysis & Stockfish Diagnosis
- `POST /api/analysis/analyze` — Evaluates all moves of a PGN using Stockfish, classifies errors, identifies themes, and generates coaching explanations.
  - Body: `{ pgn: "string", player_color: "white" | "black", game_id?: "string", depth?: 12 }`
- `GET /api/analysis/:gameId` — Fetches stored analysis and mistake diagnostics for a game.
- `GET /api/analysis/status/:gameId` — Returns analysis job status (`pending`, `analyzing`, `complete`).

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

```env
PORT=3001

# Optional: Supabase configuration for cloud database persistence
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```
*(If Supabase credentials are not provided, the server runs in-memory session mode seamlessly).*

### 3. Run the Backend
```bash
# Start server with Stockfish initialized
npm start

# Or in development
npm run dev
```

The server will start on **`http://localhost:3001`**.

---

## 🗄️ Database Setup (Supabase)

To enable persistent cloud storage across user sessions:
1. Create a free project on [Supabase](https://supabase.com).
2. Open the **SQL Editor** in the Supabase dashboard.
3. Paste and run the entire contents of `supabase_schema.sql`.
4. Copy your project URL and keys into `.env`.
