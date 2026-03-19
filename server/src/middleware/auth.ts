import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../modules/auth/tokens.js";

declare module "express-serve-static-core" {
  interface Request {
    session?: {
      userId: string;
      publicKey: string;
      isHolder: boolean;
      isAdmin: boolean;
    };
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.accessToken;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.session = verifyAccessToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid access token" });
  }
};

export const requireHolder = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.isHolder) {
    return res.status(403).json({ error: "Holder verification required" });
  }

  return next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.isAdmin) {
    return res.status(403).json({ error: "Admin role required" });
  }

  return next();
};
