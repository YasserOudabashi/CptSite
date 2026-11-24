import { Pool, PoolClient } from 'pg';
import { esc } from '../ui/layout';
import { Tournament, User, canManage, findUser, getTournament } from './service';

export interface Team {
  id: number;
  name: string;
  captain_id: number | null;
  approved: boolean;
  seed_no: number | null;
  group_id: number | null;
  members: { id: number; name: string; confirmed: boolean }[];
  valid: boolean; // numero di giocatori confermati tra min e max, oppure accettata a mano
}

export async function listTeams(pool: Pool, t: Tournament): Promise<Team[]> {
  const { rows } = await pool.query(
    `SELECT tt.id, tt.name, tt.captain_id, tt.approved, tt.seed_no, tt.group_id,
            COALESCE(json_agg(json_build_object('id', u.id, 'name', u.first_name || ' ' || u.last_name, 'confirmed', m.confirmed) ORDER BY m.confirmed DESC, u.last_name)
                     FILTER (WHERE u.id IS NOT NULL), '[]') AS members
     FROM tournament_teams tt LEFT JOIN tournament_members m ON m.team_id = tt.id LEFT JOIN users u ON u.id = m.user_id
     WHERE tt.tournament_id = $1 GROUP BY tt.id ORDER BY tt.id`,
    [t.id],
  );
  return rows.map((r) => {
    const n = (r.members as { confirmed: boolean }[]).filter((m) => m.confirmed).length;
    return { ...r, valid: r.approved || (n >= t.team_min && n <= t.team_max) };
  });
}

// Il torneo e le sue squadre si leggono con il torneo bloccato: il massimo squadre non si supera mai, nemmeno con richieste simultanee.
async function locked(client: PoolClient, tid: number): Promise<Tournament> {
  const { rows } = await client.query<Tournament>('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [tid]);
  if (!rows[0]) throw new Error('Torneo non trovato.');
  return rows[0];
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if ((e as { code?: string }).code === '23505') {
      const c = (e as { constraint?: string }).constraint ?? '';
      throw new Error(c.includes('name') ? 'Esiste già una squadra con questo nome.' : 'Questa persona è già iscritta a questo torneo.');
    }
    throw e;
  } finally {
    client.release();
  }
}

// Gli iscritti agiscono solo in stato "iscrizioni"; gli organizzatori anche in bozza.
const open = (t: Tournament, manager: boolean) => {
  if (!(t.status === 'iscrizioni' || (manager && t.status === 'bozza'))) throw new Error('Le iscrizioni non sono aperte.');
};

async function insertTeam(c: PoolClient, t: Tournament, name: string, captain: number | null, memberId: number | null, confirmed: boolean): Promise<void> {
  const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM tournament_teams WHERE tournament_id = $1', [t.id]);
  if (rows[0].n >= t.max_teams) throw new Error(`Il torneo è pieno: massimo ${t.max_teams} ${t.mode === 'singoli' ? 'iscritti' : 'squadre'}.`);
  if (!name.trim()) throw new Error('Scrivi il nome della squadra.');
  const team = await c.query<{ id: number }>('INSERT INTO tournament_teams (tournament_id, name, captain_id) VALUES ($1,$2,$3) RETURNING id', [t.id, name.trim(), captain]);
  if (memberId) await c.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,$4)', [team.rows[0].id, t.id, memberId, confirmed]);
}

// Iscrizione propria: squadre = il capitano crea la squadra; singoli = l'utente si iscrive da solo.
export async function joinTournament(pool: Pool, user: User, tid: number, name: string): Promise<void> {
  await tx(pool, async (c) => {
    const t = await locked(c, tid);
    open(t, false);
    const me = (await c.query<{ n: string }>(`SELECT first_name || ' ' || last_name AS n FROM users WHERE id = $1`, [user.id])).rows[0].n;
    await insertTeam(c, t, t.mode === 'singoli' ? me : name, user.id, user.id, true);
  });
}

// L'organizzatore aggiunge a mano una squadra (con un primo giocatore facoltativo, già confermato) o un iscritto singolo.
export async function addTeamManual(pool: Pool, user: User, tid: number, name: string, q: string): Promise<void> {
  if (!(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  const u = q.trim() ? await findUser(pool, q) : null;
  await tx(pool, async (c) => {
    const t = await locked(c, tid);
    open(t, true);
    if (t.mode === 'singoli' && !u) throw new Error('Indica la persona (nome o ID).');
    await insertTeam(c, t, t.mode === 'singoli' ? u!.name : name, u?.id ?? null, u?.id ?? null, true);
  });
}

async function loadTeam(c: PoolClient | Pool, tid: number, teamId: number) {
  const { rows } = await c.query<{ captain_id: number | null }>('SELECT captain_id FROM tournament_teams WHERE id = $1 AND tournament_id = $2', [teamId, tid]);
  if (!rows[0]) throw new Error('Squadra non trovata.');
  return rows[0];
}

export async function addMember(pool: Pool, user: User, tid: number, teamId: number, q: string): Promise<void> {
  const manager = await canManage(pool, user, tid);
  const u = await findUser(pool, q);
  await tx(pool, async (c) => {
    const t = await locked(c, tid);
    open(t, manager);
    if (t.mode === 'singoli') throw new Error('Nei tornei a singoli non ci sono compagni.');
    const team = await loadTeam(c, tid, teamId);
    if (!manager && team.captain_id !== user.id) throw new Error('Solo il capitano aggiunge compagni.');
    const n = (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM tournament_members WHERE team_id = $1', [teamId])).rows[0].n;
    if (n >= t.team_max) throw new Error(`La squadra ha già il massimo di ${t.team_max} giocatori.`);
    // L'organizzatore aggiunge già confermato; il capitano propone e il compagno conferma dal sito.
    await c.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,$4)', [teamId, tid, u.id, manager]);
  });
}

export async function confirmMember(pool: Pool, user: User, tid: number, teamId: number): Promise<void> {
  await tx(pool, async (c) => {
    open(await locked(c, tid), false);
    const r = await c.query('UPDATE tournament_members SET confirmed = true WHERE team_id = $1 AND user_id = $2', [teamId, user.id]);
    if (!r.rowCount) throw new Error('Nessun invito da confermare.');
  });
}

// Toglie un giocatore: lui stesso (rifiuta/lascia), il capitano o un organizzatore. Il capitano non esce: ritira la squadra.
export async function removeMember(pool: Pool, user: User, tid: number, teamId: number, userId: number): Promise<void> {
  const manager = await canManage(pool, user, tid);
  await tx(pool, async (c) => {
    open(await locked(c, tid), manager);
    const team = await loadTeam(c, tid, teamId);
    if (userId === team.captain_id) throw new Error('Il capitano non si toglie: ritira la squadra.');
    if (!manager && team.captain_id !== user.id && userId !== user.id) throw new Error('Non puoi togliere questo giocatore.');
    await c.query('DELETE FROM tournament_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
  });
}

export async function withdrawTeam(pool: Pool, user: User, tid: number, teamId: number): Promise<void> {
  const manager = await canManage(pool, user, tid);
  await tx(pool, async (c) => {
    open(await locked(c, tid), manager);
    const team = await loadTeam(c, tid, teamId);
    if (!manager && team.captain_id !== user.id) throw new Error('Solo il capitano ritira la squadra.');
    await c.query('DELETE FROM tournament_teams WHERE id = $1', [teamId]);
  });
}

export async function approveTeam(pool: Pool, user: User, tid: number, teamId: number, approved: boolean): Promise<void> {
  if (!(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  const t = await getTournament(pool, tid);
  if (!t || t.status === 'in corso' || t.status === 'concluso') throw new Error('Il calendario è già stato generato.');
  await pool.query('UPDATE tournament_teams SET approved = $3 WHERE id = $1 AND tournament_id = $2', [teamId, tid, approved]);
}

// Sezione "Squadre" della pagina del torneo, con i moduli adatti a chi guarda.
export function teamsSection(t: Tournament, teams: Team[], user: User, manager: boolean): string {
  const post = (path: string, label: string, hidden = '') => `<form method="post" action="/tornei/${t.id}/${path}" style="display:inline">${hidden}<button>${label}</button></form>`;
  const mine = teams.find((x) => x.members.some((m) => m.id === user.id));
  const rows = teams
    .map((x) => {
      const captain = x.captain_id === user.id;
      const me = x.members.find((m) => m.id === user.id);
      const players = x.members.map((m) => `${esc(m.name)}${m.confirmed ? '' : ' (invito)'}${
        (captain || manager || m.id === user.id) && m.id !== x.captain_id && t.mode === 'squadre' && (t.status === 'iscrizioni' || manager)
          ? ' ' + post(`squadre/${x.id}/membri/${m.id}/togli`, 'Togli') : ''}`).join(', ');
      const can_ = t.status === 'iscrizioni' || (manager && t.status === 'bozza');
      return `<li><strong>${esc(x.name)}</strong>${x.valid ? '' : ' <em>(incompleta)</em>'}${x.approved ? ' (accettata)' : ''}${
        t.mode === 'squadre' ? ` — ${players || 'nessun giocatore'}` : ''}
${me && !me.confirmed && can_ ? post(`squadre/${x.id}/conferma`, 'Conferma di giocare in questa squadra') : ''}
${(captain || manager) && can_ ? post(`squadre/${x.id}/ritira`, 'Ritira') : ''}
${(captain || manager) && can_ && t.mode === 'squadre' ? `<form method="post" action="/tornei/${t.id}/squadre/${x.id}/membri" style="display:inline"><input name="q" placeholder="Nome o ID compagno" required><button>Aggiungi</button></form>` : ''}
${manager && t.status !== 'in corso' && t.status !== 'concluso' ? post(`squadre/${x.id}/approva`, x.approved ? 'Togli accettazione' : 'Accetta', `<input type="hidden" name="to" value="${x.approved ? 0 : 1}">`) : ''}</li>`;
    })
    .join('');
  const left = Math.max(0, t.max_teams - teams.length);
  const join =
    t.status === 'iscrizioni' && !mine
      ? left === 0
        ? '<p><strong>Il torneo è pieno.</strong></p>'
        : `<form method="post" action="/tornei/${t.id}/squadre">${t.mode === 'squadre' ? '<p><label>Nome della squadra <input name="name" required maxlength="60"></label> ' : '<p>'}<button>${t.mode === 'singoli' ? 'Iscriviti' : 'Crea la squadra (sarai il capitano)'}</button></p></form>`
      : '';
  const manual = manager && (t.status === 'bozza' || t.status === 'iscrizioni')
    ? `<form method="post" action="/tornei/${t.id}/squadre/manuale"><p>${t.mode === 'squadre' ? '<label>Nome squadra <input name="name" required></label> ' : ''}<label>${t.mode === 'singoli' ? 'Persona' : 'Primo giocatore (facoltativo)'} <input name="q"${t.mode === 'singoli' ? ' required' : ''}></label> <button>Aggiungi a mano</button></p></form>`
    : '';
  return `<h2>${t.mode === 'singoli' ? 'Iscritti' : 'Squadre'} (${teams.length}/${t.max_teams}, ${left} posti rimasti)</h2>
${t.mode === 'squadre' ? `<p><small>Una squadra è valida con ${t.team_min}–${t.team_max} giocatori confermati.</small></p>` : ''}
<ul>${rows || `<li>Nessun${t.mode === 'singoli' ? ' iscritto' : 'a squadra'} per ora.</li>`}</ul>${join}${manual}`;
}
