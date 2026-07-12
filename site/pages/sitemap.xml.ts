import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site, url }) => {
  const origin = site ?? new URL(url.origin);
  const home = new URL("/", origin).href;

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${home}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
