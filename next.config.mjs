/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Allow randomized Blob subdomains used for public assets
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
        pathname: "/**",
      },
      // And the root host, if ever used
      {
        protocol: "https",
        hostname: "public.blob.vercel-storage.com",
        pathname: "/**",
      },
    ],
  },
  // Lint and type-check are both enabled during `next build`.
};

export default nextConfig;
