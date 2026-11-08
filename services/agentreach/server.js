const http = require("node:http");

const PORT = Number(process.env.PORT) || 8085;

/** Search Remotive API for remote tech and web roles */
async function searchRemotive(query) {
  try {
    const url = new URL("https://remotive.com/api/remote-jobs");
    if (query) url.searchParams.set("search", query);
    url.searchParams.set("limit", "20");
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "AgentReach/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return jobs.map((j) => ({
      id: `remotive-${j.id}`,
      externalId: String(j.id),
      title: j.title || "Untitled Role",
      company: j.company_name || "Company",
      place: j.candidate_required_location || "Remote",
      remote: true,
      url: j.url,
      link: j.url,
      platform: "web",
      source: "remotive",
      salary: j.salary || null,
      description: j.description ? j.description.replace(/<[^>]+>/g, " ") : null,
      posted_at: j.publication_time || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

/** Search Arbeitnow API for global tech/remote jobs */
async function searchArbeitnow(query) {
  try {
    const url = new URL("https://www.arbeitnow.com/api/job-board-api");
    if (query) url.searchParams.set("search", query);
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "AgentReach/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = Array.isArray(data.data) ? data.data : [];
    return jobs.slice(0, 20).map((j) => ({
      id: `arbeitnow-${j.slug || Math.random().toString(36).slice(2)}`,
      externalId: j.slug || String(Date.now()),
      title: j.title || "Untitled Role",
      company: j.company_name || "Company",
      place: j.location || "Remote",
      remote: Boolean(j.remote),
      url: j.url,
      link: j.url,
      platform: "web",
      source: "arbeitnow",
      description: j.description ? j.description.replace(/<[^>]+>/g, " ") : null,
      posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

/** Search Reddit forhire/jobbit via Jina Reader proxy without auth */
async function searchReddit(query) {
  try {
    const target = `https://www.reddit.com/r/forhire+jobbit+remotework/search.json?q=${encodeURIComponent(query || "developer")}&sort=new&limit=15`;
    const res = await fetch(`https://r.jina.ai/${target}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    // Check if JSON returned in body
    const jsonStart = text.indexOf("{");
    if (jsonStart === -1) return [];
    const parsed = JSON.parse(text.slice(jsonStart));
    const children = parsed.data?.children || [];
    return children.map((c) => {
      const d = c.data || {};
      return {
        id: `reddit-${d.id || Math.random().toString(36).slice(2)}`,
        externalId: d.id || "",
        title: d.title || "Reddit Posting",
        company: d.subreddit_name_prefixed || "r/reddit",
        place: "Remote",
        remote: true,
        url: d.permalink ? `https://reddit.com${d.permalink}` : d.url,
        link: d.permalink ? `https://reddit.com${d.permalink}` : d.url,
        platform: "reddit",
        source: "reddit",
        description: d.selftext || null,
        posted_at: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : new Date().toISOString(),
      };
    });
  } catch {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (reqUrl.pathname === "/health" || reqUrl.pathname === "/healthz" || reqUrl.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, status: "healthy", service: "agent-reach", version: "1.0.0" }));
    return;
  }

  // Job search endpoints
  if (reqUrl.pathname === "/api/jobs/search" || reqUrl.pathname === "/api/jobs" || reqUrl.pathname === "/jobs") {
    const q = reqUrl.searchParams.get("q") || "";
    const platforms = (reqUrl.searchParams.get("platforms") || "linkedin,reddit,web").split(",");

    const tasks = [searchRemotive(q), searchArbeitnow(q)];
    if (platforms.includes("reddit")) {
      tasks.push(searchReddit(q));
    }

    const settled = await Promise.allSettled(tasks);
    const allItems = [];
    for (const r of settled) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        allItems.push(...r.value);
      }
    }

    // Deduplicate by URL
    const seen = new Set();
    const items = [];
    for (const item of allItems) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        channel: "jobs",
        items,
        total: items.length,
      }),
    );
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not Found", path: reqUrl.pathname }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[AgentReach] Service listening on http://0.0.0.0:${PORT}`);
});
