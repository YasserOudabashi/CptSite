import type { Request, Response } from 'express';
import { readCookie } from '../auth/session';
import { esc } from '../ui/layout';

export function doc(title: string, body: string, head = ''): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${head}</head><body>
${body}
</body></html>`;
}

// POST/redirect/GET come in GA: l'esito viaggia in un cookie di breve durata, letto e cancellato dalla pagina successiva.
export function go(res: Response, url: string, m: string): void {
  res.cookie('esito', JSON.stringify({ m }), { httpOnly: true, sameSite: 'lax', maxAge: 60_000, path: '/' });
  res.redirect(303, url);
}

export function takeFlash(req: Request, res: Response): string {
  const c = readCookie(req, 'esito');
  if (!c) return '';
  res.clearCookie('esito');
  try {
    return `<p role="status"><strong>${esc(JSON.parse(c).m)}</strong></p>`;
  } catch {
    return '';
  }
}

// Data/ora dal database (timestamptz) -> testo e valore per <input type="datetime-local">, sempre ora di Zurigo.
export const fmtWhen = (d: Date | null): string =>
  d ? d.toLocaleString('it-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'da definire';
export const localInput = (d: Date | null): string => (d ? d.toLocaleString('sv-SE', { timeZone: 'Europe/Zurich' }).replace(' ', 'T').slice(0, 16) : '');
