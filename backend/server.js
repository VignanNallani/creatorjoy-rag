/**
 * CreatorJoy RAG Analyzer - Backend Server
 * 
 * Request Flow Architecture:
 * 1. INGESTION (/api/ingest):
 *    - Receives a POST request with videoAUrl and videoBUrl from the React frontend.
 *    - Spawns parallel Python child processes:
 *      - extractors/youtube.py: retrieves transcript & metrics (views, likes, comments, subscriber_count)
 *      - extractors/instagram.py: retrieves reel transcript & metrics (views, likes, comments, fallback follower_count)
 *    - Receives raw JSON output, then chunks transcripts locally in Node.js (800-character chunks, 100-character overlap).
 *    - Embeds chunks using Cohere's embed-english-v3.0 API in batches.
 *    - Persists vector embeddings and metadata in local ChromaDB collections, partitioned by video_id ('videoA' / 'videoB').
 * 
 * 2. CHAT (/api/chat):
 *    - Receives user messages alongside session_id for manual conversation memory preservation.
 *    - Queries ChromaDB collections using the user question query vector to retrieve top context chunks.
 *    - Construct a high-fidelity prompt injected with the retrieved transcript segments and their source citations.
 *    - Initiates a direct Axios streamed connection to Groq API using Llama-3.3-70b-versatile.
 *    - Pipes streamed Server-Sent Events (SSE) tokens directly back to the client while logging session history.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import routes
const ingestRoutes = require('./routes/ingest');
const chatRoutes = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS and Express JSON body parsing
app.use(cors());
app.use(express.json());

// Health check GET /health returns {status: 'ok'}
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Mount routes
app.use('/api/ingest', ingestRoutes);
app.use('/api/chat', chatRoutes);

// Start listening
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
