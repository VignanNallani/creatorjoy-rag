# CreatorJoy RAG Analyzer

Built this for the CreatorJoy technical round. Takes two video URLs 
(YouTube + Instagram Reel), pulls transcripts and metadata, embeds 
everything into a vector DB, and lets you compare them through a 
streaming AI chat. Learned ChromaDB and LangChain from scratch while 
building this.

---

## What it does

Paste two video URLs, hit Analyze. The backend spawns Python scripts 
that pull transcripts via youtube-transcript-api and yt-dlp, plus 
metadata (views, likes, comments, follower count, engagement rate). 
Transcripts get chunked and embedded using Cohere, stored in ChromaDB 
tagged with video_id A or B. Then you can ask things like "why did 
Video A get more engagement?" and get a streamed answer with citations 
showing exactly which chunk it came from.

---

## Stack

| Layer | Tool | Why I picked it |
|---|---|---|
| Frontend | React + Vite | Fast to set up, handled SSE streaming cleanly |
| Backend | Node.js + Express | My strongest area, good for spawning Python processes |
| Transcript | youtube-transcript-api + yt-dlp | Most reliable free option, no API key needed |
| Embeddings | Cohere embed-english-v3.0 | Free tier, 1024-dim vectors, built for search |
| Vector DB | ChromaDB | Runs locally, zero setup, no cost |
| LLM | Groq llama-3.3-70b-versatile | ~500 tok/s streaming, completely free |
| Orchestration | LangChain (retriever + prompt) | Handles retrieval chain cleanly |

---

## Why these choices (the honest version)

**ChromaDB over Pinecone** — Pinecone needs account setup, API keys, 
and adds network latency. ChromaDB runs locally with one command. 
At scale I'd move to Qdrant Cloud, but for this ChromaDB was the 
right call.

**Groq over GPT-4o** — GPT-4o free tier hit rate limits immediately. 
Groq runs Llama 3.3 70B at ~500 tokens/second for free. The streaming 
speed actually makes the chat feel premium.

**Cohere over OpenAI embeddings** — Cohere's embed-english-v3.0 has 
a separate input_type for documents vs queries which improves retrieval 
accuracy. Free tier was enough for this.

**800 character chunks, 100 overlap** — I tested 500 chars first. 
Retrieval was returning incomplete thoughts — half a sentence with no 
context. Moved to 800 and it got much better. The 100 char overlap 
makes sure nothing gets cut at a boundary.

**Instagram follower count** — Instagram blocks this without OAuth. 
I try channel_follower_count from yt-dlp, if it's missing I set it 
to null and add a note. Pipeline never crashes, the data just shows 
as unavailable.

---

## At 1000 creators/day — what breaks

- **Cohere free tier** hits limit fast. Fix: BGE-small running locally 
  (zero cost) or Cohere paid ($0.10/M tokens)
- **ChromaDB local** can't handle concurrent writes. Fix: Qdrant Cloud 
  or pgvector on Supabase
- **Spawning Python processes per request** will exhaust CPU. Fix: 
  BullMQ job queue with worker pool
- **In-memory session storage** leaks RAM and dies on restart. Fix: 
  Redis with TTL keys

---

## Running it locally

You need Node.js, Python 3.9+, and ChromaDB installed.

**1. Start ChromaDB**
chroma run --path ./chroma-data

**2. Backend**
cd backend
npm install
pip install youtube-transcript-api yt-dlp chromadb
node server.js

**3. Frontend**
cd frontend
npm install
npm run dev

Open http://localhost:5173

---

## .env.example
GROQ_API_KEY=
COHERE_API_KEY=
PORT=3001

---

## Known limitations

- Instagram follower count not always available (Instagram blocks it)
- Session memory is in-memory only — restarting server clears history
- ChromaDB is local — not suitable for multi-instance deployment
