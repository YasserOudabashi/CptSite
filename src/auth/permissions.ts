import type { NextFunction, Request, Response } from 'express';
import type { RoleCode } from '../users/roles';

// Azioni della matrice (Matrice_Permessi_BOZZA.md, sezioni GA e amministrazione).
// Ogni azione elenca i ruoli che la consentono; il Responsabile sito può tutto.
// "Organizzatore" non è un ruolo: chi ha proposto un'attività la gestisce se è allievo/docente/relatore,
// e la verifica "solo le sue" spetta alla pagina che carica l'attività.
const PERMISSIONS = {
  'ga.view': ['allievo', 'docente', 'relatore'],
  'ga.enroll': ['allievo', 'docente'],
  'ga.propose': ['allievo', 'docente', 'relatore'],
  'ga.myActivity': ['allievo', 'docente', 'relatore'],
  'ga.attendance.own': ['allievo', 'docente', 'relatore'],
  'ga.attendance.all': ['resp_ga'],
  'ga.manage': ['resp_ga'],
  'ga.approve': ['resp_ga'],
  'ga.contacts': ['resp_ga'],
  'poll.vote': ['allievo', 'docente'],
  'poll.create': ['resp_ga'],
  'admin.users': [],
  'admin.studentList': [],
  'admin.invites': [],
  'admin.settings': [],
} as const satisfies Record<string, readonly RoleCode[]>;

export type Action = keyof typeof PERMISSIONS;

export function can(user: { roles: readonly RoleCode[] } | undefined, action: Action): boolean {
  if (!user) return false;
  if (user.roles.includes('resp_sito')) return true;
  const allowed: readonly RoleCode[] = PERMISSIONS[action];
  return user.roles.some((r) => allowed.includes(r));
}

// Non autenticato: redirect al login. Autenticato senza permesso: 403 con pagina "non autorizzato"
// (testo semplice per le richieste che non accettano HTML, ad esempio le API).
export function requireCan(action: Action) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.redirect('/login');
      return;
    }
    if (!can(req.user, action)) {
      res.status(403);
      if (req.accepts(['html', 'json']) === 'json') {
        res.json({ error: 'Non autorizzato' });
      } else {
        res.send('<!doctype html><html lang="it"><meta charset="utf-8"><title>Non autorizzato</title><h1>Non autorizzato</h1><p>Non hai il permesso di vedere questa pagina.</p>');
      }
      return;
    }
    next();
  };
}
