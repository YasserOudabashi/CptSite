import type { NextFunction, Request, Response } from 'express';
import type { RoleCode } from '../users/roles';

export interface SessionUser {
  id: number;
  roles: RoleCode[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

// `req.user` viene impostato da `sessionMiddleware` (src/auth/session.ts). Senza utente: redirect al login.
// Il controllo per azione con unione dei ruoli arriva con US-009 (`can()`).
export function requireRole(role: RoleCode) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.redirect('/login');
      return;
    }
    if (!req.user.roles.includes(role)) {
      res.status(403).send('Non autorizzato');
      return;
    }
    next();
  };
}
