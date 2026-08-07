/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // lighthouse and axe-core are CJS/ESM-dynamic-require packages that
    // Next's webpack tracer can't safely bundle for the server runtime
    // (docs/TECH_DEBT.md items 1 and 3). puppeteer/puppeteer-core already
    // ship in Next's own default external-packages list, which is why
    // they don't need to be listed here too.
    serverComponentsExternalPackages: ["lighthouse", "chrome-launcher", "axe-core"],
  },
};

export default nextConfig;
