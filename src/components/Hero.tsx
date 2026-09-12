import { ImageDithering } from '@paper-design/shaders-react'
import heroImage from '../assets/hero-landscape.jpg'

export function Hero() {
  return (
    <section className="relative flex h-[60vh] min-h-[420px] w-full shrink-0 flex-col overflow-clip rounded-3xl bg-moss md:h-[760px]">
      <ImageDithering
        originalColors
        inverted={false}
        type="8x8"
        size={1.5}
        colorSteps={5}
        image={heroImage}
        scale={1}
        fit="cover"
        colorBack="#00000000"
        colorFront="#94FFAF"
        colorHighlight="#EAFF94"
        className="absolute inset-0 h-full w-full bg-[#000C38]"
      />

      {/* Shade so the headline stays legible over the photo */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%]"
        style={{
          backgroundImage:
            'linear-gradient(in oklab 180deg, oklab(0% 0 0 / 0%) 0%, oklab(18.5% -0.023 0.014 / 65%) 100%)',
        }}
      />

      <a
        href="/"
        className="absolute left-6 top-6 text-3xl/9 font-medium tracking-[-0.06em] text-ink md:left-10 md:top-7"
      >
        brie
      </a>
      <a
        href="/app/sign-in"
        className="absolute right-6 top-7 text-base/6 tracking-[-0.03em] text-ink md:right-10 md:top-8"
      >
        Sign in
      </a>

      <h1 className="absolute inset-x-6 bottom-10 text-center text-[clamp(2rem,6vw,4rem)] leading-[1.06] tracking-[-0.045em] text-balance text-white md:inset-x-16 md:bottom-14">
        Run events your way.
      </h1>
    </section>
  )
}
