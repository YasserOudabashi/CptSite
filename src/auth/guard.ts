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

// `req.user` viene impostato dalla sessione (US-007). Finché non c'è, nessuno è autenticato.
// Il controllo per azione con unione dei ruoli arriva con US-009 (`can()`).
export function requireRole(role: RoleCode) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).send('Accesso richiesto');
      return;
    }
    if (!req.user.roles.includes(role)) {
      res.status(403).send('Non autorizzato');
      return;
    }
    next();
  };
}
