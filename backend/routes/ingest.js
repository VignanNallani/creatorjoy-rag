const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const { CohereClient } = require('cohere-ai');
const { ChromaClient } = require('chromadb');

// Helper to detect platform based on URL
function detectPlatform(url) {
  if (!url) return null;
  const lowercaseUrl = url.toLowerCase();
  if (lowercaseUrl.includes('youtube.com') || lowercaseUrl.includes('youtu.be')) {
    return 'youtube';
  } else if (lowercaseUrl.includes('instagram.com')) {
    return 'instagram';
  }
  return null;
}

// Helper to run Python extractors asynchronously via child_process spawn
function runExtractor(scriptPath, videoUrl) {
  return new Promise((resolve, reject) => {
    // Resolve absolute path to the Python script
    const absoluteScriptPath = path.resolve(__dirname, '../../', scriptPath);
    
    // Spawn python process
    const pythonProcess = spawn('python', [absoluteScriptPath, videoUrl]);
    
    let stdoutData = '';
    let stderrData = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python process exited with code ${code}. Stderr: ${stderrData}`));
      }
      try {
        const parsed = JSON.parse(stdoutData.trim());
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse Python script output: ${err.message}. Raw output: ${stdoutData}`));
      }
    });
    
    pythonProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// Manual chunking implementation: 800 chars with 100 char overlap
function chunkTranscript(text, chunkSize = 800, overlap = 100) {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += (chunkSize - overlap);
  }
  return chunks;
}

// POST /api/ingest
router.post('/', async (req, res) => {
  try {
    const { videoA_url, videoB_url } = req.body;
    
    if (!videoA_url || !videoB_url) {
      return res.status(400).json({ error: "Missing videoA_url or videoB_url in request body." });
    }

    // Detect platforms
    const platformA = detectPlatform(videoA_url);
    const platformB = detectPlatform(videoB_url);

    if (!platformA) {
      return res.status(400).json({ error: `Unsupported platform for videoA_url: ${videoA_url}. Only YouTube and Instagram are supported.` });
    }
    if (!platformB) {
      return res.status(400).json({ error: `Unsupported platform for videoB_url: ${videoB_url}. Only YouTube and Instagram are supported.` });
    }

    // Map script paths
    const scriptA = platformA === 'youtube' ? 'backend/extractors/youtube.py' : 'backend/extractors/instagram.py';
    const scriptB = platformB === 'youtube' ? 'backend/extractors/youtube.py' : 'backend/extractors/instagram.py';

    // Execute both extractors in parallel
    let metadataA, metadataB;
    try {
      [metadataA, metadataB] = await Promise.all([
        runExtractor(scriptA, videoA_url),
        runExtractor(scriptB, videoB_url)
      ]);
    } catch (extractionError) {
      return res.status(500).json({ error: `Extractor execution failed: ${extractionError.message}` });
    }

    // Check if extractors returned errors inside the JSON output
    if (metadataA.error) {
      return res.status(500).json({ error: `Extraction failed for Video A: ${metadataA.error}` });
    }
    if (metadataB.error) {
      return res.status(500).json({ error: `Extraction failed for Video B: ${metadataB.error}` });
    }

    // Chunk the transcripts
    const chunksA = chunkTranscript(metadataA.transcript || "");
    const chunksB = chunkTranscript(metadataB.transcript || "");

    // Prepare arrays for batch Cohere call and ChromaDB
    const allChunks = [];
    const allChunkIds = [];
    const allChunkMetadatas = [];

    // Map chunks A
    chunksA.forEach((chunk, index) => {
      allChunks.push(chunk);
      allChunkIds.push(`videoA_${index}`);
      allChunkMetadatas.push({
        video_id: 'videoA',
        url: videoA_url,
        title: metadataA.title || "",
        chunk_index: index
      });
    });

    // Map chunks B
    chunksB.forEach((chunk, index) => {
      allChunks.push(chunk);
      allChunkIds.push(`videoB_${index}`);
      allChunkMetadatas.push({
        video_id: 'videoB',
        url: videoB_url,
        title: metadataB.title || "",
        chunk_index: index
      });
    });

    // Connect to ChromaDB
    const chromaClient = new ChromaClient({
      path: process.env.CHROMA_URL || "http://localhost:8000"
    });

    // Initialize ChromaDB Collections with [0.1] dummy embedding functions to avoid warnings/empty embedding errors
    const dummyEmbedFn = { generate: async (texts) => texts.map(() => [0.1]) };
    const chunkCollection = await chromaClient.getOrCreateCollection({ 
      name: "video_chunks",
      embeddingFunction: dummyEmbedFn
    });
    const metadataCollection = await chromaClient.getOrCreateCollection({ 
      name: "video_metadata",
      embeddingFunction: dummyEmbedFn
    });

    // Clean up existing records for videoA and videoB from ChromaDB to ensure clean state
    try {
      // Clean chunks
      const existingChunksA = chunksA.map((_, i) => `videoA_${i}`);
      const existingChunksB = chunksB.map((_, i) => `videoB_${i}`);
      if (existingChunksA.length > 0) await chunkCollection.delete({ ids: existingChunksA });
      if (existingChunksB.length > 0) await chunkCollection.delete({ ids: existingChunksB });
    } catch (e) {
      // Ignore deletion errors if items didn't exist
    }

    try {
      // Clean metadata
      await metadataCollection.delete({ ids: ["videoA", "videoB"] });
    } catch (e) {
      // Ignore deletion errors if items didn't exist
    }

    // Generate embeddings if chunks exist
    if (allChunks.length > 0) {
      if (!process.env.COHERE_API_KEY) {
        return res.status(500).json({ error: "Missing COHERE_API_KEY environment variable." });
      }

      // Initialize Cohere
      const cohere = new CohereClient({
        token: process.env.COHERE_API_KEY
      });

      // Embed chunks in a single batch call
      const embedResponse = await cohere.embed({
        texts: allChunks,
        model: "embed-english-v3.0",
        inputType: "search_document"
      });

      const embeddings = embedResponse.embeddings;

      // Print first embedding length to verify it is populated
      if (embeddings && embeddings.length > 0) {
        console.log(`First chunk embedding length: ${embeddings[0].length}`);
      }

      // Store chunks in ChromaDB
      await chunkCollection.add({
        ids: allChunkIds,
        embeddings: embeddings,
        documents: allChunks,
        metadatas: allChunkMetadatas
      });
    }

    // Prepare metadata objects safe for ChromaDB metadatas (converting array tags to primitive strings)
    const prepareChromaMetadata = (video_id, url, meta) => ({
      video_id,
      url,
      title: meta.title || "",
      view_count: meta.view_count || 0,
      like_count: meta.like_count || 0,
      comment_count: meta.comment_count || 0,
      channel: meta.channel || "",
      subscriber_count: meta.subscriber_count || 0,
      upload_date: meta.upload_date || "",
      duration: meta.duration || 0,
      engagement_rate: meta.engagement_rate || 0,
      tags: Array.isArray(meta.tags) ? meta.tags.join(",") : ""
    });

    const metadataAChroma = prepareChromaMetadata("videoA", videoA_url, metadataA);
    const metadataBChroma = prepareChromaMetadata("videoB", videoB_url, metadataB);

    // Store metadata separately in ChromaDB
    await metadataCollection.add({
      ids: ["videoA", "videoB"],
      documents: [JSON.stringify(metadataA), JSON.stringify(metadataB)],
      metadatas: [metadataAChroma, metadataBChroma]
    });

    // Return successfully ingested metadata
    return res.status(200).json({
      videoA: {
        video_id: "videoA",
        url: videoA_url,
        title: metadataA.title,
        view_count: metadataA.view_count,
        like_count: metadataA.like_count,
        comment_count: metadataA.comment_count,
        channel: metadataA.channel,
        subscriber_count: metadataA.subscriber_count,
        tags: metadataA.tags,
        upload_date: metadataA.upload_date,
        duration: metadataA.duration,
        engagement_rate: metadataA.engagement_rate
      },
      videoB: {
        video_id: "videoB",
        url: videoB_url,
        title: metadataB.title,
        view_count: metadataB.view_count,
        like_count: metadataB.like_count,
        comment_count: metadataB.comment_count,
        channel: metadataB.channel,
        subscriber_count: metadataB.subscriber_count,
        tags: metadataB.tags,
        upload_date: metadataB.upload_date,
        duration: metadataB.duration,
        engagement_rate: metadataB.engagement_rate
      }
    });

  } catch (error) {
    console.error("Ingestion failed:", error);
    return res.status(500).json({ error: `Ingestion failed: ${error.message}` });
  }
});

module.exports = router;
