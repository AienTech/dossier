const http = require("node:http");

const PORT = Number(process.env.PORT) || 8085;

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** LinkedIn public guest job search */
async function searchLinkedIn({ keywords, location, country, remote, posted, experience }) {
  try {
    const url = new URL("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search");
    
    // Keywords
    const kw = keywords || "Technical Architect";
    url.searchParams.set("keywords", kw);

    // Location
    const loc = location || (country && country.toUpperCase() === "AE" ? "United Arab Emirates" : "");
    if (loc) {
      url.searchParams.set("location", loc);
    }

    // Remote filter: 1 = On-site, 2 = Remote, 3 = Hybrid
    if (remote) {
      url.searchParams.set("f_WT", "2");
    }

    // Posted within
    if (posted === "day") {
      url.searchParams.set("f_TPR", "r86400");
    } else if (posted === "three") {
      url.searchParams.set("f_TPR", "r259200");
    } else if (posted === "week") {
      url.searchParams.set("f_TPR", "r604800");
    } else if (posted === "month") {
      url.searchParams.set("f_TPR", "r2592000");
    }

    // Seniority: 1=Internship, 2=Entry, 3=Associate, 4=Mid-Senior, 5=Director, 6=Executive
    if (experience === "senior") {
      url.searchParams.set("f_E", "4");
    } else if (experience === "lead") {
      url.searchParams.set("f_E", "5,6");
    } else if (experience === "junior") {
      url.searchParams.set("f_E", "2");
    } else if (experience === "intern") {
      url.searchParams.set("f_E", "1");
    }

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    const html = await res.text();
    const cardRegex = /<div class="base-card[\s\S]*?<\/li>/g;
    let match;
    const items = [];

    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[0];
      const titleMatch = card.match(/<h3 class="base-search-card__title">([\s\S]*?)<\/h3>/);
      const companyMatch = card.match(/<h4 class="base-search-card__subtitle">([\s\S]*?)<\/h4>/);
      const locationMatch = card.match(/<span class="job-search-card__location">([\s\S]*?)<\/span>/);
      const linkMatch = card.match(/<a class="base-card__full-link[^"]*" href="([^"]+)"/);
      const timeMatch = card.match(/<time[^>]*datetime="([^"]+)"/);
      const urnMatch = card.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/);

      if (titleMatch && linkMatch) {
        const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
        const company = companyMatch ? companyMatch[1].replace(/<[^>]+>/g, "").trim() : "Company";
        const place = locationMatch ? locationMatch[1].replace(/<[^>]+>/g, "").trim() : (loc || "Remote");
        const cleanUrl = linkMatch[1].split("?")[0];
        const urn = urnMatch ? urnMatch[1] : Math.random().toString(36).slice(2);

        items.push({
          id: `li-${urn}`,
          externalId: urn,
          title,
          company,
          place,
          remote: Boolean(remote),
          url: cleanUrl,
          link: cleanUrl,
          platform: "LinkedIn",
          source: "linkedin",
          description: `${title} role at ${company} in ${place}. Apply directly on LinkedIn.`,
          posted_at: timeMatch ? timeMatch[1] : new Date().toISOString(),
        });
      }
    }

    return items;
  } catch (err) {
    console.error("[LinkedIn search error]:", err.message);
    return [];
  }
}

/** Remotive remote tech API */
async function searchRemotive(query) {
  try {
    const url = new URL("https://remotive.com/api/remote-jobs");
    if (query) url.searchParams.set("search", query);
    url.searchParams.set("limit", "25");
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

/** Arbeitnow global/remote jobs */
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
    return jobs.slice(0, 25).map((j) => ({
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

/** Reddit forhire / jobbit */
async function searchReddit(query) {
  try {
    const target = `https://www.reddit.com/r/forhire+jobbit+remotework/search.json?q=${encodeURIComponent(query || "developer")}&sort=new&limit=15`;
    const res = await fetch(`https://r.jina.ai/${target}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const text = await res.text();
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
        platform: "Reddit",
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

  // Handle all search variations: /api/search, /search, /api/jobs/search, /api/jobs, /jobs
  const isSearchPath = [
    "/api/search",
    "/search",
    "/api/jobs/search",
    "/api/jobs",
    "/jobs",
  ].includes(reqUrl.pathname);

  if (isSearchPath) {
    const rawQ = reqUrl.searchParams.get("q") || "";
    const location = reqUrl.searchParams.get("location") || "";
    const country = reqUrl.searchParams.get("country") || "";
    const remote = reqUrl.searchParams.get("remote") === "true";
    const posted = reqUrl.searchParams.get("posted") || "any";
    const experience = reqUrl.searchParams.get("experience") || "any";
    const platforms = (reqUrl.searchParams.get("platforms") || "linkedin,reddit,web").split(",");

    // Extract core keywords if location is in `q`
    let keywords = rawQ;
    if (location && keywords.toLowerCase().endsWith(location.toLowerCase())) {
      keywords = keywords.slice(0, -location.length).trim();
    }

    const tasks = [];

    // 1. LinkedIn (matches role + location + remote + seniority + posted)
    if (platforms.includes("linkedin")) {
      tasks.push(searchLinkedIn({ keywords, location, country, remote, posted, experience }));
    }

    // 2. Web sources (Remotive & Arbeitnow)
    if (platforms.includes("web")) {
      tasks.push(searchRemotive(keywords || rawQ));
      tasks.push(searchArbeitnow(keywords || rawQ));
    }

    // 3. Reddit
    if (platforms.includes("reddit")) {
      tasks.push(searchReddit(keywords || rawQ));
    }

    const settled = await Promise.allSettled(tasks);
    const allItems = [];
    for (const r of settled) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        allItems.push(...r.value);
      }
    }

    // If specific location/remote filters returned 0 on LinkedIn, do fallback search on keywords alone
    if (allItems.length === 0 && (location || remote)) {
      const fallbackLinkedIn = await searchLinkedIn({ keywords: keywords || rawQ, location: "", country: "", remote: false, posted: "any", experience: "any" });
      allItems.push(...fallbackLinkedIn);
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
