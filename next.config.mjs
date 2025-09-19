/**
 * Base Next.js configuration for the App Router stack.
 * - reactStrictMode: adds extra checks in development to catch side-effects.
 * - Keep minimal now; we’ll expand as features (images, redirects, etc.) arrive.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
