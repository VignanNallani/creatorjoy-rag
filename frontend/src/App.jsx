import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const BACKEND_URL = "http://localhost:3001";

export default function App() {
  // Generate session_id once on load using crypto.randomUUID()
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  // App States
  const [videoAUrl, setVideoAUrl] = useState("");
  const [videoBUrl, setVideoBUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [videoData, setVideoData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [streaming, setStreaming] = useState(false);

  const chatEndRef = useRef(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streaming]);

  // Ingest handler
  const handleIngest = async (e) => {
    e.preventDefault();
    if (!videoAUrl.trim() || !videoBUrl.trim()) {
      alert("Please provide both Video A and Video B URLs.");
      return;
    }

    setLoading(true);
    setVideoData(null);
    setMessages([]);

    try {
      const response = await fetch(`${BACKEND_URL}/api/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoA_url: videoAUrl.trim(),
          videoB_url: videoBUrl.trim(),
          videoBUrl: videoBUrl.trim() // fallback safety
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Injest request failed.");
      }

      setVideoData(data);
    } catch (error) {
      console.error(error);
      alert(`Ingestion Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Chat message sending with SSE stream parsing
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || streaming || !videoData) return;

    const userQuery = inputMessage.trim();
    setInputMessage("");

    // Append user message and prepare an empty AI response bubble
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userQuery },
      { role: 'ai', content: "" }
    ]);

    setStreaming(true);

    try {
      const response = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userQuery,
          session_id: sessionId
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to establish connection.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        let lineEnd;
        while ((lineEnd = buffer.indexOf("\n")) !== -1) {
          let line = buffer.substring(0, lineEnd);
          buffer = buffer.substring(lineEnd + 1);

          // Strip carriage return for Windows compatibility
          if (line.endsWith("\r")) {
            line = line.slice(0, -1);
          }

          if (line.startsWith("data: ")) {
            const token = line.substring(6);

            if (token.trim() === "[DONE]") {
              setStreaming(false);
              break;
            }

            if (token) {
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                const last = updated[lastIdx];
                if (last && last.role === 'ai') {
                  updated[lastIdx] = {
                    ...last,
                    content: last.content + token
                  };
                }
                return updated;
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        const last = updated[lastIdx];
        if (last && last.role === 'ai') {
          updated[lastIdx] = {
            ...last,
            content: `Error: ${error.message}`
          };
        }
        return updated;
      });
      setStreaming(false);
    }
  };

  // Reset handler to compare new videos
  const handleReset = () => {
    setVideoAUrl("");
    setVideoBUrl("");
    setVideoData(null);
    setMessages([]);
    setInputMessage("");
    setSessionId(crypto.randomUUID());
  };

  // Inline premium style rules
  const styles = {
    appContainer: {
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '24px',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
    },
    header: {
      background: 'rgba(30, 41, 59, 0.7)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: '16px',
      padding: '20px 32px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
    },
    title: {
      fontSize: '28px',
      fontWeight: '800',
      background: 'linear-gradient(90deg, #818cf8 0%, #c084fc 100%)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      margin: 0,
      letterSpacing: '-0.5px'
    },
    badge: {
      background: 'rgba(99, 102, 241, 0.15)',
      border: '1px solid rgba(99, 102, 241, 0.3)',
      color: '#a5b4fc',
      borderRadius: '20px',
      padding: '6px 14px',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: 'monospace'
    },
    glassCard: {
      background: 'rgba(30, 41, 59, 0.45)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: '24px',
      padding: '32px',
      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
    },
    inputGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
      marginBottom: '24px'
    },
    inputWrapper: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    },
    label: {
      fontSize: '13px',
      fontWeight: '600',
      color: '#94a3b8',
      textTransform: 'uppercase',
      letterSpacing: '1px'
    },
    input: {
      background: 'rgba(15, 23, 42, 0.6)',
      border: '1px solid #334155',
      borderRadius: '12px',
      padding: '14px 18px',
      color: '#f8fafc',
      fontSize: '15px',
      outline: 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      width: '100%'
    },
    button: {
      background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
      color: '#ffffff',
      border: 'none',
      borderRadius: '12px',
      padding: '16px 28px',
      fontSize: '16px',
      fontWeight: '700',
      cursor: 'pointer',
      boxShadow: '0 4px 14px 0 rgba(99, 102, 241, 0.4)',
      width: '100%',
      transition: 'transform 0.1s, opacity 0.2s',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px'
    },
    cardGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '24px',
    },
    videoCard: {
      background: 'rgba(30, 41, 59, 0.45)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: '24px',
      padding: '24px',
      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    },
    videoHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: '12px'
    },
    videoTitle: {
      fontSize: '18px',
      fontWeight: '700',
      color: '#f8fafc',
      margin: 0,
      lineHeight: '1.4',
    },
    channelBadge: {
      background: 'rgba(168, 85, 247, 0.15)',
      border: '1px solid rgba(168, 85, 247, 0.3)',
      color: '#d8b4fe',
      borderRadius: '8px',
      padding: '4px 8px',
      fontSize: '12px',
      fontWeight: '600',
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '12px',
      background: 'rgba(15, 23, 42, 0.4)',
      padding: '16px',
      borderRadius: '16px',
      border: '1px solid rgba(255, 255, 255, 0.02)'
    },
    statBox: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      textAlign: 'center'
    },
    statVal: {
      fontSize: '16px',
      fontWeight: '700',
      color: '#f1f5f9'
    },
    statLabel: {
      fontSize: '11px',
      color: '#64748b',
      textTransform: 'uppercase',
      fontWeight: '600'
    },
    engagementContainer: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 16px',
      background: 'rgba(34, 197, 94, 0.08)',
      border: '1px solid rgba(34, 197, 94, 0.2)',
      borderRadius: '12px',
    },
    engagementText: {
      fontSize: '13px',
      fontWeight: '700',
      color: '#86efac'
    },
    engagementVal: {
      fontSize: '18px',
      fontWeight: '800',
      color: '#22c55e'
    },
    chatCard: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      minHeight: '520px',
    },
    chatArea: {
      height: '400px',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      padding: '16px',
      background: 'rgba(15, 23, 42, 0.5)',
      borderRadius: '16px',
      border: '1px solid rgba(255, 255, 255, 0.03)'
    },
    userMsg: {
      alignSelf: 'flex-end',
      background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
      color: '#ffffff',
      borderRadius: '18px 18px 4px 18px',
      padding: '12px 18px',
      maxWidth: '75%',
      fontSize: '15px',
      lineHeight: '1.45',
      boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)'
    },
    aiMsg: {
      alignSelf: 'flex-start',
      background: '#e2e8f0', // Premium light-gray bubble background
      color: '#0f172a', // Premium dark contrast text for readability
      borderRadius: '18px 18px 18px 4px',
      padding: '14px 20px',
      maxWidth: '75%',
      fontSize: '15px',
      lineHeight: '1.5',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
      whiteSpace: 'pre-wrap'
    },
    chatInputRow: {
      display: 'flex',
      gap: '12px'
    },
    chatInput: {
      flex: 1,
      background: 'rgba(15, 23, 42, 0.6)',
      border: '1px solid #334155',
      borderRadius: '12px',
      padding: '14px 18px',
      color: '#f8fafc',
      fontSize: '15px',
      outline: 'none',
    },
    sendButton: {
      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      color: '#ffffff',
      border: 'none',
      borderRadius: '12px',
      padding: '0 24px',
      fontSize: '15px',
      fontWeight: '700',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
      transition: 'opacity 0.2s'
    },
    spinner: {
      display: 'inline-block',
      width: '18px',
      height: '18px',
      border: '3px solid rgba(255,255,255,0.3)',
      borderRadius: '50%',
      borderTopColor: '#ffffff',
      animation: 'spin 1s ease-in-out infinite'
    }
  };

  // Helper to format big numbers cleanly
  const formatNumber = (num) => {
    if (!num) return "0";
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  return (
    <div style={styles.appContainer}>
      {/* 1. Header Bar */}
      <header style={styles.header}>
        <h1 style={styles.title}>CreatorJoy RAG Analyzer</h1>
        <span style={styles.badge}>SESSION_ID: {sessionId.slice(0, 8)}...</span>
      </header>

      {/* 2. URL Input Section */}
      {!videoData && (
        <section style={styles.glassCard}>
          <form onSubmit={handleIngest}>
            <div style={styles.inputGrid}>
              <div style={styles.inputWrapper}>
                <label style={styles.label}>Video A URL (YouTube or Instagram)</label>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={videoAUrl}
                  onChange={(e) => setVideoAUrl(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div style={styles.inputWrapper}>
                <label style={styles.label}>Video B URL (YouTube or Instagram)</label>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="https://instagram.com/reel/..."
                  value={videoBUrl}
                  onChange={(e) => setVideoBUrl(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <button style={styles.button} type="submit" disabled={loading}>
              {loading ? (
                <>
                  <div className="spinner"></div>
                  Analyzing and Indexing Video Data...
                </>
              ) : "Analyze Videos"}
            </button>
          </form>
        </section>
      )}

      {/* Ingest Success Content */}
      {videoData && (
        <>
          {/* Analyze New Videos Reset Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
            <button
              onClick={handleReset}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                borderRadius: '12px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.1)'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = 'rgba(239, 68, 68, 0.2)';
                e.target.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                e.target.style.transform = 'translateY(0)';
              }}
            >
              ← Analyze New Videos
            </button>
          </div>

          {/* 3. Video Cards Section */}
          <section style={styles.cardGrid}>
            {/* Card Video A */}
            <div style={styles.videoCard}>
              <div style={styles.videoHeader}>
                <span style={styles.channelBadge}>VIDEO A</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#f1f5f9' }}>
                    {videoData.videoA.channel || "Creator"}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {formatNumber(videoData.videoA.subscriber_count)} Followers
                  </div>
                </div>
              </div>
              <h3 style={styles.videoTitle}>{videoData.videoA.title || "No Title"}</h3>
              <div style={styles.statsGrid}>
                <div style={styles.statBox}>
                  <span style={styles.statVal}>{formatNumber(videoData.videoA.view_count)}</span>
                  <span style={styles.statLabel}>Views</span>
                </div>
                <div style={styles.statBox}>
                  <span style={styles.statVal}>{formatNumber(videoData.videoA.like_count)}</span>
                  <span style={styles.statLabel}>Likes</span>
                </div>
                <div style={styles.statBox}>
                  <span style={styles.statVal}>{formatNumber(videoData.videoA.comment_count)}</span>
                  <span style={styles.statLabel}>Comments</span>
                </div>
              </div>
              <div style={styles.engagementContainer}>
                <span style={styles.engagementText}>Engagement Rate</span>
                <span style={styles.engagementVal}>
                  {videoData.videoA.view_count === 0 ? "N/A (views unavailable)" : `${videoData.videoA.engagement_rate?.toFixed(2)}%`}
                </span>
              </div>
            </div>

            {/* Card Video B */}
            <div style={styles.videoCard}>
              <div style={styles.videoHeader}>
                <span style={styles.channelBadge} style={{ ...styles.channelBadge, background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#fbcfe8' }}>VIDEO B</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#f1f5f9' }}>
                    {videoData.videoB.channel || "Creator"}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {formatNumber(videoData.videoB.subscriber_count)} Followers
                  </div>
                </div>
              </div>
              <h3 style={styles.videoTitle}>{videoData.videoB.title || "No Title"}</h3>
              <div style={styles.statsGrid}>
                <div style={styles.statBox}>
                  <span style={styles.statVal}>{formatNumber(videoData.videoB.view_count)}</span>
                  <span style={styles.statLabel}>Views</span>
                </div>
                <div style={styles.statBox}>
                  <span style={styles.statVal}>{formatNumber(videoData.videoB.like_count)}</span>
                  <span style={styles.statLabel}>Likes</span>
                </div>
                <div style={styles.statBox}>
                  <span style={styles.statVal}>{formatNumber(videoData.videoB.comment_count)}</span>
                  <span style={styles.statLabel}>Comments</span>
                </div>
              </div>
              <div style={styles.engagementContainer}>
                <span style={styles.engagementText}>Engagement Rate</span>
                <span style={styles.engagementVal}>
                  {videoData.videoB.view_count === 0 ? "N/A (views unavailable)" : `${videoData.videoB.engagement_rate?.toFixed(2)}%`}
                </span>
              </div>
            </div>
          </section>

          {/* 4. Chat Section */}
          <section style={{ ...styles.glassCard, ...styles.chatCard }}>
            <h3 style={{ ...styles.videoTitle, borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '12px' }}>RAG Interactive Comparison Chat</h3>
            <div style={styles.chatArea}>
              {messages.length === 0 ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: '#64748b', fontSize: '15px' }}>
                  Ask questions about the transcripts, compare metrics, or grill the videos!
                  <br />
                  <span style={{ fontSize: '12px', color: '#475569' }}>Citations will be provided automatically.</span>
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div
                    key={index}
                    style={msg.role === 'user' ? styles.userMsg : styles.aiMsg}
                  >
                    {msg.content === "" && streaming && index === messages.length - 1 ? (
                      <span style={{ fontStyle: 'italic', color: '#475569' }}>Thinking...</span>
                    ) : msg.content}
                  </div>
                ))
              )}
              {streaming && messages[messages.length - 1]?.content !== "" && (
                <div style={{ alignSelf: 'flex-start', background: 'transparent', padding: '0 8px' }}>
                  <span style={{ fontSize: '12px', color: '#6366f1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="bullet-glow"></span> Streaming Answer...
                  </span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendMessage} style={styles.chatInputRow}>
              <input
                style={styles.chatInput}
                type="text"
                placeholder={streaming ? "Streaming response..." : "Ask a RAG question comparing Video A and Video B..."}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                disabled={streaming}
              />
              <button
                style={styles.sendButton}
                type="submit"
                disabled={streaming || !inputMessage.trim()}
              >
                Send Question
              </button>
            </form>
          </section>
        </>
      )}

      {/* Global CSS Injector for Keyframe Animations */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .spinner {
          display: inline-block;
          width: 18px;
          height: 18px;
          border: 3px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: #ffffff;
          animation: spin 0.8s linear infinite;
        }
        .bullet-glow {
          width: 8px;
          height: 8px;
          background-color: #6366f1;
          border-radius: 50%;
          box-shadow: 0 0 8px #6366f1, 0 0 16px #6366f1;
          display: inline-block;
          animation: pulse 1.5s infinite alternate;
        }
        @keyframes pulse {
          from { opacity: 0.4; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
