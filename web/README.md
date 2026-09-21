# AI-E Web Front Door

Public-facing AI-E surface: Next.js, TypeScript, Tailwind.

The homepage is the **public spine** (chat + `plan_bounded_request`). `/analyze` is the older Unity diagnosis form.

## Local run

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. Demo mode needs no API keys.

```bash
npm test
npm run lint
npm run build
```

## Demo vs live chat

- No `OPENAI_API_KEY`: local planner tool only
- `OPENAI_API_KEY` set: a model may call that same tool
- `AIE_FORCE_DEMO=1`: stay on the local path even if a key exists

See `web/.env.example`.

## Deploy

Set the Vercel **Root Directory** to `web`. Dockerfiles live at `web/Dockerfile` and the repository root. Full steps are in the root README.
