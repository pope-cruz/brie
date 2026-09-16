# Release demonstration checklist

Run after `npm run build`, `npm run lint`, `npm test`, and a local `supabase db reset`. `npm run test:e2e:public` covers the landing, sign-in, viewport, zoom, motion and contrast items; `npm run test:e2e:release` covers the remaining items with fresh fictional accounts. Tick a box only after the corresponding automated run or manual check actually passed.

- [ ] Landing at `/` matches the approved desktop and mobile baselines.
- [ ] `/app/sign-in` email code works on 375px and desktop keyboard-only.
- [ ] Creating a workspace twice with the same request key creates one workspace.
- [ ] Unauthenticated `/app/w/:id/events` returns to sign-in with a same-origin return path.
- [ ] Member cannot create an event or import attendance through the UI or a direct RPC.
- [ ] Volunteer can complete an assigned task and read the full run of show at 375px.
- [ ] Import preview totals match committed receipt totals.
- [ ] Retrying commit with the same key does not double-count.
- [ ] Revert of overlapping batches keeps people supported by the other batch.
- [ ] Viewports: 1440×900, 1024×768, 768×1024, 375×812, 320×640.
- [ ] 200% zoom, reduced motion, and contrast of text/control pairs.
- [ ] Empty, loading, error, and permission states have no sample numbers.
