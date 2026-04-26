import Link from "next/link";

const sections = [
  {
    href: "/round-dashboard",
    title: "Doctor Round Dashboard",
    subtitle: "Your migrated multi-tool dashboard",
    icon: "🩺",
  },
  {
    href: "/portfolio",
    title: "Portfolio App",
    subtitle: "Track holdings, performance, and ideas",
    icon: "📈",
  },
  {
    href: "/outpatient-dashboard",
    title: "Outpatient Records",
    subtitle: "Review queue for education and follow-up labs",
    icon: "🏥",
  },
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-black to-slate-900 text-white">
      <div className="grid-background" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-16 md:px-12">
        <div className="mb-10 text-center">
          <p className="mb-3 text-sm uppercase tracking-[0.35em] text-orange-300/80">Personal Blog Workspace</p>
          <h1 className="bg-gradient-to-r from-orange-500 via-orange-400 to-yellow-400 bg-clip-text text-4xl font-bold text-transparent md:text-6xl">
            App Launcher
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-orange-200/80 md:text-base">
            Your original root page has been moved to a dedicated route. Choose a destination to continue.
          </p>
        </div>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="glass glass-hover group rounded-2xl border border-orange-500/20 p-8 transition-all hover:-translate-y-1"
            >
              <div className="mb-4 text-4xl transition-transform duration-300 group-hover:scale-110">{section.icon}</div>
              <h2 className="mb-2 text-2xl font-semibold text-orange-200">{section.title}</h2>
              <p className="text-sm text-orange-200/70">{section.subtitle}</p>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-orange-300/80">Open {section.href}</p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
