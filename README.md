# Brie

Run events your way. The approved public landing page stays at `/`. The private organizing app lives at `/app`.

Read [PRODUCT.md](PRODUCT.md), [MVP.md](MVP.md), and [DESIGN.md](DESIGN.md) for scope. Local setup is in [docs/SETUP.md](docs/SETUP.md). The [deployment plan and manual runbook](docs/DEPLOYMENT.md) covers hosting, Auth, SMTP, and release steps. Operator backup, restore, and erasure notes are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

The [post-MVP roadmap and codebase audit](docs/POST_MVP_ROADMAP.md) track attendance, venues, and assistant planning work.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Application commands require a local Supabase stack. Unit tests do not:

```bash
npm test
npm run lint
npm run build
```

Assistant connections support browser sign-in for cloud clients and manual keys for terminals. With the local stack and Edge Functions running, `npm run test:mcp` checks the server with the official MCP SDK and a real OAuth exchange. Use the function environment file in [SETUP.md](docs/SETUP.md#assistant-browser-sign-in) so discovery advertises the public endpoint.
