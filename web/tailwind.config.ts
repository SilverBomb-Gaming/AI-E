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
        field: "var(--color-field)",
      },
      boxShadow: {
        float: "0 18px 48px rgba(18, 36, 36, 0.1)",
      },
      backgroundImage: {
        site: "linear-gradient(180deg, #f7f4ec 0%, #f3f7f4 42%, #ffffff 100%)",
      },
    },
  },
  plugins: [],
};

export default config;