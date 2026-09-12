# Brie

Run events your way. The approved public landing page stays at `/`. The private organizing app lives at `/app`.

Read [PRODUCT.md](PRODUCT.md), [MVP.md](MVP.md), and [DESIGN.md](DESIGN.md) for scope. Local setup is in [docs/SETUP.md](docs/SETUP.md). Operator backup, restore, and erasure notes are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

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
