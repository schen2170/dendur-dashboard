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

const SUBREDDITS = [
  { sub: "sixflags", sort: "top" },
  { sub: "rollercoasters", sort: "top" },
  { sub: "ThemeParkDiscussion", sort: "top" },
];

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

async function fetchRedditPosts({ sub, sort }) {
  try {
    const r = await fetch(`${REDDIT_API}/reddit/fetch?sub=${sub}&sort=${sort}`);
    const d = await r.json();
    return (d?.data?.children || [])
      .filter(c => c.kind === "t3" && c.data.subreddit === sub && !c.data.stickied)
      .map(c => ({
        id: c.data.id, title: c.data.title,
        body: c.data.selftext?.slice(0, 400) || "",
        subreddit: c.data.subreddit, score: c.data.score,
        created: new Date(c.data.created_utc * 1000).toLocaleDateString(),
        url: `https://reddit.com${c.data.permalink}`,
      }));
  } catch { return []; }
}

async function classifyParks(posts) {
  const prompt = `You are classifying Reddit posts by theme park for an investment research tool.

For each post, identify which specific park it is about.
Park options: ${PARKS.join(", ")}

Rules:
- Return the EXACT park name from the list, or null if no specific park is clearly identifiable
- Use full title and body to decide
- Common abbreviations: SFMM = Six Flags Magic Mountain, GA = Great Adventure, CP = Cedar Point, SFGAm = Six Flags Great America, SFOG = Six Flags Over Georgia, SFOT = Six Flags Over Texas
- If post covers multiple parks or is general, return null
- If a post mentions Cedar Point AND a Six Flags park, return null

Posts:
${posts.map((p, i) => `[${i}] TITLE: ${p.title}\nBODY: ${p.body}`).join("\n\n")}

Respond ONLY with a JSON array of ${posts.length} objects like: [{"park": "Cedar Point"}, {"park": null}]
No markdown, no extra text.`;

  try {
    const res = await fetch(`${REDDIT_API}/claude/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      }),
    });
    const d = await res.json();
    const text = d?.content?.[0]?.text || "[]";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("[Claude] Error:", e);
    return posts.map(() => ({ park: null }));
  }
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

function RedditPanel({ posts, busy, status }) {
  return (
    <div>
      {!posts.length && !busy && (
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>No data loaded</div>
          <div style={{ fontSize: 13 }}>Click Refresh Data to pull and classify recent Reddit posts</div>
        </div>
      )}
      {busy && (
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 13 }}>{status || "Working…"}</div>
          <div style={{ width: 200, height: 3, background: "#f3f4f6", borderRadius: 2, margin: "16px auto 0" }}>
            <div style={{ height: "100%", background: GREEN, borderRadius: 2, width: "60%" }} />
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {posts.map((p, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 10, padding: "1rem 1.25rem", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, marginRight: 12 }}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: "#111827", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>{p.title}</a>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>r/{p.subreddit} · {p.created} · {p.score} pts</div>
                {p.body && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{p.body.slice(0, 200)}{p.body.length > 200 ? "…" : ""}</div>}
              </div>
              {p.park && (
                <span style={{ fontSize: 11, background: "#fff7f3", color: ORANGE, padding: "2px 9px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{p.park}</span>
              )}
            </div>
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
  const [posts, setPosts]               = useState([]);
  const [waitData, setWaitData]         = useState({});
  const [waitLoading, setWaitLoading]   = useState(true);
  const [loading, setLoading]           = useState(false);
  const [status, setStatus]             = useState("");
  const [selectedPark, setSelectedPark] = useState("All Parks");
  const [activeTab, setActiveTab]       = useState("reddit");

  useEffect(() => {
    fetchWaitData().then(d => { setWaitData(d); setWaitLoading(false); });
  }, []);

  const fetchPosts = useCallback(async () => {
    setLoading(true); setPosts([]); setStatus("Fetching Reddit posts…");
    const allArrays = await Promise.all(SUBREDDITS.map(fetchRedditPosts));
    const seen = new Set();
    const all = allArrays.flat().filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    setStatus(`Classifying ${all.length} posts with Claude…`);
    const BATCH = 10, results = [];
    for (let i = 0; i < all.length; i += BATCH) {
      const res = await classifyParks(all.slice(i, i + BATCH));
      results.push(...res);
      setStatus(`Classifying… ${Math.min(i + BATCH, all.length)} / ${all.length}`);
    }
    const classified = all.map((p, i) => ({
      ...p,
      park: results[i]?.park || null,
    })).filter(p => p.park);
    setStatus(`Done — ${classified.length} park-specific posts found`);
    setPosts(classified);
    setLoading(false);
  }, []);

  const parkCounts = posts.reduce((a, p) => { a[p.park] = (a[p.park]||0)+1; return a; }, {});
  const visiblePosts = selectedPark === "All Parks" ? posts : posts.filter(p => p.park === selectedPark);

  const sfParks = [...PARKS.filter(p => p.startsWith("Six Flags"))]
    .sort((a, b) => (parkCounts[b]||0) - (parkCounts[a]||0));
  const cpParks = PARKS.filter(p => !p.startsWith("Six Flags"));

  return (
    <div style={{ background: "#f9fafb", minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, color: "#111827" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #f3f4f6", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN }} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>Dendur Capital Open Assessment</span>
          <span style={{ color: "#d1d5db" }}>|</span>
          <span style={{ color: "#9ca3af", fontSize: 12 }}>Six Flags & Cedar Point Monitor</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {posts.length > 0 && (
            <span style={{ fontSize: 11, color: GREEN, background: "#f0fdf4", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>
              {posts.length} posts classified
            </span>
          )}
          <button onClick={fetchPosts} disabled={loading}
            style={{ background: loading ? "#f3f4f6" : "#111827", color: loading ? "#9ca3af" : "#fff", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? status || "Working…" : "Refresh Data"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 57px)" }}>
        <div style={{ width: 210, background: "#fff", borderRight: "1px solid #f3f4f6", padding: "1rem 0.75rem", overflowY: "auto", flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 0.5rem", marginBottom: 6 }}>Parks</div>

          <div onClick={() => setSelectedPark("All Parks")}
            style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1, fontSize: 12,
              background: selectedPark==="All Parks" ? "#f0fdf4" : "transparent",
              color: selectedPark==="All Parks" ? GREEN : "#374151",
              fontWeight: selectedPark==="All Parks" ? 600 : 400 }}>
            <span>All Parks</span>
            <span style={{ fontSize: 10, color: "#d1d5db" }}>{posts.length}</span>
          </div>

          <div style={{ fontSize: 10, fontWeight: 700, color: ORANGE, textTransform: "uppercase", padding: "0.75rem 0.5rem 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 1, background: "#fee2e2" }} />
            <span>Six Flags</span>
            <div style={{ flex: 1, height: 1, background: "#fee2e2" }} />
          </div>
          {sfParks.map(p => {
            const count = parkCounts[p] || 0;
            return (
              <div key={p} onClick={() => setSelectedPark(p)}
                style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1, fontSize: 12,
                  background: selectedPark===p ? "#f0fdf4" : "transparent",
                  color: selectedPark===p ? GREEN : "#374151",
                  fontWeight: selectedPark===p ? 600 : 400 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 145 }}>{p}</span>
                <span style={{ fontSize: 10, color: count > 0 ? "#d1d5db" : "#e5e7eb", flexShrink: 0 }}>{count}</span>
              </div>
            );
          })}

          <div style={{ fontSize: 10, fontWeight: 700, color: INDIGO, textTransform: "uppercase", padding: "0.75rem 0.5rem 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 1, background: "#e0e7ff" }} />
            <span>Cedar Point</span>
            <div style={{ flex: 1, height: 1, background: "#e0e7ff" }} />
          </div>
          {cpParks.map(p => {
            const count = parkCounts[p] || 0;
            return (
              <div key={p} onClick={() => setSelectedPark(p)}
                style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1, fontSize: 12,
                  background: selectedPark===p ? "#f0fdf4" : "transparent",
                  color: selectedPark===p ? GREEN : "#374151",
                  fontWeight: selectedPark===p ? 600 : 400 }}>
                <span>{p}</span>
                <span style={{ fontSize: 10, color: count > 0 ? "#d1d5db" : "#e5e7eb", flexShrink: 0 }}>{count}</span>
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ background: "#fff", borderBottom: "1px solid #f3f4f6", padding: "0.75rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{selectedPark}</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[["reddit","Reddit Data"],["waits","Wait Time Trends"]].map(([t,label]) => (
                <button key={t} onClick={() => setActiveTab(t)}
                  style={{ background: "none", border: "none",
                    borderBottom: activeTab===t ? `2px solid ${GREEN}` : "2px solid transparent",
                    color: activeTab===t ? GREEN : "#6b7280", padding: "0.5rem 1rem", fontSize: 12,
                    fontWeight: activeTab===t ? 600 : 400, cursor: "pointer" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: "1.25rem 1.5rem", flex: 1 }}>
            {activeTab === "reddit" ? (
              <RedditPanel posts={visiblePosts} busy={loading} status={status} />
            ) : (
              <WaitsPanel parkFilter={selectedPark} waitData={waitData} waitLoading={waitLoading} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
