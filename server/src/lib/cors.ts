import type { NextFunction, Request, Response } from "express";

/**
 * The web app at ripe.cooking calls this API from another origin, with a bearer token, so the
 * browser sends a preflight first. Only listed origins get CORS headers; the iOS app sends no
 * Origin header and is unaffected.
 */
export function cors(allowed: readonly string[]) {
  const origins = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin || !origins.has(origin)) return next();
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (req.method !== "OPTIONS") return next();
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
  };
}
