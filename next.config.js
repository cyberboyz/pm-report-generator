/** @type {import('next').NextConfig} */
module.exports = {
  // make sure Vercel ships the Word template with the serverless function
  experimental: { outputFileTracingIncludes: { "/api/generate": ["./templates/**/*"] } },
};
