# Confronto sito GA Lilu2 vs requisiti nostro sito (CPT Trevano)

Analisi del 03.10.2026 su https://www.lilu2.ch/ga/ (solo parte pubblica: catalogo + login + README interno).
Dati salvati in questa cartella: `attivita_lilu2_2026.csv` (150 attività), `backup_html/` (HTML grezzo di catalogo, fasce, login, CSS, JS), `readme_cambio_anno_lilu2.pdf`.

## 1. Cosa fa Lilu2 (visto o dedotto)

| Area | Lilu2 | Fonte |
|---|---|---|
| Stack | PHP/Apache, jQuery, AJAX (`ajax/*.php` restituiscono HTML), cookie di sessione `sessione_ga` | visto |
| Catalogo pubblico | `show_a.php`: menu fasce + elenco attività (n° - titolo, relatore + qualifica, fasce colorate, descrizione) | visto |
| Fasce | 9 fasce su 3 giorni, nome "Fascia N", colore, giorno/data/inizio/fine, "disponibile", fasce multiple (1+2, 4+5+6) con "fascia di riferimento" + "fasce escluse" | visto (catalogo + README) |
| Login | utente + codice di accesso; secondo codice via mail (token 6 cifre); opzionale sync LDAP col server di sede | visto |
| Utenti | import CSV `username,nome,cognome,mail,classe`, reset annuale, codici login stampabili per classe | README |
| Parametri globali | ANNOA (anno), LONFF (iscrizioni on/off), FOR (raccolta proposte), LDAP | README |
| Proposta attività | form proposta (css `proposal`, `send_a`) in fase "raccolta proposte" | dedotto, non visto |
| Iscrizioni | `subscribe.php`, aperte/chiuse da parametro | dedotto, non visto |
| Aule | `aule_assign.php` | dedotto, non visto |
| Mail | `send_m.php`, `send_r.php`, `send_auto.php`, `auto_u.php` (probabile invio a utenti/relatori) | dedotto, non visto |
| Admin | "Editor Tabelle / Banche Dati" (tabelle editabili), "Statistiche e stampe" | README |

## 2. Confronto con i nostri requisiti

Legenda: ✅ coperto da Lilu2 · ⚠️ parziale / da verificare · ❌ non c'è, lo facciamo noi

| Requisito nostro | Lilu2 | Nota |
|---|---|---|
| Catalogo attività pubblico con filtro fascia | ✅ | copiare struttura (n°, titolo, relatore+qualifica, fasce, descrizione) |
| Attività: titolo, descrizione, fascia, relatore | ✅ | |
| Attività: durata, aula, max partecipanti | ⚠️ | non nel catalogo pubblico; aule via `aule_assign`; max posti non visto |
| Relatore: telefono, materiale | ❌/⚠️ | non visibili; probabili solo in admin |
| Fasce multiple (blocchi 2-3 fasce) | ✅ | modello "fascia di riferimento + escluse": utile, ma più semplice = una fascia con durata in slot |
| Orari nostri (5 fasce/giorno, pranzo) | ❌ | Lilu2 ha 3 fasce/giorno; i nostri slot: 8:30-10:00, 10:15-11:45, pranzo, 12:45-14:15, 14:30-16:00 |
| Proposta attività da relatori/docenti | ⚠️ | esiste ma non visto; noi: via mail con modello strutturato + estrazione a regole |
| Iscrizioni allievi | ✅ (non visto) | |
| **Posti in tempo reale** | ❌ | Lilu2 ricarica via AJAX; noi WebSocket/SSE + LISTEN/NOTIFY |
| Ruoli (Admin, Organizzatore, Docente, Allievo, Relatore, Eco, Assemblea, Direzione) | ⚠️ | Lilu2 ha almeno utente + admin locale; matrice permessi nostra da definire |
| Login | ✅ utente+codice+token mail / LDAP | decisione aperta nostra (Moodle / network ID / link magico) |
| Import utenti da CSV + reset annuale | ✅ | copiare l'idea (username, nome, cognome, mail, classe) |
| Codici login stampabili per classe | ✅ | utile se niente LDAP/Moodle |
| Export CSV/XLSX | ⚠️ | "Statistiche e stampe"; non visto |
| Mail IMAP/SMTP + estrazione info | ❌ | Lilu2 solo invio; la lettura mail è nostra |
| Dato correggibile a mano + link mail d'origine | ❌ | nostro |
| Editor tabelle admin | ✅ | idea riusabile: CRUD generico sulle tabelle base |
| Parametri on/off (anno, iscrizioni, proposte) | ✅ | replicare come tabella `config` |
| Assemblea (OdG, presenze, verbale I/C/D/E) | ❌ | fuori scopo Lilu2 |
| Eco Comitato (riunioni, verbali a rotazione, ruoli, sondaggi) | ❌ | fuori scopo Lilu2 |
| Privacy minorenni (nLPD) | ⚠️ | non valutabile da fuori |
| Sicurezza | ⚠️ | difetto Lilu2: elenco directory aperto su `/css`, `/images`, `/ajax`; da non replicare |

## 3. Cosa NON abbiamo potuto vedere (serve per replicare davvero)
- Schema DB (tabelle e campi reali), codice PHP.
- Pagine dopo il login: iscrizione allievo, vista docente/relatore, admin, statistiche, form proposta.
- Regole di iscrizione: limite attività per allievo, sovrapposizioni, posti massimi, conflitti fasce multiple.
- Testo dei modelli di mail e dei flussi automatici.
→ Se serve, chiedere all'autore del sito Lilu2 (ga@lilu2.ch, "Commissione GA", copyright A. Pedrazzini) una demo o uno screenshot dell'area admin/iscrizione.

## 4. Dati chiave 2026 (Lilu2)
- 150 attività, 144 relatori distinti, 21 con sole fasce multiple.
- Attività per fascia: 29/30/30/26/30/26/22/27/23 (fasce 1-9).
- Attività senza fascia singola ma "a blocchi": cineforum, uscite (escursione, mountain bike), visite.

## 6. Da fare alla fine (carino da avere, non prioritario)
- **Mappa visiva del CPT Trevano**: pianta SVG con aule cliccabili collegate ai codici aula. Si parte da piante PDF (evacuazione / ufficio tecnico). Solo dopo che GA, Assemblea ed Eco Comitato funzionano.

## 7. Aule: dati da ottenere
- Online c'è solo il generico: aula magna (fonti discordanti, 104 o 340 posti), 2 palestre singole + 2 doppie divisibili, 2 piscine. Capienze per singola aula e laboratori NON sono pubbliche.
- Da chiedere in direzione/segreteria: export aule dall'orario (codice, edificio, piano, capienza, tipo, accessibilità).

## 5. Proposta di modello dati minimo (da confermare)
`utente(id, username, nome, cognome, mail, classe, ruolo)` · `fascia(id, anno, nome, giorno, inizio, fine, durata_slot, disponibile)` · `attivita(id, n, titolo, descrizione, aula, max_posti, stato)` · `relatore(id, nome, cognome, qualifica, mail, telefono)` · `attivita_fascia(attivita_id, fascia_id)` · `iscrizione(utente_id, attivita_id, fascia_id)` · `config(chiave, valore)` · `mail(id, da, oggetto, corpo, attivita_id)`.
