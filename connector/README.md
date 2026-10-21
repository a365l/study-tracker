# Study Tracker connector

An MCP server on Cloudflare Workers that lets a chat assistant on my phone read and update the tracker while I revise. It can see what's due and what's weak, rate topics red/amber/green, move topic stages, log study sessions and add scores. The edits land in the real app on my PC.

## How it works

```
phone chat app  --MCP-->  Cloudflare Worker + Durable Object  <--sync--  app.py on my PC
```

- The PC app pushes its whole `data.json` (plus the curriculum) a few seconds after every save.
- Edits made over MCP are queued in the Durable Object and applied to its copy straight away, so the next question already sees them.
- While the app is open it checks the queue every 20 seconds (and when the window gets focus), applies the edits through the same code as clicking, and saves. The save records `sync.appliedSeq`, and the next push clears those edits from the queue.
- If the PC is off, edits wait in the queue until the app is next opened. The app works the same as before without the connector.

Everything is plain JavaScript with no dependencies apart from wrangler for deploying. The MCP part is a small stateless JSON-RPC handler (`src/mcp.js`) rather than an SDK.

| Tool | What it does |
|---|---|
| `get_overview` | due reviews, red/amber topics, unrated topics, chapters in progress, this week's time, recent sessions and scores, upcoming exams |
| `find_topics` | search topics by subject, chapter or topic name; returns keys and current state |
| `update_topics` | set stage, rating and/or note for up to 40 topics; all or nothing |
| `log_session` | add a study session |
| `add_score` | add a test or paper mark |

## Security

- The MCP endpoint is `/mcp/<MCP_KEY>`, a long random key, so the URL itself is the secret. It only goes in the chat app's connector settings.
- The sync endpoints need `Authorization: Bearer <PC_TOKEN>`, a different key, kept in `sync.json` in the data folder.
- Wrong keys and unknown paths all return the same 404.

## Setup

```
cd connector
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put MCP_KEY      # paste a long random string
npx wrangler secret put PC_TOKEN     # paste a different one
```

Then put this in `sync.json` in the tracker's data folder:

```json
{ "url": "https://study-tracker-connector.<subdomain>.workers.dev", "token": "<PC_TOKEN>" }
```

and add `https://study-tracker-connector.<subdomain>.workers.dev/mcp/<MCP_KEY>` as a custom connector in the chat app.

On Windows on ARM, wrangler won't start because workerd has no ARM64 build. Deploying doesn't run workerd, so installing the x64 package is enough: `npm install --no-save --force @cloudflare/workerd-windows-64@<workerd version>`.

## Testing

```
npm test                         # runs the Worker code against an in-memory store
node test/local-server.mjs       # local stand-in for the Worker on port 8790 (keys: "local")
```
