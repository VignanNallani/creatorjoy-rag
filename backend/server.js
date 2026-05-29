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
