/**
 * Base Next.js configuration for the App Router stack.
 * Keep minimal; we’ll remove the eslint bypass after fixing the config.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // TEMP: unblock Vercel while we locate the bad ESLint option
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
