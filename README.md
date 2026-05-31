# CreatorJoy RAG Analyzer

Built for the CreatorJoy technical round. Takes a YouTube URL and an 
Instagram Reel URL, pulls transcripts and metadata from both, embeds 
everything into ChromaDB, and lets you compare them through a streaming 
AI chat with source citations and memory across turns.

I learned ChromaDB and LangChain.js from scratch while building this. 
Took me a while to figure out why the SSE tokens were duplicating — 
turned out Express was flushing chunks twice. Fixed that. The trim() 
issue with streamed tokens took embarrassingly long to debug.

---

## Architecture

```
YouTube URL ─┐                    ┌─ ChromaDB (local vector store)
             ├─ Python scripts ───┤       tagged: video_id = A or B
Instagram ───┘   (yt-dlp +        └─ LangChain retriever
              transcript-api)            │
                    │                    ▼
              chunk (800 chars,   Groq llama-3.3-70b
              100 overlap)        streaming via SSE
                    │                    │
              Cohere embed         React frontend
              1024-dim vectors     (chat panel +
                                   video cards)
```

---

## What it does

Paste two URLs, hit Analyze. The backend spawns two Python scripts — 
one for YouTube, one for Instagram. Each script pulls the transcript 
and metadata (views, likes, comments, follower count, upload date, 
duration, hashtags). Engagement rate is computed dynamically: 
(likes + comments) / views × 100.

Transcripts get chunked at 800 characters with 100 char overlap, 
embedded with Cohere, and stored in ChromaDB tagged with video_id 
A or B. Then the chat opens — you can ask anything and the RAG 
retriever pulls the right chunks, streams the answer via SSE, 
and shows you exactly which video and chunk the answer came from.

Memory persists across turns using a manual buffer. The LLM sees 
the last N exchanges so follow-up questions work naturally.

---

## Stack decisions — the real reasoning

**Node.js over FastAPI**
My strongest area. FastAPI would've been cleaner for the Python 
embedding pipeline but I'd have spent more time fighting async 
patterns I don't know well. Node + spawning Python subprocesses 
was the right call for speed of execution.

**ChromaDB over Pinecone**
Pinecone adds network latency and needs account setup. ChromaDB 
runs locally with one command. At this scale (prototype, single 
user) local is faster and free. The trade-off is no concurrent 
writes — fine for now.

**Groq over GPT-4o**
GPT-4o free tier hit rate limits on my second test run. Groq 
runs Llama 3.3 70B at ~500 tokens/second for free. The streaming 
speed makes the chat feel snappy which matters for creator UX.

**Cohere over OpenAI embeddings**
Cohere's embed-english-v3.0 has a separate input_type for 
documents vs queries. That distinction improves retrieval 
precision — when you embed a chunk vs when you embed a question, 
they're treated differently. OpenAI embeddings don't expose that.

**800 char chunks, 100 overlap**
Started at 500. Retrieval was returning half-thoughts — the 
answer would start mid-sentence with no context. Moved to 800 
and retrieval got noticeably better. The 100 char overlap 
ensures nothing meaningful gets cut at a boundary. Could 
probably go to 1000 but didn't want to bloat the context.

**Instagram follower count — graceful null**
Instagram blocks follower count without OAuth. I tried 
channel_follower_count from yt-dlp metadata — sometimes 
it's there, usually it's not. Rather than crashing or 
hardcoding, I set it to null and surface a note in the UI. 
Pipeline never dies on missing data.

---

## What breaks at 1000 creators/day

| What breaks | Why | Fix |
|---|---|---|
| Cohere free tier | 1000 API calls/month limit | BGE-small locally (zero cost) or Cohere paid at $0.10/1M tokens |
| ChromaDB local | No concurrent writes, single process | Qdrant Cloud or pgvector on Supabase |
| Python subprocess per request | Forks a new process every time, exhausts CPU fast | BullMQ job queue with worker pool (4-8 workers) |
| In-memory session storage | Leaks RAM, dies on restart | Redis with TTL keys per session |
| Groq free tier | Rate limits under sustained load | Keep Groq but add exponential backoff, or self-host Llama on a $50/mo GPU VM |

Cost estimate at scale: BGE-small (free) + Qdrant Cloud (~$25/mo 
for 1M vectors) + Redis (~$10/mo) + Groq with backoff (free or 
~$20/mo) = **~$55/month for 1000 creators/day.** That's $0.055 
per creator session. Hard to beat.

---

## Running locally

You need Node.js 18+, Python 3.9+, and ChromaDB running.

**1. Clone and install**
```bash
git clone https://github.com/VignanNallani/creatorjoy-rag
cd creatorjoy-rag
```

**2. Set up environment**
```bash
cp .env.example backend/.env
# Fill in your GROQ_API_KEY and COHERE_API_KEY
```

**3. Start ChromaDB**
```bash
pip install chromadb
chroma run --path ./chroma-data
```

**4. Start backend**
```bash
cd backend
npm install
pip install youtube-transcript-api yt-dlp
node server.js
```

**5. Start frontend**
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, paste two URLs, hit Analyze.

---

## Known limitations

- Instagram follower count often unavailable (OAuth required)
- Session memory is in-process only — restart clears history
- ChromaDB is single-process — not safe for concurrent users
- yt-dlp breaks occasionally when Instagram changes their API

---

## What I'd build next

If this were a real product:
- Replace Python subprocess with a proper job queue (BullMQ)
- Add webhook support so creators paste URLs once and get 
  notified when analysis is ready
- Store sessions in Redis so analysis persists across visits
- Add a proper auth layer so each creator sees only their videos
