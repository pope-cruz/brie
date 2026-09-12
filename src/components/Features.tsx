const features = [
  { term: 'Plan', description: 'Reusable event templates, tasks, and run of show.' },
  { term: 'Run', description: 'Coordinate your team and keep everyone on schedule.' },
  { term: 'Remember', description: 'Track attendance and build a history of your community.' },
] as const

export function Features() {
  return (
    <section className="w-full px-6 py-16 md:px-[71px] md:py-18">
      <dl className="flex flex-col gap-7">
        {features.map(({ term, description }) => (
          <div key={term} className="flex w-full flex-col items-baseline gap-1 sm:flex-row sm:gap-8">
            <dt className="w-38 shrink-0 text-[22px]/8 tracking-[-0.025em] text-ink sm:text-term">
              {term}
            </dt>
            <dd className="m-0 text-[18px]/7 tracking-[-0.025em] text-sage sm:text-lede">
              {description}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
