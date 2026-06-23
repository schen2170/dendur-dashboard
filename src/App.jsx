import { useState, useEffect, useCallback } from "react";

const PARKS = [
  "Six Flags Magic Mountain","Six Flags Great Adventure","Six Flags Over Georgia",
  "Six Flags Over Texas","Six Flags America","Six Flags Great America",
  "Six Flags Fiesta Texas","Six Flags New England","Six Flags St. Louis",
  "Six Flags Discovery Kingdom","Six Flags Mexico","Six Flags White Water",
  "Cedar Point",
];

const GREEN  = "#00C805";
const ORANGE = "#f26524";
const INDIGO = "#6366f1";
const API    = "https://dendur-waits-api-production.up.railway.app";
const REDDIT_API = "https://dendur-reddit-api-production.up.railway.app";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const KPI_LABELS = {
  wait_times:    { label: "Wait Times", color: "#d97706" },
  ride_closures: { label: "Closures",   color: "#dc2626" },
  crowd_levels:  { label: "Crowds",     color: "#7c3aed" },
  staff_issues:  { label: "Staff",      color: "#db2777" },
};

const SENTIMENT    = { positive: GREEN, neutral: "#6b7280", negative: "#dc2626" };
const SENTIMENT_BG = { positive: "#f0fdf4", neutral: "#f9fafb", negative: "#fef2f2" };
const SUBREDDITS   = ["sixflags","rollercoasters","ThemeParkDiscussion"];

async function savePostsToDB(posts) {
  try {
    await fetch(`${REDDIT_API}/reddit/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posts }),
    });
  } catch (e) {
    console.error("Failed to save posts:", e);
  }
}

async function loadStoredPosts() {
  try {
    const res  = await fetch(`${REDDIT_API}/reddit/posts?days=30`);
    const rows = await res.json();
    return rows.map(r => ({
      id: r.post_id, title: r.title, body: r.body,
      subreddit: r.subreddit, score: r.score, url: r.url,
      park: r.park, sentiment: r.sentiment, summary: r.summary,
      kpis: r.kpis || [], kpi_details: r.kpi_details || {},
      created: new Date(r.saved_at).toLocaleDateString(),
    }));
  } catch (e) {
    console.error("Failed to load stored posts:", e);
    return [];
  }
}

async function fetchWaitData() {
  try {
    const res  = await fetch(`${API}/waits/yoy`);
    const rows = await res.json();
    const byPark = {};
    const thisYear = new Date().getFullYear();
    for (const r of rows) {
      if (!byPark[r.park]) byPark[r.park] = {};
      const mo = parseInt(r.mo) - 1;
      if (!byPark[r.park][mo]) byPark[r.park][mo] = {};
      if (parseInt(r.yr) === thisYear) byPark[r.park][mo].current = parseInt(r.avg_wait);
      else byPark[r.park][mo].prior = parseInt(r.avg_wait);
    }
    const shaped = {};
    for (const [park, months] of Object.entries(byPark)) {
      const arr = MONTHS.map((month, i) => ({
        month,
        current: months[i]?.current ?? null,
        prior:   months[i]?.prior   ?? null,
      })).filter(d => d.current !== null || d.prior !== null);
      if (arr.length) shaped[park] = arr;
    }
    return shaped;
  } catch (e) {
    console.error("Failed to fetch wait data:", e);
    return {};
  }
}

async function fetchRedditPosts(sub) {
  try {
    const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(`https://www.reddit.com/r/${sub}/new.json?limit=25`)}`);
    const d = await r.json();
    return (d?.data?.children || []).map(c => ({
      id: c.data.id, title: c.data.title,
      body: c.data.selftext?.slice(0, 400) || "",
      subreddit: c.data.subreddit, score: c.data.score,
      created: new Date(c.data.created_utc * 1000).toLocaleDateString(),
      url: `https://reddit.com${c.data.permalink}`,
    }));
  } catch { return []; }
}

async function classifyPosts(posts) {
  const prompt = `You are an analyst classifying theme park Reddit posts for investor intelligence.
For each post extract:
1. "park": specific park name from: ${PARKS.join(", ")}. If none identifiable, return null.
2. "kpis": array from: wait_times, ride_closures, crowd_levels, staff_issues
3. "sentiment": "positive", "neutral", or "negative"
4. "summary": 1-sentence analyst summary
5. "kpi_details": object with extracted specifics

Posts:
${posts.map((p, i) => `[${i}] TITLE: ${p.title}\nBODY: ${p.body}`).join("\n\n")}

Respond ONLY with a JSON array of ${posts.length} objects. No markdown, no extra text.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
  });
  const d = await res.json();
  const text = d?.content?.[0]?.text || "[]";
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { return posts.map(() => null); }
}

function Sparkline({ data, color }) {
  if (!data?.length) return null;
  const vals = data.flatMap(d => [d.current, d.prior].filter(v => v !== null));
  if (!vals.length) return null;
  const min = Math.min(...vals) - 2, max = Math.max(...vals) + 2, range = max - min || 1;
  const W = 280, H = 60;
  const pts = (key, col, dash) => {
    const valid = data.filter(d => d[key] !== null);
    if (!valid.length) return null;
    const points = valid.map(d => {
      const idx = data.indexOf(d);
      return `${(idx/(data.length-1))*W},${H-((d[key]-min)/range)*H}`;
    }).join(" ");
    return <polyline points={points} fill="none" stroke={col} strokeWidth={dash ? "1.5" : "2"} strokeDasharray={dash ? "4,2" : undefined} />;
  };
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {pts("prior", "#e5e7eb", true)}
      {pts("current", color, false)}
      {data.filter(d => d.current !== null).map((d, i) => (
        <circle key={i} cx={(data.indexOf(d)/(data.length-1))*W} cy={H-((d.current-min)/range)*H} r="2" fill={color} />
      ))}
    </svg>
  );
}

function WaitCard({ park, data }) {
  const latest = data.filter(d => d.current !== null).slice(-1)[0];
  const latestPrior = data.filter(d => d.prior !== null).slice(-1)[0];
  if (!latest) return null;
  const yoy = latestPrior ? latest.current - latestPrior.prior : null;
  const isSF = park.startsWith("Six Flags");
  const avgCurrent = data.filter(d=>d.current!==null).reduce((s,d)=>s+d.current,0)/(data.filter(d=>d.current!==null).length||1);
  const avgPrior   = data.filter(d=>d.prior!==null).reduce((s,d)=>s+d.prior,0)/(data.filter(d=>d.prior!==null).length||1);
  const accent = avgCurrent >= avgPrior ? GREEN : ORANGE;
  return (
    <div style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>{park}</div>
          <div style={{ fontSize: 11, color: isSF ? ORANGE : INDIGO, marginTop: 2, fontWeight: 500 }}>{isSF ? "Six Flags" : "Cedar Point"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#111827", lineHeight: 1 }}>
            {latest.current}<span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}> min</span>
          </div>
          {yoy !== null && (
            <div style={{ fontSize: 11, marginTop: 3, fontWeight: 600, color: yoy > 0 ? "#dc2626" : GREEN }}>
              {yoy > 0 ? "▲" : "▼"} {Math.abs(yoy)} min YoY
            </div>
          )}
        </div>
      </div>
      <Sparkline data={data} color={accent} />
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 10, color: "#9ca3af" }}>
        <span style={{ color: accent }}>— Current</span>
        <span style={{ color: "#d1d5db" }}>- - Prior Year</span>
        <span style={{ marginLeft: "auto", color: GREEN, fontWeight: 600 }}>● Live</span>
      </div>
    </div>
  );
}

function RedditPanel({ posts, busy, loading, selectedKPI, setSelectedKPI }) {
  const filtered = posts.filter(p => selectedKPI === "All" || (p.kpis||[]).includes(selectedKPI));
  const kpiCounts = Object.keys(KPI_LABELS).reduce((a,k) => { a[k]=posts.filter(p=>(p.kpis||[]).includes(k)).length; return a; }, {});
  const sentCounts = ["positive","neutral","negative"].map(s => ({ s, n: posts.filter(p=>p.sentiment===s).length }));

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {Object.entries(KPI_LABELS).map(([k,v]) => (
          <div key={k} onClick={() => setSelectedKPI(selectedKPI===k ? "All" : k)}
            style={{ background: selectedKPI===k ? "#f0fdf4" : "#fff", border: `1px solid ${selectedKPI===k ? GREEN : "#f3f4f6"}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer", flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: kpiCounts[k] ? v.color : "#e5e7eb", marginTop: 2 }}>{kpiCounts[k]||0}</div>
          </div>
        ))}
        <div style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 8, padding: "8px 12px", flex: 1, overflow: "hidden" }}>
          <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, marginBottom: 6 }}>Sentiment</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {sentCounts.map(({s,n}) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: n ? SENTIMENT[s] : "#e5e7eb", flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "#9ca3af", textTransform: "capitalize", width: 42 }}>{s}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: n ? SENTIMENT[s] : "#e5e7eb" }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!posts.length && !busy && (
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>No data loaded</div>
          <div style={{ fontSize: 13 }}>Click Refresh Data to pull and classify recent Reddit posts</div>
        </div>
      )}
      {busy && (
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 13 }}>{loading ? "Pulling posts from Reddit…" : "Classifying posts with Claude…"}</div>
          <div style={{ width: 200, height: 3, background: "#f3f4f6", borderRadius: 2, margin: "16px auto 0" }}>
            <div style={{ height: "100%", background: GREEN, borderRadius: 2, width: "60%" }} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {filtered.map((p,i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 10, padding: "1rem 1.25rem", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, marginRight: 12 }}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: "#111827", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>{p.title}</a>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>r/{p.subreddit} · {p.created} · {p.score} pts</div>
                {p.summary && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{p.summary}</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                <span style={{ fontSize: 11, background: "#fff7f3", color: ORANGE, padding: "2px 9px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap" }}>{p.park}</span>
                <span style={{ fontSize: 11, background: SENTIMENT_BG[p.sentiment]||"#f9fafb", color: SENTIMENT[p.sentiment]||"#6b7280", padding: "2px 9px", borderRadius: 20, fontWeight: 600, textTransform: "capitalize" }}>{p.sentiment}</span>
              </div>
            </div>
            {(p.kpis||[]).length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {(p.kpis||[]).map(k => (
                  <span key={k} style={{ fontSize: 10, padding: "3px 9px", borderRadius: 20, background: "#f9fafb", border: "1px solid #f3f4f6", color: KPI_LABELS[k]?.color||"#6b7280", fontWeight: 600 }}>{KPI_LABELS[k]?.label||k}</span>
                ))}
                {p.kpi_details && Object.values(p.kpi_details).filter(Boolean).map((v,i) => (
                  <span key={i} style={{ fontSize: 11, color: "#9ca3af" }}>· {v}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WaitsPanel({ parkFilter, waitData, waitLoading }) {
  const parks = parkFilter === "All Parks" ? Object.keys(waitData) : [parkFilter].filter(p => waitData[p]);
  if (waitLoading) return (
    <div style={{ textAlign: "center", padding: "4rem", color: "#9ca3af" }}>
      <div style={{ fontSize: 13 }}>Loading live wait time data…</div>
      <div style={{ width: 200, height: 3, background: "#f3f4f6", borderRadius: 2, margin: "16px auto 0" }}>
        <div style={{ height: "100%", background: GREEN, borderRadius: 2, width: "60%" }} />
      </div>
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>Average Wait Times</div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>12-month rolling · Current vs. Prior Year · Live via Thrill-Data</div>
        </div>
        {!parks.length && (
          <span style={{ fontSize: 11, background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a", padding: "4px 10px", borderRadius: 20, fontWeight: 600 }}>
            No data yet — scrape in progress
          </span>
        )}
      </div>
      {parks.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "0.75rem" }}>
          {parks.map(p => waitData[p] && <WaitCard key={p} park={p} data={waitData[p]} />)}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "4rem", color: "#9ca3af" }}>
          Data will appear after the first scrape cycle completes.
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [classified, setClassified]     = useState([]);
  const [waitData, setWaitData]         = useState({});
  const [waitLoading, setWaitLoading]   = useState(true);
  const [rawCount, setRawCount]         = useState(0);
  const [loading, setLoading]           = useState(false);
  const [classifying, setClassifying]   = useState(false);
  const [selectedPark, setSelectedPark] = useState("All Parks");
  const [selectedKPI, setSelectedKPI]   = useState("All");
  const [activeTab, setActiveTab]       = useState("reddit");

  useEffect(() => {
    loadStoredPosts().then(posts => { if (posts.length) setClassified(posts); });
    fetchWaitData().then(d => { setWaitData(d); setWaitLoading(false); });
  }, []);

  const fetchAndClassify = useCallback(async () => {
    setLoading(true); setRawCount(0);
    const all = (await Promise.all(SUBREDDITS.map(fetchRedditPosts))).flat();
    setRawCount(all.length);
    setLoading(false); setClassifying(true);
    const BATCH = 10, results = [];
    for (let i = 0; i < all.length; i += BATCH) {
      const res = await classifyPosts(all.slice(i, i + BATCH));
      results.push(...res);
    }
    const newPosts = all.map((p,i) => ({ ...p, ...(results[i]||{}) })).filter(p => p.park);
    await savePostsToDB(newPosts);
    const stored = await loadStoredPosts();
    setClassified(stored);
    setClassifying(false);
    fetchWaitData().then(d => setWaitData(d));
  }, []);

  const parkCounts = classified.reduce((a,p) => { a[p.park]=(a[p.park]||0)+1; return a; }, {});
  const busy = loading || classifying;
  const visiblePosts = classified.filter(p => selectedPark === "All Parks" || p.park === selectedPark);

  return (
    <div style={{ background: "#f9fafb", minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, color: "#111827" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #f3f4f6", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN }} />
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.01em" }}>Dendur Capital Open Assessment</span>
          <span style={{ color: "#d1d5db" }}>|</span>
          <span style={{ color: "#9ca3af", fontSize: 12 }}>Six Flags & Cedar Point Monitor</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {classified.length > 0 && (
            <span style={{ fontSize: 11, color: GREEN, background: "#f0fdf4", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>
              {classified.length} posts stored
            </span>
          )}
          <button onClick={fetchAndClassify} disabled={busy}
            style={{ background: busy ? "#f3f4f6" : "#111827", color: busy ? "#9ca3af" : "#fff", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 12, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}>
            {loading ? "Fetching…" : classifying ? "Classifying…" : "Refresh Data"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 57px)" }}>
        <div style={{ width: 210, background: "#fff", borderRight: "1px solid #f3f4f6", padding: "1rem 0.75rem", overflowY: "auto", flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 0.5rem", marginBottom: 6 }}>Parks</div>
          <div onClick={() => { setSelectedPark("All Parks"); setActiveTab("reddit"); setSelectedKPI("All"); }}
            style={{ display: "flex", alignItems: "center", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1,
              background: selectedPark==="All Parks" ? "#f0fdf4" : "transparent", color: selectedPark==="All Parks" ? GREEN : "#374151", fontWeight: selectedPark==="All Parks" ? 600 : 400 }}>
            <span style={{ fontSize: 12 }}>All Parks</span>
          </div>

          <div style={{ fontSize: 10, fontWeight: 700, color: ORANGE, textTransform: "uppercase", letterSpacing: "0.08em", padding: "0.75rem 0.5rem 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 1, background: "#fee2e2" }} />
            <span>Six Flags</span>
            <div style={{ flex: 1, height: 1, background: "#fee2e2" }} />
          </div>
          {PARKS.filter(p => p.startsWith("Six Flags")).map(p => {
            const isActive = selectedPark === p;
            const count = parkCounts[p] || 0;
            return (
              <div key={p} onClick={() => { setSelectedPark(p); setActiveTab(classified.filter(x=>x.park===p).length ? "reddit" : "waits"); setSelectedKPI("All"); }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1,
                  background: isActive ? "#f0fdf4" : "transparent", color: isActive ? GREEN : "#374151", fontWeight: isActive ? 600 : 400 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 145, fontSize: 12 }}>{p}</span>
                {count > 0 && <span style={{ fontSize: 10, color: "#d1d5db", flexShrink: 0, marginLeft: 4 }}>{count}</span>}
              </div>
            );
          })}

          <div style={{ fontSize: 10, fontWeight: 700, color: INDIGO, textTransform: "uppercase", letterSpacing: "0.08em", padding: "0.75rem 0.5rem 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 1, background: "#e0e7ff" }} />
            <span>Cedar Point</span>
            <div style={{ flex: 1, height: 1, background: "#e0e7ff" }} />
          </div>
          {PARKS.filter(p => !p.startsWith("Six Flags")).map(p => {
            const isActive = selectedPark === p;
            const count = parkCounts[p] || 0;
            return (
              <div key={p} onClick={() => { setSelectedPark(p); setActiveTab(classified.filter(x=>x.park===p).length ? "reddit" : "waits"); setSelectedKPI("All"); }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1,
                  background: isActive ? "#f0fdf4" : "transparent", color: isActive ? GREEN : "#374151", fontWeight: isActive ? 600 : 400 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 145, fontSize: 12 }}>{p}</span>
                {count > 0 && <span style={{ fontSize: 10, color: "#d1d5db", flexShrink: 0, marginLeft: 4 }}>{count}</span>}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ background: "#fff", borderBottom: "1px solid #f3f4f6", padding: "0.75rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{selectedPark}</div>
              {selectedPark !== "All Parks" && (
                <div style={{ fontSize: 11, color: selectedPark.startsWith("Six Flags") ? ORANGE : INDIGO, fontWeight: 500, marginTop: 1 }}>
                  {selectedPark.startsWith("Six Flags") ? "Six Flags" : "Cedar Point"}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {[["reddit","Reddit Data"],["waits","Wait Time Trends"]].map(([t,label]) => (
                <button key={t} onClick={() => setActiveTab(t)}
                  style={{ background: activeTab===t ? "#f0fdf4" : "none", border: "none",
                    borderBottom: activeTab===t ? `2px solid ${GREEN}` : "2px solid transparent",
                    color: activeTab===t ? GREEN : "#6b7280", padding: "0.5rem 1rem", fontSize: 12,
                    fontWeight: activeTab===t ? 600 : 400, cursor: "pointer", borderRadius: "6px 6px 0 0" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: "1.25rem 1.5rem", flex: 1 }}>
            {activeTab === "reddit" ? (
              <RedditPanel posts={visiblePosts} busy={busy} loading={loading} selectedKPI={selectedKPI} setSelectedKPI={setSelectedKPI} />
            ) : (
              <WaitsPanel parkFilter={selectedPark} waitData={waitData} waitLoading={waitLoading} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
