/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(process.env.AIE_DOCKER_BUILD === "1" ? { output: "standalone" } : {}),
};

export default nextConfig;