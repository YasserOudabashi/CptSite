import { Pool } from 'pg';
import { esc } from '../ui/layout';
import { Plan, PlanMatch, buildPlan } from './plan';
import { Tournament, User, canManage, getTournament } from './service';
import { listTeams } from './teams';

// Squadre che entrano nel calendario: quelle valide (giocatori giusti o accettate a mano).
async function validTeams(pool: Pool, t: Tournament) {
  const teams = await listTeams(pool, t);
  return { ok: teams.filter((x) => x.valid), skipped: teams.filter((x) => !x.valid) };
}

export async function previewPlan(pool: Pool, t: Tournament, seed: number) {
  const { ok, skipped } = await validTeams(pool, t);
  const plan = buildPlan(t, ok.map((x) => ({ id: x.id, seed_no: x.seed_no })), seed);
  return { plan, teams: ok, skipped };
}

async function finishedMatches(pool: Pool, tid: number): Promise<boolean> {
  return (await pool.query(`SELECT 1 FROM tournament_matches WHERE tournament_id = $1 AND (status <> 'da giocare' OR home_score IS NOT NULL) LIMIT 1`, [tid])).rowCount === 1;
}

export async function setSeedNo(pool: Pool, user: User, tid: number, teamId: number, seedNo: number | null): Promise<void> {
  if (!(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  const t = await getTournament(pool, tid);
  if (!t || t.status === 'concluso' || (await finishedMatches(pool, tid))) throw new Error('Non puoi più cambiare le teste di serie.');
  if (seedNo !== null && (!Number.isInteger(seedNo) || seedNo < 1)) throw new Error('Numero di testa di serie non valido.');
  await pool.query('UPDATE tournament_teams SET seed_no = $3 WHERE id = $1 AND tournament_id = $2', [teamId, tid, seedNo]);
}

// Salva il calendario. Primo calendario: da "iscrizioni"; rigenerazione: da "in corso" finché nessun risultato è stato inserito.
// Lo stesso seme dell'anteprima dà lo stesso calendario.
export async function generateCalendar(pool: Pool, user: User, tid: number, seed: number): Promise<void> {
  if (!(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<Tournament>('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [tid]);
    const t = rows[0];
    if (!t || !['iscrizioni', 'in corso'].includes(t.status)) throw new Error('Il calendario si genera con le iscrizioni aperte o con il torneo in corso.');
    if (t.status === 'in corso' && (await finishedMatches(pool, tid))) throw new Error('Sono già stati inseriti dei risultati: il calendario non si rigenera.');
    const { plan } = await previewPlan(pool, t, seed);
    await client.query('DELETE FROM tournament_matches WHERE tournament_id = $1', [tid]);
    await client.query('DELETE FROM tournament_groups WHERE tournament_id = $1', [tid]);
    await client.query('UPDATE tournament_teams SET group_id = NULL, draw_no = NULL WHERE tournament_id = $1', [tid]);
    const gid: number[] = [];
    for (const [i, g] of plan.groups.entries()) {
      const r = await client.query<{ id: number }>('INSERT INTO tournament_groups (tournament_id, name) VALUES ($1,$2) RETURNING id', [tid, `Girone ${String.fromCharCode(65 + i)}`]);
      gid.push(r.rows[0].id);
      await client.query('UPDATE tournament_teams SET group_id = $1 WHERE id = ANY($2::int[])', [r.rows[0].id, g]);
    }
    for (const [team, n] of plan.draw) await client.query('UPDATE tournament_teams SET draw_no = $2 WHERE id = $1', [team, n]);
    const src = (s?: string) => (s ? s.replace(/^G(\d+):/, (_m, i) => `G${gid[Number(i)]}:`) : null);
    const ids = new Map<string, number>();
    const ko = plan.matches.filter((m) => m.stage === 'eliminazione').sort((a, b) => b.round - a.round || a.pos - b.pos);
    const insert = async (m: PlanMatch) => {
      const next = m.next ? ids.get(`${m.next.round}:${m.next.pos}`) ?? null : null;
      const r = await client.query<{ id: number }>(
        `INSERT INTO tournament_matches (tournament_id, stage, group_id, round, pos, home_id, away_id, home_src, away_src, next_match_id, next_slot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tid, m.stage, m.group == null ? null : gid[m.group], m.round, m.pos, m.home, m.away, src(m.homeSrc), src(m.awaySrc), next, m.next?.slot ?? null],
      );
      ids.set(`${m.round}:${m.pos}`, r.rows[0].id);
    };
    for (const m of ko) await insert(m);
    for (const m of plan.matches.filter((x) => x.stage === 'girone')) await insert(m);
    await client.query(`UPDATE tournaments SET status = 'in corso' WHERE id = $1`, [tid]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Anteprima: gironi, partite per turno e tabellone, senza salvare nulla.
export function previewHtml(t: Tournament, p: { plan: Plan; teams: { id: number; name: string }[]; skipped: { name: string }[] }, seed: number): string {
  const name = new Map(p.teams.map((x) => [x.id, x.name]));
  const label = (id: number | null, src?: string) => (id ? esc(name.get(id) ?? '?') : src ? `${src.split(':')[1]}° del ${esc(`Girone ${String.fromCharCode(65 + Number(src.slice(1).split(':')[0]))}`)}` : 'da definire');
  const groups = p.plan.groups
    .map((g, i) => `<h3>Girone ${String.fromCharCode(65 + i)}</h3><ul>${g.map((id) => `<li>${esc(name.get(id) ?? '')}</li>`).join('')}</ul>`)
    .join('');
  const list = (stage: string) =>
    p.plan.matches
      .filter((m) => m.stage === stage)
      .map((m) => `<li>${stage === 'girone' ? `Girone ${String.fromCharCode(65 + (m.group ?? 0))} · ` : ''}turno ${m.round}: ${label(m.home, m.homeSrc)} – ${label(m.away, m.awaySrc)}</li>`)
      .join('');
  const skipped = p.skipped.length ? `<p><strong>Escluse (incomplete, non accettate):</strong> ${p.skipped.map((x) => esc(x.name)).join(', ')}</p>` : '';
  const warn = p.plan.warnings.map((w) => `<p><strong>Attenzione:</strong> ${esc(w)}</p>`).join('');
  return `${skipped}${warn}${groups}<h3>Partite dei gironi</h3><ol style="padding-left:1.2rem">${list('girone') || '<li>—</li>'}</ol>
<h3>Eliminazione</h3><ol style="padding-left:1.2rem">${list('eliminazione') || '<li>—</li>'}</ol>
<form method="post" action="/tornei/${t.id}/calendario" style="display:inline"><input type="hidden" name="seed" value="${seed}"><button>${t.status === 'in corso' ? 'Sostituisci il calendario con questo' : 'Conferma e avvia il torneo'}</button></form>
<a href="/tornei/${t.id}/calendario?seed=${Math.floor(Math.random() * 1e9)}">Sorteggia di nuovo</a>`;
}
