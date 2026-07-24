import { handleApi } from "./_shared/backend.mjs";

function routeFromUrl(url) {
  const pathname = new URL(url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  return parts.at(-1) || "health-check";
}

export default async function handler(req) {
  return handleApi(req, routeFromUrl(req.url));
}

