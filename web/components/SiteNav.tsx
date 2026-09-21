import Link from "next/link";

const links = [
  { href: "/", label: "Demo" },
  { href: "/analyze", label: "Unity analysis" },
  { href: "/upgrade", label: "Premium preview" },
] as const;

export function SiteNav({ current }: { current: "demo" | "analyze" | "upgrade" }) {
  return (
    <header className="relative z-10 mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 pt-6 lg:px-10">
      <Link href="/" className="headline shrink-0 whitespace-nowrap text-lg font-semibold tracking-tight text-ink">
        AI-E
      </Link>
      <nav className="flex flex-wrap justify-end gap-2 text-sm font-semibold">
        {links.map((link) => {
          const active =
            (current === "demo" && link.href === "/") ||
            (current === "analyze" && link.href === "/analyze") ||
            (current === "upgrade" && link.href === "/upgrade");
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                active
                  ? "rounded-full bg-ink px-4 py-2 text-white"
                  : "rounded-full border border-ink/10 bg-white/70 px-4 py-2 text-ink transition hover:-translate-y-0.5"
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
