import { useState, useEffect, useCallback } from "react";

const PARKS = [
  "Six Flags Magic Mountain","Six Flags Great Adventure","Six Flags Over Georgia",
  "Six Flags Over Texas","Six Flags America","Six Flags Great America",
  "Six Flags Fiesta Texas","Six Flags New England","Six Flags St. Louis",
  "Six Flags Discovery Kingdom","Six Flags Mexico","Six Flags White Water",
  "Cedar Point",
];

const GREEN      = "#00C805";
const ORANGE     = "#f26524";
const INDIGO     = "#6366f1";
const GREY_PRIOR = "#d1d5db";
const API        = "https://dendur-waits-api-production.up.railway.app";
const REDDIT_API = "https://dendur-reddit-api-production.up.railway.app";

const KPI_LABELS = {
  wait_times:    { label: "Wait Times", color: "#d97706" },
  ride_closures: { label: "Closures",   color: "#dc2626" },
  crowd_levels:  { label: "Crowds",     color: "#7c3aed" },
  staff_issues:  { label: "Staff",      color: "#db2777" },
};

const SENTIMENT    = { positive: GREEN, neutral: "#6b7280", negative: "#dc2626" };
const SENTIMENT_BG = { positive: "#f0fdf4", neutral: "#f9fafb", negative: "#fef2f2" };

const SUBREDDITS = [
  { sub: "sixflags",            sort: "top", pages: 10 },
  { sub: "rollercoasters",      sort: "top", pages: 2  },
  { sub: "ThemeParkDiscussion", sort: "top", pages: 2  },
  { sub: "themeparks",          sort: "top", pages: 2  },
  { sub: "cedarpoint",          sort: "top", pages: 2  },
];

// ── Data helpers ──────────────────────────────────────────────

async function savePostsToDB(posts) {
  try {
    await fetch(`${REDDIT_API}/reddit/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posts }),
    });
  } catch (e) { console.error("Failed to save posts:", e); }
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
      created: r.created_utc
        ? new Date(r.created_utc * 1000).toLocaleDateString()
        : new Date(r.saved_at).toLocaleDateString(),
      saved_at: r.saved_at,
    }));
  } catch (e) { console.error("Failed to load stored posts:", e); return []; }
}

async function fetchRedditPosts({ sub, sort }) {
  try {
    const r = await fetch(`${REDDIT_API}/reddit/fetch?sub=${sub}&sort=${sort}&pages=2`);
    const d = await r.json();
    return (d?.data?.children || [])
      .filter(c => c.kind === "t3" && c.data.subreddit === sub && !c.data.stickied)
      .map(c => ({
        id: c.data.id, title: c.data.title,
        body: c.data.selftext?.slice(0, 400) || "",
        subreddit: c.data.subreddit, score: c.data.score,
        created: new Date(c.data.created_utc * 1000).toLocaleDateString(),
        created_utc: c.data.created_utc,
        url: `https://reddit.com${c.data.permalink}`,
      }));
  } catch { return []; }
}

async function classifyPosts(posts) {
  const prompt = `You are classifying Reddit posts by theme park for an investment research tool.

For each post extract:
1. "park": EXACT park name from: ${PARKS.join(", ")}. Return null if none identifiable, multiple parks mentioned, or ambiguous.
2. "sentiment": "positive", "neutral", or "negative" — detect sarcasm carefully
3. "kpis": array from: wait_times, ride_closures, crowd_levels, staff_issues (empty array if none)
4. "summary": 1-sentence analyst summary
5. "kpi_details": object with specific details e.g. {"wait_times": "90 min for Top Thrill"}

Common abbreviations: SFMM=Six Flags Magic Mountain, GA=Great Adventure, CP=Cedar Point, SFGAm=Six Flags Great America, SFOG=Six Flags Over Georgia, SFOT=Six Flags Over Texas
If a post mentions Cedar Point AND a Six Flags park, return null for park.

Posts:
${posts.map((p, i) => `[${i}] TITLE: ${p.title}\nBODY: ${p.body}`).join("\n\n")}

Respond ONLY with a JSON array of ${posts.length} objects. No markdown, no extra text.`;

  try {
    const res = await fetch(`${REDDIT_API}/claude/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d    = await res.json();
    const text = d?.content?.[0]?.text || "[]";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("[Claude] Error:", e);
    return posts.map(() => ({ park: null }));
  }
}

// ── Wait time chart ───────────────────────────────────────────

const RANGES = [
  { label: "1W", days: 7  },
  { label: "1M", days: 30 },
];

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayLocal() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function buildChartData(rows, days) {
  if (!rows.length) return { current: [], prior: [], latest: null, delta: null };

  const today   = todayLocal();
  const cutoff  = new Date(today); cutoff.setDate(cutoff.getDate() - days);
  const pyToday  = new Date(today);  pyToday.setFullYear(pyToday.getFullYear() - 1);
  const pyCutoff = new Date(cutoff); pyCutoff.setFullYear(pyCutoff.getFullYear() - 1);

  const current = rows
    .filter(r => { const d = parseLocalDate(r.date); return d >= cutoff && d <= today && r.avg_wait >= 3; })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({ date: r.date, v: r.avg_wait }));

  const prior = rows
    .filter(r => { const d = parseLocalDate(r.date); return d >= pyCutoff && d <= pyToday && r.avg_wait >= 3; })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({ date: r.date, v: r.avg_wait }));

  const latest      = current.length ? current[current.length - 1].v : null;
  const latestDate  = current.length ? current[current.length - 1].date : null;

  // only compare if prior year has a reading within 3 days of the same date
  let priorLatest = null;
  if (latestDate) {
    const targetT = parseLocalDate(latestDate);
    targetT.setFullYear(targetT.getFullYear() - 1);
    const target = targetT.getTime();
    const close = prior.find(p => Math.abs(parseLocalDate(p.date).getTime() - target) <= 3 * 86400000);
    if (close) priorLatest = close.v;
  }

  const delta = (latest && priorLatest)
    ? Math.round(((latest - priorLatest) / priorLatest) * 100)
    : null;

  return { current, prior, latest, delta };
}

function fmtXLabel(dateStr, days) {
  const [, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  if (days <= 30) return `${m}/${d}`;
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return MONTHS[m - 1];
}

function MiniChart({ current, prior, days }) {
  const W = 400, H = 120, PAD = { t: 8, r: 8, b: 24, l: 32 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;
  const [tooltip, setTooltip] = useState(null);

  // always render frame even with no data
  const hasData = current.length > 0;

  const allVals = hasData
    ? [...current.map(p => p.v), ...prior.map(p => p.v)]
    : [0, 30];
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const padding = Math.max(10, (rawMax - rawMin) * 0.25);
  const minV = Math.max(0, rawMin - padding * 0.5);
  const maxV = rawMax + padding;
  const range = maxV - minV || 1;

  // x window is always the requested time window, not just where data exists
  const today = todayLocal();
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - days);
  const startT = cutoff.getTime();
  const endT   = today.getTime();
  const span   = endT - startT || 1;

  function xOf(dateStr, shiftYear) {
    const d = parseLocalDate(dateStr);
    if (shiftYear) d.setFullYear(d.getFullYear() + 1);
    return PAD.l + ((d.getTime() - startT) / span) * cW;
  }
  function yOf(v) {
    return PAD.t + cH - ((v - minV) / range) * cH;
  }

  const gapThreshold = days <= 30 ? 14 * 86400000 : 60 * 86400000;

  function buildPath(pts, shiftYear) {
    if (!pts.length) return [];
    const filtered = shiftYear
      ? pts.filter(p => {
          const d = parseLocalDate(p.date);
          d.setFullYear(d.getFullYear() + 1);
          const t = d.getTime();
          return t >= startT && t <= endT;
        })
      : pts.filter(p => {
          const t = parseLocalDate(p.date).getTime();
          return t >= startT && t <= endT;
        });
    if (!filtered.length) return [];

    const segments = [];
    let seg = [filtered[0]];
    for (let i = 1; i < filtered.length; i++) {
      const gap = parseLocalDate(filtered[i].date).getTime() - parseLocalDate(filtered[i-1].date).getTime();
      if (gap > gapThreshold) { segments.push(seg); seg = [filtered[i]]; }
      else seg.push(filtered[i]);
    }
    segments.push(seg);
    return segments.map(s =>
      s.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.date, shiftYear).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ")
    );
  }

  const currentPaths = buildPath(current, false);
  const priorPaths   = buildPath(prior, true);

  // x-axis labels: evenly spaced across the full window
  const labelCount = 6;
  const labelSet = [];
  for (let i = 0; i <= labelCount; i++) {
    const t = startT + (span * i / labelCount);
    const d = new Date(t);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const x = PAD.l + (i / labelCount) * cW;
    labelSet.push({ x, label: fmtXLabel(dateStr, days) });
  }

  const yTicks = [minV, Math.round((minV + maxV) / 2), maxV];

  function onMouseMove(e) {
    if (!hasData) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = null, minDist = Infinity;
    current.forEach(p => {
      const px = xOf(p.date, false);
      const dist = Math.abs(px - mx);
      if (dist < minDist) { minDist = dist; nearest = p; }
    });
    if (nearest && minDist < 20) {
      const px = xOf(nearest.date, false);
      const pd = parseLocalDate(nearest.date);
      pd.setFullYear(pd.getFullYear() - 1);
      const pyStr = `${pd.getFullYear()}-${String(pd.getMonth()+1).padStart(2,'0')}-${String(pd.getDate()).padStart(2,'0')}`;
      const priorPt = prior.find(p => p.date === pyStr) || null;
      setTooltip({ x: px, date: nearest.date, current: nearest.v, prior: priorPt?.v || null });
    } else {
      setTooltip(null);
    }
  }

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtDate(dateStr) {
    const [y, m, d] = dateStr.slice(0,10).split("-").map(Number);
    return `${MONTHS[m-1]} ${d}, ${y}`;
  }

  return (
    <div style={{ position: "relative" }}>
      {tooltip && (
        <div style={{
          position: "absolute",
          left: `${(tooltip.x / W) * 100}%`,
          top: 0,
          transform: "translateX(-50%)",
          background: "#fff",
          border: "1px solid #f3f4f6",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          pointerEvents: "none",
          zIndex: 10,
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}>
          <div style={{ fontWeight: 600, color: "#111827", marginBottom: 3 }}>{fmtDate(tooltip.date)}</div>
          <div style={{ color: GREEN }}>This year: {tooltip.current} min</div>
          {tooltip.prior && <div style={{ color: "#9ca3af" }}>Prior year: {tooltip.prior} min</div>}
        </div>
      )}
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: "visible", cursor: hasData ? "crosshair" : "default" }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* y gridlines */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={yOf(v)} x2={W - PAD.r} y2={yOf(v)} stroke="#f3f4f6" strokeWidth="1" />
            <text x={PAD.l - 4} y={yOf(v) + 4} textAnchor="end" fontSize="9" fill="#9ca3af">{Math.round(v)}</text>
          </g>
        ))}
        {/* prior year dotted grey — only show if current year has data */}
        {hasData && priorPaths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={GREY_PRIOR} strokeWidth="1.5" strokeDasharray="4,3" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {/* current year green */}
        {currentPaths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {/* hover crosshair */}
        {tooltip && (
          <>
            <line x1={tooltip.x} y1={PAD.t} x2={tooltip.x} y2={H - PAD.b} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3,2" />
            <circle cx={tooltip.x} cy={yOf(tooltip.current)} r="4" fill={GREEN} stroke="#fff" strokeWidth="2" />
          </>
        )}
        {/* x labels */}
        {labelSet.map((l, i) => (
          <text key={i} x={l.x} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">{l.label}</text>
        ))}
        {!hasData && (
          <text x={W/2} y={H/2} textAnchor="middle" fontSize="11" fill="#d1d5db">No data for this period</text>
        )}
      </svg>
    </div>
  );
}

function WaitChart({ park, allDailyRows, liveValue }) {
  const [range, setRange] = useState(30);

  const rows = allDailyRows.filter(r => r.park === park);
  const { current, prior, latest: historicalLatest, delta } = buildChartData(rows, range);

  // prefer live value for the displayed number
  const displayValue = liveValue?.avg_wait ?? historicalLatest;
  const scrapedAt = liveValue?.scraped_at
    ? (() => {
        const diff = Math.floor((Date.now() - new Date(liveValue.scraped_at).getTime()) / 60000);
        if (diff < 1) return "just now";
        if (diff < 60) return `${diff}m ago`;
        return `${Math.floor(diff / 60)}h ago`;
      })()
    : null;

  const deltaColor = delta === null ? "#9ca3af" : delta > 0 ? "#dc2626" : GREEN;
  const deltaText  = displayValue === null ? "" : delta === null ? "N/A vs prior year" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs prior year`;

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f3f4f6", padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>{park}</div>
            {scrapedAt && (
              <span style={{ fontSize: 10, color: GREEN, background: "#f0fdf4", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>
                ● Live {scrapedAt}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "#111827", lineHeight: 1 }}>
              {displayValue !== null ? displayValue : "—"}
            </span>
            <span style={{ fontSize: 13, color: "#111827" }}>min avg wait</span>
            {deltaText && <span style={{ fontSize: 12, fontWeight: 600, color: deltaColor }}>{deltaText}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map(r => (
            <button key={r.days} onClick={() => setRange(r.days)} style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
              border: range === r.days ? `1px solid ${GREEN}` : "1px solid #f3f4f6",
              background: range === r.days ? "#f0fdf4" : "#fff",
              color: range === r.days ? GREEN : "#6b7280",
              fontWeight: range === r.days ? 600 : 400,
            }}>{r.label}</button>
          ))}
        </div>
      </div>

      <MiniChart current={current} prior={prior} days={range} />

      <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 10, color: "#9ca3af" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <svg width="18" height="2"><line x1="0" y1="1" x2="18" y2="1" stroke={GREEN} strokeWidth="2"/></svg>
          This year
        </span>
        {prior.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="18" height="2"><line x1="0" y1="1" x2="18" y2="1" stroke={GREY_PRIOR} strokeWidth="1.5" strokeDasharray="4,3"/></svg>
            Prior year
          </span>
        )}
      </div>
    </div>
  );
}

// ── Reddit panel ──────────────────────────────────────────────

function RedditPanel({ posts, busy, status, selectedKPI, setSelectedKPI, selectedSentiment, setSelectedSentiment, sortBy, setSortBy, onRefresh }) {
  const kpiCounts = Object.keys(KPI_LABELS).reduce((a, k) => {
    a[k] = posts.filter(p => (p.kpis || []).includes(k)).length;
    return a;
  }, {});
  const sentCounts = ["positive","neutral","negative"].map(s => ({ s, n: posts.filter(p => p.sentiment === s).length }));

  const filtered = posts
    .filter(p => selectedKPI === "All" || (p.kpis || []).includes(selectedKPI))
    .filter(p => selectedSentiment === "All" || p.sentiment === selectedSentiment)
    .sort((a, b) => sortBy === "points"
      ? (b.score || 0) - (a.score || 0)
      : new Date(b.saved_at || b.created_utc * 1000) - new Date(a.saved_at || a.created_utc * 1000)
    );

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {Object.entries(KPI_LABELS).map(([k, v]) => (
          <div key={k} onClick={() => setSelectedKPI(selectedKPI === k ? "All" : k)}
            style={{ background: selectedKPI === k ? "#f0fdf4" : "#fff", border: `1px solid ${selectedKPI === k ? GREEN : "#f3f4f6"}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer", flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: kpiCounts[k] ? v.color : "#e5e7eb", marginTop: 2 }}>{kpiCounts[k] || 0}</div>
          </div>
        ))}
        <div style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 8, padding: "8px 12px", flex: 1, overflow: "hidden" }}>
          <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, marginBottom: 6 }}>Sentiment</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {sentCounts.map(({ s, n }) => (
              <div key={s} onClick={() => setSelectedSentiment(selectedSentiment === s ? "All" : s)}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "2px 4px", borderRadius: 4, background: selectedSentiment === s ? SENTIMENT_BG[s] : "transparent" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: n ? SENTIMENT[s] : "#e5e7eb", flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "#9ca3af", textTransform: "capitalize", width: 42 }}>{s}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: n ? SENTIMENT[s] : "#e5e7eb" }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: "1rem", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>Sort:</span>
        {[["recent","Most Recent"],["points","Top Points"]].map(([val, label]) => (
          <button key={val} onClick={() => setSortBy(val)}
            style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, border: `1px solid ${sortBy === val ? GREEN : "#f3f4f6"}`, background: sortBy === val ? "#f0fdf4" : "#fff", color: sortBy === val ? GREEN : "#6b7280", fontWeight: sortBy === val ? 600 : 400, cursor: "pointer" }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{filtered.length} posts</span>
        <button onClick={onRefresh} disabled={busy}
          style={{ fontSize: 11, padding: "5px 12px", borderRadius: 8, border: "none", marginLeft: "auto", background: busy ? "#f3f4f6" : "#111827", color: busy ? "#9ca3af" : "#fff", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}>
          {busy ? status || "Working…" : "Refresh Reddit"}
        </button>
      </div>

      {!posts.length && !busy && (
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>No data loaded</div>
          <div style={{ fontSize: 13 }}>Click Refresh Reddit to pull and classify recent posts</div>
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
        {filtered.map((p, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 10, padding: "1rem 1.25rem", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, marginRight: 12 }}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: "#111827", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>{p.title}</a>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>r/{p.subreddit} · {p.created} · {p.score} pts</div>
                {p.summary && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{p.summary}</div>}
                {!p.summary && p.body && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{p.body.slice(0, 200)}{p.body.length > 200 ? "…" : ""}</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                <span style={{ fontSize: 11, background: "#fff7f3", color: ORANGE, padding: "2px 9px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap" }}>{p.park}</span>
                {p.sentiment && (
                  <span style={{ fontSize: 11, background: SENTIMENT_BG[p.sentiment] || "#f9fafb", color: SENTIMENT[p.sentiment] || "#6b7280", padding: "2px 9px", borderRadius: 20, fontWeight: 600, textTransform: "capitalize" }}>{p.sentiment}</span>
                )}
              </div>
            </div>
            {(p.kpis || []).length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {(p.kpis || []).map(k => (
                  <span key={k} style={{ fontSize: 10, padding: "3px 9px", borderRadius: 20, background: "#f9fafb", border: "1px solid #f3f4f6", color: KPI_LABELS[k]?.color || "#6b7280", fontWeight: 600 }}>{KPI_LABELS[k]?.label || k}</span>
                ))}
                {p.kpi_details && Object.values(p.kpi_details).filter(Boolean).map((v, i) => (
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

// ── Waits panel ───────────────────────────────────────────────

function WaitsPanel({ parkFilter, allDailyRows, dailyLoading, liveData, liveLoading, onRefresh, parkCounts }) {
  const parksWithData = new Set(allDailyRows.map(r => r.park));

  const sfOrdered = PARKS
    .filter(p => p.startsWith("Six Flags") && parksWithData.has(p))
    .sort((a, b) => (parkCounts[b] || 0) - (parkCounts[a] || 0));
  const cpOrdered = PARKS.filter(p => !p.startsWith("Six Flags") && parksWithData.has(p));
  const allOrdered = [...sfOrdered, ...cpOrdered];

  const parks = parkFilter === "All Parks"
    ? allOrdered
    : [parkFilter].filter(p => parksWithData.has(p));

  if (dailyLoading) return (
    <div style={{ textAlign: "center", padding: "4rem", color: "#9ca3af" }}>
      <div style={{ fontSize: 13 }}>Loading wait time data…</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>Wait Time Trends</div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Live now · Green = this year · Grey dotted = prior year</div>
        </div>
        <button onClick={onRefresh} disabled={liveLoading}
          style={{ fontSize: 11, padding: "5px 12px", borderRadius: 8, border: "none", background: liveLoading ? "#f3f4f6" : "#111827", color: liveLoading ? "#9ca3af" : "#fff", fontWeight: 600, cursor: liveLoading ? "not-allowed" : "pointer" }}>
          {liveLoading ? "Scraping…" : "Refresh Live"}
        </button>
      </div>

      {!parks.length ? (
        <div style={{ textAlign: "center", padding: "4rem", color: "#9ca3af", fontSize: 13 }}>
          No wait time data yet.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: "0.75rem" }}>
          {parks.map(p => (
            <WaitChart key={p} park={p} allDailyRows={allDailyRows} liveValue={liveData[p] || null} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────

export default function App() {
  const [posts, setPosts]                         = useState([]);
  const [allDailyRows, setAllDailyRows]           = useState([]);
  const [liveData, setLiveData]                   = useState({});
  const [dailyLoading, setDailyLoading]           = useState(true);
  const [liveLoading, setLiveLoading]             = useState(false);
  const [loading, setLoading]                     = useState(false);
  const [status, setStatus]                       = useState("");
  const [selectedPark, setSelectedPark]           = useState("All Parks");
  const [selectedKPI, setSelectedKPI]             = useState("All");
  const [selectedSentiment, setSelectedSentiment] = useState("All");
  const [sortBy, setSortBy]                       = useState("recent");
  const [activeTab, setActiveTab]                 = useState("reddit");

  const fetchLiveData = useCallback(async () => {
    try {
      const rows = await fetch(`${API}/waits/latest`).then(r => r.json());
      const map = {};
      rows.forEach(r => { map[r.park] = { avg_wait: r.avg_wait, scraped_at: r.scraped_at }; });
      setLiveData(map);
    } catch (e) { console.error("live fetch failed", e); }
  }, []);

  useEffect(() => {
    loadStoredPosts().then(p => { if (p.length) setPosts(p); });
    fetch(`${API}/waits/daily`)
      .then(r => r.json())
      .then(rows => { setAllDailyRows(rows); setDailyLoading(false); })
      .catch(() => setDailyLoading(false));
    fetchLiveData();
  }, [fetchLiveData]);

  const fetchPosts = useCallback(async () => {
    setLoading(true); setPosts([]); setStatus("Fetching Reddit posts…");
    const allArrays = await Promise.all(SUBREDDITS.map(fetchRedditPosts));
    const seen = new Set();
    const all  = allArrays.flat().filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
    setStatus(`Classifying ${all.length} posts with Claude…`);
    const BATCH = 25;
    const batches = [];
    for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
    const batchResults = await Promise.all(batches.map(b => classifyPosts(b)));
    const results    = batchResults.flat();
    const classified = all.map((p, i) => ({
      ...p,
      park:        results[i]?.park        || null,
      sentiment:   results[i]?.sentiment   || "neutral",
      kpis:        results[i]?.kpis        || [],
      kpi_details: results[i]?.kpi_details || {},
      summary:     results[i]?.summary     || "",
      saved_at:    new Date().toISOString(),
    })).filter(p => p.park);
    setStatus(`Saving ${classified.length} posts…`);
    await savePostsToDB(classified);
    const stored = await loadStoredPosts();
    setPosts(stored.length ? stored : classified);
    setStatus(`Done — ${classified.length} park-specific posts found`);
    setLoading(false);
  }, []);

  const refreshWaitTimes = useCallback(async () => {
    // cooldown — don't scrape if last scrape was less than 10 min ago
    const lastScraped = Object.values(liveData)[0]?.scraped_at;
    if (lastScraped) {
      const minsAgo = (Date.now() - new Date(lastScraped).getTime()) / 60000;
      if (minsAgo < 10) {
        alert(`Last scrape was ${Math.round(minsAgo)} min ago. Wait a bit before refreshing.`);
        return;
      }
    }
    setLiveLoading(true);
    setStatus("Scraping live wait times…");
    try {
      const beforeRows = await fetch(`${API}/waits/latest`).then(r => r.json());
      const beforeTime = beforeRows[0]?.scraped_at || null;
      fetch(`${API}/scrape/live`).catch(() => {});
      let attempts = 0;
      while (attempts < 15) {
        await new Promise(r => setTimeout(r, 8000));
        const afterRows = await fetch(`${API}/waits/latest`).then(r => r.json());
        const afterTime = afterRows[0]?.scraped_at || null;
        if (afterTime && afterTime !== beforeTime) {
          const map = {};
          afterRows.forEach(r => { map[r.park] = { avg_wait: r.avg_wait, scraped_at: r.scraped_at }; });
          setLiveData(map);
          break;
        }
        attempts++;
      }
      const rows = await fetch(`${API}/waits/daily`).then(r => r.json());
      setAllDailyRows(rows);
    } catch (e) { console.error(e); }
    setLiveLoading(false);
    setStatus("");
  }, [fetchLiveData, liveData]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchPosts(), refreshWaitTimes()]);
  }, [fetchPosts, refreshWaitTimes]);

  const parkCounts = posts.reduce((a, p) => { a[p.park] = (a[p.park] || 0) + 1; return a; }, {});
  const visiblePosts = selectedPark === "All Parks" ? posts : posts.filter(p => p.park === selectedPark);
  const sfParks = PARKS.filter(p => p.startsWith("Six Flags")).sort((a, b) => (parkCounts[b] || 0) - (parkCounts[a] || 0));
  const cpParks = PARKS.filter(p => !p.startsWith("Six Flags"));

  return (
    <div style={{ background: "#f9fafb", minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, color: "#111827" }}>

      {/* nav */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f3f4f6", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN }} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>Dendur Capital Proof of Concept</span>
          <span style={{ color: "#d1d5db" }}>|</span>
          <span style={{ color: "#9ca3af", fontSize: 12 }}>Six Flags & Cedar Point Monitor</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {posts.length > 0 && (
            <span style={{ fontSize: 11, color: GREEN, background: "#f0fdf4", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>
              {posts.length} posts classified
            </span>
          )}
          <button onClick={refreshAll} disabled={loading || liveLoading}
            style={{ background: (loading || liveLoading) ? "#f3f4f6" : "#111827", color: (loading || liveLoading) ? "#9ca3af" : "#fff", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 12, fontWeight: 600, cursor: (loading || liveLoading) ? "not-allowed" : "pointer" }}>
            {(loading || liveLoading) ? status || "Working…" : "Refresh All"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 57px)" }}>

        {/* sidebar */}
        <div style={{ width: 210, background: "#fff", borderRight: "1px solid #f3f4f6", padding: "1rem 0.75rem", overflowY: "auto", flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 0.5rem", marginBottom: 6 }}>Parks</div>

          <div onClick={() => setSelectedPark("All Parks")}
            style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1, fontSize: 12, background: selectedPark === "All Parks" ? "#f0fdf4" : "transparent", color: selectedPark === "All Parks" ? GREEN : "#374151", fontWeight: selectedPark === "All Parks" ? 600 : 400 }}>
            <span>All Parks</span>
            <span style={{ fontSize: 10, color: "#d1d5db" }}>{posts.length}</span>
          </div>

          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", padding: "0.75rem 0.5rem 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            <span>Six Flags</span>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          </div>
          {sfParks.map(p => {
            const count = parkCounts[p] || 0;
            return (
              <div key={p} onClick={() => setSelectedPark(p)}
                style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1, fontSize: 12, background: selectedPark === p ? "#f0fdf4" : "transparent", color: selectedPark === p ? GREEN : "#374151", fontWeight: selectedPark === p ? 600 : 400 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 145 }}>{p}</span>
                <span style={{ fontSize: 10, color: count > 0 ? "#d1d5db" : "#e5e7eb", flexShrink: 0 }}>{count}</span>
              </div>
            );
          })}

          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", padding: "0.75rem 0.5rem 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            <span>Cedar Point</span>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          </div>
          {cpParks.map(p => {
            const count = parkCounts[p] || 0;
            return (
              <div key={p} onClick={() => setSelectedPark(p)}
                style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 1, fontSize: 12, background: selectedPark === p ? "#f0fdf4" : "transparent", color: selectedPark === p ? GREEN : "#374151", fontWeight: selectedPark === p ? 600 : 400 }}>
                <span>{p}</span>
                <span style={{ fontSize: 10, color: count > 0 ? "#d1d5db" : "#e5e7eb", flexShrink: 0 }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* main */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ background: "#fff", borderBottom: "1px solid #f3f4f6", padding: "0.75rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{selectedPark}</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[["reddit","Reddit Data"],["waits","Wait Time Trends"]].map(([t, label]) => (
                <button key={t} onClick={() => setActiveTab(t)}
                  style={{ background: "none", border: "none", borderBottom: activeTab === t ? `2px solid ${GREEN}` : "2px solid transparent", color: activeTab === t ? GREEN : "#6b7280", padding: "0.5rem 1rem", fontSize: 12, fontWeight: activeTab === t ? 600 : 400, cursor: "pointer" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: "1.25rem 1.5rem", flex: 1 }}>
            {activeTab === "reddit" ? (
              <RedditPanel
                posts={visiblePosts} busy={loading} status={status}
                selectedKPI={selectedKPI} setSelectedKPI={setSelectedKPI}
                selectedSentiment={selectedSentiment} setSelectedSentiment={setSelectedSentiment}
                sortBy={sortBy} setSortBy={setSortBy}
                onRefresh={fetchPosts}
              />
            ) : (
              <WaitsPanel
                parkFilter={selectedPark}
                allDailyRows={allDailyRows}
                dailyLoading={dailyLoading || allDailyRows.length === 0}
                liveData={liveData}
                liveLoading={liveLoading}
                onRefresh={refreshWaitTimes}
                parkCounts={parkCounts}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
