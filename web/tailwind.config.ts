import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "var(--color-ink)",
        mist: "var(--color-mist)",
        sand: "var(--color-sand)",
        coral: "var(--color-coral)",
        ember: "var(--color-ember)",
        ocean: "var(--color-ocean)",
        slate: "var(--color-slate)",
      },
      boxShadow: {
        float: "0 24px 80px rgba(18, 36, 36, 0.12)",
      },
      backgroundImage: {
        mesh: "radial-gradient(circle at top left, rgba(255, 122, 89, 0.22), transparent 34%), radial-gradient(circle at 85% 20%, rgba(24, 92, 140, 0.24), transparent 28%), linear-gradient(135deg, rgba(255, 246, 232, 0.94), rgba(238, 247, 246, 0.96))",
      },
    },
  },
  plugins: [],
};

export default config;