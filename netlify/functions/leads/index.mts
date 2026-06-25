import type { Context, Config } from "@netlify/functions";

// ---- Types ----
interface Lead {
  name: string;
  address: string;
  phone: string;
  phoneRaw: string;
  website: string | null;
  rating: number;
  reviews: number;
  oldestReviewYearsAgo: number | null;
  lastReviewDaysAgo: number | null;
  websiteFlag: "none" | "weak" | "ok" | "unknown";
  score: number;
  scoreReasons: string[];
  mapsUrl: string;
  marketScore: number;
  marketLabel: string;
  marketReason: string;
}

const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";

// Fields we ask Google for. Keeping this tight controls cost.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.reviews",
  "places.businessStatus",
].join(",");

function daysBetween(thenMs: number, nowMs: number): number {
  return Math.round((nowMs - thenMs) / (1000 * 60 * 60 * 24));
}

// ---- DFW market data ----
// Population is a free, stable proxy for demand (real search volume needs a
// paid keyword tool). Frisco-to-Denton corridor + core North TX cities.
// Numbers are approximate and change slowly; good enough for relative ranking.
const CITY_POP: Record<string, number> = {
  "dallas": 1300000,
  "plano": 290000,
  "frisco": 230000,
  "mckinney": 215000,
  "denton": 150000,
  "carrollton": 135000,
  "lewisville": 130000,
  "allen": 110000,
  "the colony": 45000,
  "prosper": 40000,
  "little elm": 55000,
  "wylie": 60000,
  "celina": 30000,
  "anna": 25000,
  "melissa": 20000,
  "princeton": 28000,
  "aubrey": 12000,
  "sanger": 10000,
  "pilot point": 6000,
  "fairview": 11000,
  "lucas": 9000,
  "savannah": 12000,
  "providence village": 8000,
  "cross roads": 2000,
  "krugerville": 2000,
};

// Pull a recognizable city name out of the user's free-text query.
function detectCity(query: string): { city: string | null; pop: number | null } {
  const q = query.toLowerCase();
  // Check multi-word names first so "little elm" isn't read as "elm".
  const names = Object.keys(CITY_POP).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (q.includes(name)) return { city: name, pop: CITY_POP[name] };
  }
  return { city: null, pop: null };
}

// Score the demand side from population. 0-100.
function demandScore(pop: number | null): number {
  if (pop === null) return 50; // unknown city -> neutral
  if (pop >= 200000) return 100;
  if (pop >= 120000) return 85;
  if (pop >= 80000) return 70;
  if (pop >= 45000) return 55;
  if (pop >= 25000) return 40;
  if (pop >= 12000) return 28;
  return 18;
}

// Analyze the whole field of results to gauge how hard the market is.
// Returns 0-100 where HIGH = wide open (weak/few competitors = good for you).
function competitionOpenness(allPlaces: any[]): { openness: number; field: number; avgReviews: number; strong: number } {
  const valid = allPlaces.filter(p => (p.userRatingCount ?? 0) >= 5);
  const field = valid.length;
  if (field === 0) return { openness: 70, field: 0, avgReviews: 0, strong: 0 };

  const reviewCounts = valid.map(p => p.userRatingCount ?? 0);
  const avgReviews = Math.round(reviewCounts.reduce((a, b) => a + b, 0) / field);
  // "Strong" competitors = the wall a newcomer has to climb past.
  const strong = valid.filter(p => (p.userRatingCount ?? 0) >= 100).length;

  let openness = 100;
  // More competitors = harder.
  if (field >= 18) openness -= 30;
  else if (field >= 12) openness -= 18;
  else if (field >= 7) openness -= 8;
  // Entrenched leaders = much harder to outrank.
  openness -= Math.min(40, strong * 7);
  // High average review depth = mature, competitive market.
  if (avgReviews >= 150) openness -= 18;
  else if (avgReviews >= 70) openness -= 8;

  openness = Math.max(5, Math.min(100, openness));
  return { openness, field, avgReviews, strong };
}

// Score a lead 0-100 against the ideal profile.
function scoreLead(p: any, market: { score: number; label: string; reason: string }): Lead | null {
  const now = Date.now();
  const rating: number = p.rating ?? 0;
  const reviews: number = p.userRatingCount ?? 0;
  const status: string = p.businessStatus ?? "";
  const website: string | null = p.websiteUri ?? null;
  const address: string = p.formattedAddress ?? "";

  // HARD FILTERS — drop anything that fails these outright.
  if (status && status !== "OPERATIONAL") return null;
  if (rating < 4.5) return null;
  if (reviews < 10) return null;
  if (!address) return null; // must have a physical address

  // Derive review-age signals from the returned reviews (up to ~5).
  let oldestYears: number | null = null;
  let lastDays: number | null = null;
  if (Array.isArray(p.reviews) && p.reviews.length) {
    const times = p.reviews
      .map((r: any) => (r.publishTime ? new Date(r.publishTime).getTime() : null))
      .filter((t: number | null): t is number => t !== null);
    if (times.length) {
      const oldest = Math.min(...times);
      const newest = Math.max(...times);
      oldestYears = +(daysBetween(oldest, now) / 365).toFixed(1);
      lastDays = daysBetween(newest, now);
    }
  }

  // Website quality flag (cheap heuristic; deep crawl is a later upgrade).
  let websiteFlag: Lead["websiteFlag"] = "unknown";
  if (!website) {
    websiteFlag = "none";
  } else {
    const w = website.toLowerCase();
    // Social pages / builders / link-in-bio usually = weak web presence.
    const weakHosts = [
      "facebook.com", "instagram.com", "linktr.ee", "linktree",
      "business.site", "wixsite.com", "godaddysites.com", "weebly.com",
      "blogspot.", "wordpress.com", "yelp.com", "google.com",
    ];
    if (weakHosts.some((h) => w.includes(h))) websiteFlag = "weak";
    else websiteFlag = "ok";
  }

  // ---- Scoring ----
  let score = 0;
  const reasons: string[] = [];

  // Review count sweet spot 20-100 = best.
  if (reviews >= 20 && reviews <= 100) { score += 30; reasons.push("Reviews in 20-100 sweet spot"); }
  else if (reviews > 100) { score += 18; reasons.push("100+ reviews (bigger, may have help)"); }
  else { score += 14; reasons.push("10-19 reviews"); }

  // Rating quality.
  if (rating >= 4.8) { score += 18; reasons.push("Excellent rating"); }
  else if (rating >= 4.5) { score += 14; reasons.push("Strong rating"); }

  // Longevity (oldest review as proxy for age).
  if (oldestYears !== null) {
    if (oldestYears >= 5) { score += 22; reasons.push(`~${oldestYears}yr+ history`); }
    else if (oldestYears >= 3) { score += 14; reasons.push(`~${oldestYears}yr history`); }
    else { score += 6; reasons.push(`~${oldestYears}yr history (younger)`); }
  } else {
    score += 8; reasons.push("Age unknown");
  }

  // Recent activity (still getting reviews = active).
  if (lastDays !== null) {
    if (lastDays <= 90) { score += 15; reasons.push("Active review in last 90d"); }
    else if (lastDays <= 180) { score += 8; reasons.push("Review in last 6mo"); }
    else { score += 2; reasons.push("No recent reviews"); }
  } else {
    score += 5;
  }

  // Website weakness = OPPORTUNITY (this is the pitch).
  if (websiteFlag === "none") { score += 15; reasons.push("No website — prime target"); }
  else if (websiteFlag === "weak") { score += 12; reasons.push("Weak web presence — good target"); }
  else if (websiteFlag === "ok") { score += 3; reasons.push("Has a real website"); }

  score = Math.min(100, score);

  const phoneRaw = (p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? "").replace(/[^\d+]/g, "");

  return {
    name: p.displayName?.text ?? "Unknown",
    address,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? "",
    phoneRaw,
    website,
    rating,
    reviews,
    oldestReviewYearsAgo: oldestYears,
    lastReviewDaysAgo: lastDays,
    websiteFlag,
    score,
    scoreReasons: reasons,
    mapsUrl: p.googleMapsUri ?? "",
    marketScore: market.score,
    marketLabel: market.label,
    marketReason: market.reason,
  };
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  const apiKey = Netlify.env.get("GOOGLE_PLACES_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server is missing GOOGLE_PLACES_KEY. Add it in Netlify env vars." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const query: string = (body.query ?? "").toString().trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "Missing search query" }), { status: 400 });
  }

  try {
    const res = await fetch(PLACES_SEARCH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        pageSize: 20,
        languageCode: "en",
        regionCode: "US",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(
        JSON.stringify({ error: "Google Places error", detail: errText }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    const data = await res.json();
    const places: any[] = data.places ?? [];

    // ---- Market analysis (once per search) ----
    const { city, pop } = detectCity(query);
    const demand = demandScore(pop);
    const comp = competitionOpenness(places);
    // Opportunity = strong demand + open competition. Weighted toward openness
    // because a beatable market is where Google rankings actually move.
    const marketScore = Math.round(demand * 0.45 + comp.openness * 0.55);

    let marketLabel = "Tough market";
    if (marketScore >= 75) marketLabel = "Goldmine";
    else if (marketScore >= 60) marketLabel = "Strong";
    else if (marketScore >= 45) marketLabel = "Decent";

    const cityName = city ? city.replace(/\b\w/g, c => c.toUpperCase()) : "Unknown city";
    const popText = pop ? `~${(pop / 1000).toFixed(0)}k pop` : "pop unknown";
    const compText = comp.field <= 7
      ? `light competition (${comp.field} listings)`
      : comp.strong >= 4
        ? `crowded — ${comp.strong} entrenched leaders`
        : `${comp.field} competitors, ${comp.strong} strong`;
    const marketReason = `${cityName}: ${popText}, ${compText}`;

    const market = { score: marketScore, label: marketLabel, reason: marketReason };

    const leads: Lead[] = places
      .map((p) => scoreLead(p, market))
      .filter((l: Lead | null): l is Lead => l !== null)
      .sort((a, b) => b.score - a.score);

    return new Response(
      JSON.stringify({
        count: leads.length,
        scanned: places.length,
        market,
        leads,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "Request failed", detail: String(e?.message ?? e) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/leads",
};
