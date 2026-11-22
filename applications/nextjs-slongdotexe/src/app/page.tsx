const navigation = [
  { label: 'About', href: '#about' },
  { label: 'Projects', href: '#projects' },
  { label: 'Experience', href: '#experience' },
  { label: 'Contact', href: '#contact' },
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- I'll get there
const projects = [
  {
    name: 'slongdotexe',
    category: 'Personal website',
    description: 'A home for my projects, built with Next.js and deployed on AWS.',
    technologies: ['Next.js', 'TypeScript', 'AWS'],
  },
]

export default function Home() {
  return (
    <main id="top" className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 font-sans sm:px-10">
      <a
        href="#about"
        className="sr-only focus:not-sr-only focus:mb-6 focus:inline-block focus:text-emerald-700 dark:focus:text-emerald-400"
      >
        Skip to content
      </a>
      <header className="flex flex-col gap-6 border-b border-zinc-200 pb-8 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <a href="#top" className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          Sean Long
        </a>
        <nav aria-label="Main navigation" className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="underline-offset-4 hover:text-emerald-700 hover:underline dark:hover:text-emerald-400"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <section aria-labelledby="intro-heading" className="py-16 sm:py-24">
        <h1 id="intro-heading" className="text-5xl font-semibold sm:text-6xl">
          Sean Long
        </h1>
        <p className="mt-3 max-w-xl text-xl leading-relaxed text-zinc-600 dark:text-zinc-400">
          Senior Software Engineer
        </p>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          More about me, like my favourite Lorem Ipsum quotes.
        </p>
      </section>

      <section
        id="about"
        aria-labelledby="about-heading"
        className="grid scroll-mt-8 gap-6 border-t border-zinc-200 py-12 sm:grid-cols-[180px_1fr] sm:gap-10 dark:border-zinc-800"
      >
        <h2 id="about-heading" className="text-lg font-semibold">
          About
        </h2>
        <div className="min-w-0 max-w-2xl space-y-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          <p>This is my space for me to store my favourite things, like Lore Ipsum quotes. This is quite a nice one:</p>
          <p>Lorem Ipsum set delor</p>
        </div>
      </section>

      {/* <section
        id="projects"
        aria-labelledby="projects-heading"
        className="grid scroll-mt-8 gap-6 border-t border-zinc-200 py-12 sm:grid-cols-[180px_1fr] sm:gap-10 dark:border-zinc-800"
      >
        <h2 id="projects-heading" className="text-lg font-semibold">
          Projects
        </h2>
        <div className="min-w-0 space-y-10">
          {projects.map((project) => (
            <article key={project.name} className="max-w-2xl">
              <p className="mb-4 font-mono text-xs text-emerald-700 dark:text-emerald-400">{project.category}</p>
              <h3 className="text-2xl font-semibold">{project.name}</h3>
              <p className="mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400">{project.description}</p>
              <ul aria-label={`${project.name} technologies`} className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                {project.technologies.map((technology) => (
                  <li key={technology} className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {technology}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section> */}

      <section
        id="experience"
        aria-labelledby="experience-heading"
        className="grid scroll-mt-8 gap-6 border-t border-zinc-200 py-12 sm:grid-cols-[180px_1fr] sm:gap-10 dark:border-zinc-800"
      >
        <h2 id="experience-heading" className="text-lg font-semibold">
          Experience
        </h2>
        <div className="max-w-2xl border-l-2 border-emerald-600 pl-6 dark:border-emerald-400">
          <h3 className="font-medium">The Lorem Ipsums so far</h3>
          <p className="mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400">
            Favourite Lorem Ipsums, the bad ones and the good ones!
          </p>
        </div>
      </section>

      <section
        id="contact"
        aria-labelledby="contact-heading"
        className="grid scroll-mt-8 gap-6 border-t border-zinc-200 py-12 sm:grid-cols-[180px_1fr] sm:gap-10 dark:border-zinc-800"
      >
        <h2 id="contact-heading" className="text-lg font-semibold">
          Contact
        </h2>
        <div className="max-w-2xl">
          <h3 className="text-2xl font-semibold">Get in touch</h3>
          <p className="mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400">
            Get in touch with a Lorem Ipsum specialist (me!)
          </p>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200 py-6 font-mono text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <p>Sean Long / slongdotexe</p>
        <a href="#top" className="underline-offset-4 hover:underline">
          Back to top
        </a>
      </footer>
    </main>
  )
}
