# Lead Finder — Setup (5 minutes)

A web tool that pulls active North-TX home-service businesses from Google,
filters for the ones worth calling, ranks them by fit, and lets you copy
the phone number straight into Go High Level.

Your Google API key NEVER touches the browser — it lives as a server-side
environment variable on Netlify.

---

## Step 1 — Get a Google Places API key (free tier covers your use)

1. Go to https://console.cloud.google.com/
2. Create a project (any name).
3. In the search bar, find and ENABLE: **"Places API (New)"**.
4. Go to **APIs & Services > Credentials > Create Credentials > API key**.
5. Copy the key. (Optional but smart: click "Restrict key" and limit it to
   the Places API so it can't be abused.)
6. You'll need to enable billing on the Google project, but Google gives a
   large free monthly allowance — at your volume (a few hundred lookups/mo)
   you should stay free. Set a budget alert if you want peace of mind.

---

## Step 2 — Deploy to Netlify

EASIEST (drag & drop won't work with functions, so use Git):

1. Create a new repo on github.com and upload this whole folder, OR
   install the Netlify CLI and run `netlify deploy` from this folder.
2. In Netlify, the site **inside-prosper-leadfinder** already exists —
   connect this repo to it (Site > Build & deploy > Link repository),
   or create a fresh site from the repo.
3. Netlify auto-detects the settings from netlify.toml (publish = public,
   functions = netlify/functions). No build command needed.

---

## Step 3 — Add your API key (the important part)

1. In Netlify: **Site configuration > Environment variables > Add a variable**
2. Key:   GOOGLE_PLACES_KEY
3. Value: (paste your Google key)
4. Save, then trigger a redeploy (Deploys > Trigger deploy).

---

## Step 4 — Use it

Open your site URL. Type "roofers in Prosper TX" (or tap a trade chip),
hit Find leads. Click the green phone button on any card to copy the
number, then paste into GHL.

### How leads are filtered (hard cutoffs)
- 4.5★ or higher
- 10+ reviews
- has a physical address
- business is operational

### How they're scored (sorted best-fit first)
- Review count: 20–100 = best
- Rating quality
- Longevity (estimated from oldest visible review)
- Recent activity (still getting reviews)
- Weak/no website = higher score (that's your opening)

Note: business age is ESTIMATED from the oldest review Google returns.
It's a proxy, not exact — Google doesn't publish founding dates.

---

## Market score (added)

Every search now also gets a MARKET score (0-100), shown as a banner at the
top and a pill on each lead card:

- **Demand** comes from city population (a free proxy — real Google search
  volume needs a paid keyword tool). Bigger city = more searches.
- **Competition openness** is computed live from the search results: how many
  competitors came back and how strong they are (review depth). Few/weak
  competitors = wide open.
- **Market score = demand + openness**, weighted toward openness, because a
  beatable field is where a client can actually climb Google rankings.

Labels: 75+ Goldmine · 60+ Strong · 45+ Decent · below Tough.

Covers the Frisco-to-Denton corridor and core North TX cities. Unrecognized
cities get a neutral demand score and still get a competition reading.
