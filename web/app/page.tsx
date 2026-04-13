import { ExamplePreview } from "@/components/ExamplePreview";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { UpgradeCard } from "@/components/UpgradeCard";

export default function HomePage() {
  return (
    <main className="page-shell">
      <Hero />
      <HowItWorks />
      <ExamplePreview />
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-16 pt-6 lg:px-10">
        <UpgradeCard />
      </section>
    </main>
  );
}