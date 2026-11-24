import type { NextFunction, Request, Response } from 'express';
import { Pool } from 'pg';
import { Action, can } from '../auth/permissions';
import type { RoleCode } from '../users/roles';
import { getCurrentSchoolYear } from '../users/roles';

export const SITE_NAME = 'Portale CPT Trevano';

type User = { roles: readonly RoleCode[] } | undefined;
type MenuItem = { label: string; href: string; action?: Action };

// Voci del menu: ogni voce con `action` compare solo se can(user, action). Senza `action`: ogni utente loggato.
const MENU: MenuItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Attività', href: '/attivita', action: 'ga.view' },
  { label: 'Il mio programma', href: '/programma', action: 'ga.enroll' },
  { label: 'Tornei', href: '/tornei' },
  { label: 'Le mie partite', href: '/tornei/mie' },
  { label: 'Proponi attività', href: '/proponi', action: 'ga.propose' },
  { label: 'La mia attività', href: '/la-mia-attivita', action: 'ga.myActivity' },
  { label: 'Approvazione', href: '/approvazione', action: 'ga.approve' },
  { label: 'Gestione GA', href: '/gestione-ga', action: 'ga.manage' },
  { label: 'Elenco ID', href: '/admin/studenti', action: 'admin.studentList' },
  { label: 'Utenti', href: '/admin/utenti', action: 'admin.users' },
  { label: 'Inviti', href: '/admin/inviti', action: 'admin.invites' },
  { label: 'Impostazioni', href: '/admin/impostazioni', action: 'admin.settings' },
];

const GUEST_MENU: MenuItem[] = [
  { label: 'Accedi', href: '/login' },
  { label: 'Registrati', href: '/registrazione' },
];

export function menuFor(user: User): MenuItem[] {
  if (!user) return GUEST_MENU;
  return MENU.filter((i) => !i.action || can(user, i.action));
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `<style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;margin:0;line-height:1.5}
body>header,body>main{padding:0 1rem;max-width:60rem;margin:0 auto}
.site-title{margin:.75rem 0 0;font-size:1.25rem}
.site-title small{font-weight:normal;opacity:.7}
nav.menu{display:flex;flex-wrap:wrap;gap:.25rem .75rem;align-items:center;padding:.5rem 0;border-bottom:1px solid #8886}
nav.menu form{margin:0}
nav.menu button{font:inherit;background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;padding:0}
input,textarea,button{max-width:100%;box-sizing:border-box}
</style>`;

export function renderHeader(user: User, yearName: string): string {
  const links = menuFor(user).map((i) => `<a href="${i.href}">${esc(i.label)}</a>`);
  if (user) links.push('<form method="post" action="/logout"><button>Esci</button></form>');
  return `<header><p class="site-title"><strong>${esc(SITE_NAME)}</strong>${
    yearName ? ` <small>· anno scolastico ${esc(yearName)}</small>` : ''
  }</p><nav class="menu">${links.join('')}</nav></header>`;
}

// Aggiunge intestazione e menu a ogni pagina HTML completa inviata con res.send (le pagine non devono ripeterli).
// Da montare dopo sessionMiddleware.
export function layoutMiddleware(pool: Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let yearName = '';
    try {
      yearName = (await getCurrentSchoolYear(pool)).name;
    } catch {
      // nessun anno corrente: l'intestazione resta senza anno
    }
    const send = res.send.bind(res);
    res.send = ((body?: unknown) => {
      if (typeof body === 'string' && /^<!doctype html>/i.test(body) && body.includes('<body>')) {
        body = body
          .replace('</head>', `${STYLE}</head>`)
          .replace('<body>', `<body>${renderHeader(req.user, yearName)}<main>`)
          .replace('</body>', '</main></body>');
      }
      return send(body as never);
    }) as Response['send'];
    next();
  };
}
