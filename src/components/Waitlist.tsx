export function Waitlist() {
  return (
    <section className="flex w-full flex-col items-center justify-center gap-8 border-t border-rule px-6 pb-24 pt-20 text-center md:px-20 md:pb-28 md:pt-22">
      <h2 className="text-[clamp(1.75rem,4vw,44px)] leading-[1.18] tracking-[-0.04em] text-ink">
        Ready to run your next event?
      </h2>

      <p className="m-0 text-base/6 text-moss">Brie is coming soon.</p>

      <a
        href="#waitlist"
        className="flex items-center justify-center rounded-full bg-ink px-7 py-4 text-base/6 text-white transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        Join the waitlist
      </a>
    </section>
  )
}
