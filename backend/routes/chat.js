const express = require('express');
const router = express.Router();
const axios = require('axios');
const { CohereEmbeddings } = require("@langchain/cohere");
const { Chroma } = require("@langchain/community/vectorstores/chroma");

// High-fidelity custom implementation of ConversationBufferMemory to bypass legacy export paths missing in langchain v1.4.2
class ConversationBufferMemory {
  constructor(options = {}) {
    this.returnMessages = options.returnMessages ?? true;
    this.memoryKey = options.memoryKey ?? "chat_history";
    this.inputKey = options.inputKey ?? "input";
    this.outputKey = options.outputKey ?? "output";
    this.history = [];
  }

  async loadMemoryVariables(values = {}) {
    return {
      [this.memoryKey]: this.history
    };
  }

  async saveContext(inputValues, outputValues) {
    const input = inputValues[this.inputKey];
    const output = outputValues[this.outputKey];
    
    // Append standard message wrappers behaving identically to LangChain BaseMessage objects
    this.history.push({
      _getType: () => 'human',
      content: input
    });
    this.history.push({
      _getType: () => 'ai',
      content: output
    });
  }
}

// Simple in-memory session history database
const memoryStore = {};

function getMemoryForSession(sessionId) {
  if (!memoryStore[sessionId]) {
    memoryStore[sessionId] = new ConversationBufferMemory({
      returnMessages: true,
      memoryKey: "chat_history",
      inputKey: "input",
      outputKey: "output"
    });
  }
  return memoryStore[sessionId];
}

// POST /api/chat
router.post('/', async (req, res) => {
  let memory;
  try {
    const { message, session_id } = req.body;

    if (!message || !session_id) {
      return res.status(400).json({ error: "Missing message or session_id in request body." });
    }

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 1. Get/Initialize memory for the session_id
    memory = getMemoryForSession(session_id);
    const memoryVars = await memory.loadMemoryVariables({});
    const chatHistory = memoryVars.chat_history || [];

    // Format chat history to plain text for the prompt
    let historyText = "";
    if (Array.isArray(chatHistory)) {
      historyText = chatHistory.map(m => {
        const role = m._getType?.() === 'human' ? 'Human' : 'AI';
        return `${role}: ${m.content}`;
      }).join("\n");
    }

    // 2. Initialize CohereEmbeddings for query encoding
    if (!process.env.COHERE_API_KEY) {
      throw new Error("Missing COHERE_API_KEY environment variable.");
    }
    const embeddings = new CohereEmbeddings({
      apiKey: process.env.COHERE_API_KEY,
      model: "embed-english-v3.0"
    });

    // 3. Initialize Chroma community vector store
    const vectorStore = new Chroma(embeddings, {
      collectionName: "video_chunks",
      url: process.env.CHROMA_URL || "http://localhost:8000"
    });

    // 4. Retrieve top 4 relevant chunks from ChromaDB
    const retriever = vectorStore.asRetriever({
      k: 4
    });

    let relevantDocs = [];
    try {
      relevantDocs = await retriever.invoke(message);
    } catch (retrievalError) {
      console.warn("ChromaDB retrieval failed (collection might be empty):", retrievalError.message);
      // Fallback: carry on with empty context if collection is empty or not initialized
    }

    // 5. Build context string showing which video and chunk index each block came from
    const formattedContext = relevantDocs.map((doc, idx) => {
      const metadata = doc.metadata || {};
      const videoId = metadata.video_id || "unknown";
      const title = metadata.title || "Untitled";
      const chunkIndex = metadata.chunk_index !== undefined ? metadata.chunk_index : idx;
      return `[Source Video: ${videoId}, Chunk Index: ${chunkIndex}, Title: "${title}"]\nTranscript Piece: ${doc.pageContent}`;
    }).join("\n\n");

    // 6. Build the prompt template instructing the LLM to cite its sources
    const systemPrompt = `You are a professional video analysis assistant.
You are comparing and analyzing two videos: Video A (video_id: videoA) and Video B (video_id: videoB).
Use the retrieved video transcript chunks below as context to answer the user's message.

For each claim or statement you make, you MUST explicitly cite which video and chunk it comes from (e.g. "[videoA, Chunk 2]" or "[videoB, Chunk 0]"). Keep citations concise and clear.

Context:
${formattedContext || "No relevant transcript context found for this query."}

Conversation History:
${historyText || "No previous history."}

Human: ${message}
AI:`;

    // 7. Call Groq with direct API call
    if (!process.env.GROQ_API_KEY) {
      throw new Error("Missing GROQ_API_KEY environment variable.");
    }

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: systemPrompt }],
        stream: true
      },
      {
        headers: {
          "Authorization": "Bearer " + process.env.GROQ_API_KEY,
          "Content-Type": "application/json"
        },
        responseType: "stream"
      }
    );

    // 8. Stream the response using SSE and pipe to client
    let fullResponseText = "";
    response.data.on("data", chunk => {
      const lines = chunk.toString().split("\n").filter(l => l.startsWith("data: "));
      for (const line of lines) {
        const json = line.replace("data: ", "").trim();
        if (json === "[DONE]") {
          return;
        }
        try {
          const parsed = JSON.parse(json);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullResponseText += token;
            res.write("data: " + token + "\n\n");
          }
        } catch(e) {}
      }
    });

    response.data.on("end", async () => {
      try {
        await memory.saveContext(
          { input: message },
          { output: fullResponseText }
        );
      } catch (memError) {
        console.error("Failed to save memory context:", memError);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });

    response.data.on("error", error => {
      console.error("OpenRouter stream error:", error);
      res.write(`data: Error: ${error.message}\n\n`);
      res.end();
    });

  } catch (error) {
    console.error("Chat routing error:", error);
    // If headers are not sent, return standard JSON error
    if (!res.headersSent) {
      res.status(500).json({ error: `Chat operation failed: ${error.message}` });
    } else {
      // If we are in the middle of SSE streaming, send error inside SSE format
      res.write(`data: Error: ${error.message}\n\n`);
      res.end();
    }
  }
});

module.exports = router;
