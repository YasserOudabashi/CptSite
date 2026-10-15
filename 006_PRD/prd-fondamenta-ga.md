# PRD: Portale CPT Trevano — Fondamenta + Giornate Autogestite (GA)

## 1. Introduzione

Sito unico del CPT Trevano per gestire in tempo reale le Giornate Autogestite (GA). In seguito accoglierà anche Assemblea paritetica ed Eco Comitato (PRD separati). Questa prima versione contiene le **fondamenta** (registrazione, login, ruoli, anni scolastici, amministrazione) e tutta la **fase GA** (attività, iscrizioni con posti in tempo reale, presenze, esportazioni).

Il nome del sito è provvisorio ("Portale CPT Trevano"). Bozza cliccabile: https://claude.ai/artifact/1G63Ddf6UgPNHBW31NY89B (file `Bozza_Sito/index.html`). Matrice dei permessi: `Matrice_Permessi_BOZZA.md`. Pagine: `Bozza_Pagine_e_Ruoli.md`.

Autore e Responsabile sito: Yasser Oudabashi. Il sito deve continuare a funzionare anche senza di lui.

## 2. Obiettivi

- Allievi e docenti si registrano da soli e si iscrivono alle attività senza fogli di carta.
- Chi propone un'attività si iscrive per primo; chi non si iscrive viene assegnato in modo casuale.
- I posti liberi si aggiornano in diretta per tutti.
- Il Responsabile GA vede tutto (attività, iscritti, presenze) ed esporta liste.
- Ogni dato appartiene a un anno scolastico; gli anni non si mischiano e i dati vecchi si riutilizzano.
- Nessuna API a pagamento o personale; il sito non dipende da una sessione di Claude.

## 3. Ruoli (riassunto; dettagli in `Matrice_Permessi_BOZZA.md`)

Ruolo base: **Allievo** o **Docente**; **Relatore** (esterno). Ruoli aggiuntivi: **Organizzatore** (derivato: chi ha proposto un'attività), **Responsabile GA** (più persone), **Responsabile sito** (tutto). I permessi di una persona sono l'**unione** di tutti i suoi ruoli. Il tipo di utente non si sceglie: gli allievi si registrano con ID + codice generale (ruolo Allievo), docenti e relatori entrano solo con un **link d'invito** creato dal Responsabile sito, che porta già il ruolo giusto (Docente o Relatore). La Direzione non ha un ruolo nel sito.

## 4. User Stories

Ogni storia è piccola (una sessione di lavoro). Le fasi indicano l'ordine di consegna.

### Fase 1 — Fondamenta

### US-001: Scheletro del progetto

**Description:** As a developer, I need a working project skeleton so that all other stories build on it.

**Acceptance Criteria:**

- [ ] Progetto Node.js + TypeScript con un container Docker per l'app e uno per PostgreSQL (`docker compose up` avvia tutto)
- [ ] Sistema di migrazioni del database che parte da zero
- [ ] Database di test separato (mai quello di produzione) e comando unico `npm test`
- [ ] Pagina `/` risponde 200
- [ ] Typecheck/lint passes

### US-002: Schema utenti, ruoli e anni scolastici

**Description:** As a developer, I need the base tables so that every record belongs to a school year and users can have several roles.

**Acceptance Criteria:**

- [ ] Tabelle: `school_years`, `users`, `roles`, `user_roles` (molti-a-molti), con ruoli iniziali: allievo, docente, relatore, resp_ga, resp_sito
- [ ] Esattamente un anno scolastico marcato come "corrente"
- [ ] Seed: anno 2026-2027 e un utente Responsabile sito
- [ ] Test: due ruoli assegnati allo stesso utente vengono entrambi restituiti
- [ ] Typecheck passes

### US-003: Invio e-mail (solo codici)

**Description:** As a developer, I need a mail module so that the site can send exactly two kinds of mail: personal code and password recovery.

**Acceptance Criteria:**

- [ ] Invio via SMTP con credenziali nelle variabili d'ambiente (nessuna credenziale nel codice)
- [ ] Il modulo espone solo `sendPersonalCode` e `sendPasswordReset`
- [ ] In sviluppo/test le mail vanno su un trasporto finto che le salva (nessun invio reale)
- [ ] Errore SMTP: l'azione chiamante riceve un errore chiaro e nessun codice resta valido senza essere stato inviato
- [ ] Typecheck passes

### US-004: Import elenco ID allievi e codice generale

**Description:** As Responsabile sito, I want to upload the list of valid student IDs and set the general code so that only real students can register.

**Acceptance Criteria:**

- [ ] Pagina admin con caricamento CSV (una riga per ID, es. `ssl586@studenti.edu.ti.ch`)
- [ ] ID duplicati ignorati; riga non valida segnalata con numero di riga
- [ ] Campo per impostare/cambiare il codice generale (salvato hashato)
- [ ] L'elenco è legato all'anno scolastico corrente
- [ ] Accessibile solo al Responsabile sito
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Registrazione, passo 1 (ID + codice generale)

**Description:** As a new student, I want to enter my ID, the general code, my name, surname and class so that I receive a personal code by e-mail.

**Acceptance Criteria:**

- [ ] Campi: ID, codice generale, nome, cognome, classe (nessuna scelta del tipo: chi usa questa pagina è un Allievo)
- [ ] ID non presente nell'elenco o codice generale errato: messaggio d'errore generico, nessun dettaglio su quale dei due è sbagliato
- [ ] Se valido: viene generato un codice personale casuale, salvato hashato con scadenza di 24 ore, e inviato all'indirizzo ID via e-mail
- [ ] Un ID già registrato riceve il messaggio "account già esistente, usa il recupero password"
- [ ] Limite di 5 tentativi per ora per ID e per IP
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Registrazione, passo 2 (codice personale + password)

**Description:** As a new user, I want to enter my personal code and choose a password so that my account becomes active.

**Acceptance Criteria:**

- [ ] Il codice personale corretto e non scaduto permette di scegliere la password (minimo 10 caratteri, due campi uguali)
- [ ] Password salvata con hash lento (argon2 o bcrypt), mai in chiaro nei log
- [ ] Codice sbagliato/scaduto: errore e possibilità di richiedere un nuovo codice
- [ ] Ruolo assegnato: Allievo
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-007: Login e logout

**Description:** As a user, I want to log in with ID and password so that I can use the site.

**Acceptance Criteria:**

- [ ] Login con ID + password, sessione in cookie `HttpOnly`, `Secure`, `SameSite=Lax`
- [ ] Credenziali errate: messaggio generico; blocco temporaneo dopo 5 tentativi falliti
- [ ] Logout termina la sessione sul server
- [ ] Pagine protette reindirizzano al login se non autenticati
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-008: Recupero password

**Description:** As a user who forgot the password, I want to reset it with a code sent by e-mail.

**Acceptance Criteria:**

- [ ] Pagina "Recupero password": inserisci ID, ricevi un codice via e-mail (risposta uguale anche se l'ID non esiste)
- [ ] Codice monouso con scadenza di 30 minuti; con il codice si sceglie la nuova password
- [ ] Dopo il reset le sessioni precedenti dell'utente vengono chiuse
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-009: Controllo dei permessi

**Description:** As a developer, I need one permission check so that every page and action obeys the permission matrix.

**Acceptance Criteria:**

- [ ] Una sola funzione `can(user, azione)` calcola l'unione dei permessi di tutti i ruoli dell'utente
- [ ] Le azioni riflettono `Matrice_Permessi_BOZZA.md` (sezioni GA e amministrazione)
- [ ] Il Responsabile sito può eseguire ogni azione
- [ ] Accesso negato: HTTP 403 (API) o pagina "non autorizzato"
- [ ] Test automatici: per ogni ruolo, almeno un'azione consentita e una negata; utente con due ruoli ottiene l'unione
- [ ] Typecheck passes

### US-010: Layout e menu per ruolo

**Description:** As a user, I want a menu that shows only the pages I can use.

**Acceptance Criteria:**

- [ ] Intestazione con nome del sito e anno scolastico corrente
- [ ] Menu che va a capo su più righe (niente scorrimento laterale)
- [ ] Le voci dipendono da `can()` (es. "Gestione GA" solo con Responsabile GA)
- [ ] Tema chiaro/scuro automatico, usabile a 400px di larghezza
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-011: Utenti e ruoli (admin)

**Description:** As Responsabile sito, I want to assign roles so that people get the right access.

**Acceptance Criteria:**

- [ ] Elenco utenti con ricerca per nome/ID e ruoli attuali
- [ ] Aggiungere/togliere ruoli (anche più di uno per utente), incluso Responsabile GA
- [ ] Non si può togliere l'ultimo Responsabile sito
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-012: Invito di docenti e relatori

**Description:** As Responsabile sito, I want to invite teachers and external speakers with a link so that they register with the right role without choosing it.

**Acceptance Criteria:**

- [ ] Il Responsabile crea un invito scegliendo il tipo (Docente o Relatore), nome ed e-mail, e ottiene un link monouso con scadenza di 14 giorni da copiare (il sito non invia la mail)
- [ ] Il link porta a una registrazione senza ID dell'elenco e senza codice generale, con scelta della password
- [ ] L'utente creato ha subito il ruolo del tipo scelto (Docente o Relatore), già confermato; nessuna scelta del tipo e nessun campo classe
- [ ] Un docente usa la sua e-mail come ID, un relatore l'e-mail dell'invito
- [ ] Link scaduto o già usato: messaggio chiaro
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-013: Impostazioni (anno, date, blocchi orari)

**Description:** As Responsabile sito, I want to set the school year, GA dates and time blocks so that the site follows the real calendar.

**Acceptance Criteria:**

- [ ] Creare un nuovo anno scolastico e sceglierlo come corrente
- [ ] Elenco di blocchi orari modificabili (nome, inizio, fine) e date delle GA (anche "da definire")
- [ ] Modifica di un blocco aggiorna subito tutte le pagine che lo mostrano
- [ ] Valori iniziali: 8:30–10:00, 10:15–11:45, 12:45–14:15, 14:30–16:00 (modificabili)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### Fase 2 — Attività GA

### US-014: Schema attività GA

**Description:** As a developer, I need the activity tables so that activities, rooms and enrollments are stored per school year.

**Acceptance Criteria:**

- [ ] Tabelle: `rooms`, `activities` (titolo, descrizione, organizzatore, contatto, aula, giorno, blocco/i, min, max, stato: proposta/approvata/rifiutata, anno), `activity_blocks`, `enrollments`
- [ ] Vincolo del database: un utente ha al massimo una iscrizione per blocco e giorno
- [ ] Ogni attività e iscrizione ha `school_year_id`
- [ ] Migrazione applicata sul database di test
- [ ] Typecheck passes

### US-015: Elenco attività con filtri

**Description:** As a logged-in user, I want to browse all approved activities and filter them so that I find what interests me.

**Acceptance Criteria:**

- [ ] Mostra solo attività approvate dell'anno corrente
- [ ] Filtri: blocco/orario, aula, tipo di organizzatore (allievo/docente/relatore), ricerca testuale su titolo, descrizione e persona
- [ ] Ogni scheda mostra titolo, descrizione, blocco, aula, organizzatore e posti liberi con barra
- [ ] Attività piena: indicata "Posti esauriti"
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-016: Posti liberi in tempo reale

**Description:** As a student, I want to see free seats update live so that I don't pick a full activity.

**Acceptance Criteria:**

- [ ] Quando un'iscrizione cambia, tutte le pagine aperte con l'elenco si aggiornano entro 2 secondi senza ricaricare (SSE con Postgres LISTEN/NOTIFY)
- [ ] Se la connessione cade, la pagina si riconnette da sola
- [ ] Test: due client aperti, iscrizione da uno, l'altro vede il numero cambiare
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-017: Proponi un'attività

**Description:** As an organizer (student, teacher or speaker), I want to propose an activity so that it can be approved and offered.

**Acceptance Criteria:**

- [ ] Modulo con: nome, organizzatore (precompilato), breve spiegazione, telefono (e-mail già nota), aula/spazio preferito con le aule libere indicate, uno o più blocchi, giorno, minimo e massimo di allievi
- [ ] Controllo: minimo ≤ massimo, almeno un blocco, campi obbligatori compilati
- [ ] Dopo l'invio l'attività è in stato "proposta" e compare nella lista "da approvare" del Responsabile GA
- [ ] Una proposta non è visibile agli altri allievi finché non è approvata
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-018: Approvazione attività

**Description:** As Responsabile GA, I want to approve or reject proposals so that only good activities are published.

**Acceptance Criteria:**

- [ ] Lista "da approvare" con dettagli di ogni proposta
- [ ] Azioni Approva / Rifiuta (con motivo opzionale); l'approvazione la rende visibile nell'elenco
- [ ] Il Responsabile GA può modificare una proposta prima di approvarla
- [ ] Il proponente vede lo stato della sua proposta nella pagina "La mia attività"
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-019: La mia attività

**Description:** As an organizer, I want to manage my own activity so that I can update it and see who joins.

**Acceptance Criteria:**

- [ ] Visibile solo a chi ha proposto almeno un'attività, e solo per le proprie
- [ ] Modifica di descrizione e max partecipanti (il massimo non scende sotto gli iscritti attuali)
- [ ] Elenco iscritti con nome e classe
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### Fase 3 — Iscrizioni

### US-020: Iscrizione e annullamento

**Description:** As a student or teacher, I want to join and leave an activity so that I build my own program.

**Acceptance Criteria:**

- [ ] Pulsante "Iscriviti" sulle schede, "Annulla iscrizione" se già iscritto
- [ ] Rifiutata con messaggio chiaro se: attività piena, già iscritto a un'altra attività nello stesso blocco/giorno, iscrizioni chiuse
- [ ] Due iscrizioni simultanee all'ultimo posto: una sola riesce (controllo nel database, test automatico)
- [ ] Il posto liberato dall'annullamento torna subito disponibile
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-021: Il mio programma

**Description:** As a participant, I want to see my day by time block so that I know where to be.

**Acceptance Criteria:**

- [ ] Un riquadro per blocco con attività, aula e organizzatore
- [ ] I blocchi senza scelta sono evidenziati con "Scegli un'attività"
- [ ] Dopo l'assegnazione casuale mostra anche quali attività sono state assegnate
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-022: Finestre di iscrizione

**Description:** As Responsabile GA, I want to control when enrollment is open so that organizers go first.

**Acceptance Criteria:**

- [ ] Tre stati impostabili a mano: "Solo organizzatori", "Aperte a tutti", "Chiuse"
- [ ] Con "Solo organizzatori" si iscrivono solo utenti con almeno un'attività approvata; gli altri vedono un avviso
- [ ] Con "Chiuse" nessuno si iscrive né annulla (tranne il Responsabile GA)
- [ ] Lo stato attuale è visibile in Home
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-023: Assegnazione casuale dei non iscritti

**Description:** As Responsabile GA, I want to assign students who didn't enroll so that nobody is left without an activity.

**Acceptance Criteria:**

- [ ] Pulsante "Assegna a caso" disponibile quando le iscrizioni sono chiuse
- [ ] Per ogni allievo (dall'elenco ID registrato) e per ogni blocco senza iscrizione assegna un'attività con posti liberi e senza conflitti
- [ ] Anteprima con il numero di allievi da assegnare e i posti disponibili prima di confermare
- [ ] Se i posti non bastano: elenco degli allievi non assegnabili, nessun assegnamento parziale silenzioso
- [ ] Le assegnazioni sono segnate come "assegnate" e annullabili in blocco
- [ ] Test con dati di esempio: nessun superamento dei posti massimi, nessun doppio impegno
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### Fase 4 — Presenze e gestione

### US-024: Segnare le presenze

**Description:** As an organizer, teacher or speaker, I want to mark who is present so that attendance is recorded.

**Acceptance Criteria:**

- [ ] Nella pagina dell'attività, per ogni iscritto una casella presente/assente
- [ ] Chi organizza (anche se allievo) segna solo la sua attività; il Responsabile GA le segna tutte
- [ ] Le presenze si possono modificare fino alla chiusura dell'anno scolastico
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-025: Presenze mancanti

**Description:** As Responsabile GA, I want to see which activities have no attendance recorded so that I can chase them.

**Acceptance Criteria:**

- [ ] Riquadro in "Gestione GA" con le attività la cui fine è passata e senza presenze segnate, con nome e contatto dell'organizzatore
- [ ] Nessuna mail automatica (solo visualizzazione nel sito)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-026: Gestione GA

**Description:** As Responsabile GA, I want one page with all activities and participants so that I can run the days.

**Acceptance Criteria:**

- [ ] Tabella di tutte le attività con blocco, aula, iscritti/max, organizzatore
- [ ] Dettaglio con lista iscritti e presenze
- [ ] Segnalazione delle attività sotto il minimo di partecipanti
- [ ] Vista anagrafica relatori (nome, contatto, attività) e docenti
- [ ] Accessibile solo a Responsabile GA e Responsabile sito
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-027: Esportazioni

**Description:** As Responsabile GA, I want to export lists so that I can print or share them.

**Acceptance Criteria:**

- [ ] Export CSV e XLSX di: attività, allievi (con classe e programma), relatori, docenti, presenze
- [ ] Ogni export può essere filtrato (tutte le attività, alcune scelte, solo quelle di allievi, ecc.)
- [ ] Il file contiene solo dati dell'anno scolastico scelto
- [ ] Il file si apre correttamente in Excel con gli accenti (UTF-8)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### Fase 5 — Anni scolastici e Home

### US-028: Separazione per anno e archivio

**Description:** As Responsabile sito, I want old years to stay stored but hidden so that data never mixes.

**Acceptance Criteria:**

- [ ] Tutte le pagine mostrano solo l'anno corrente
- [ ] Il Responsabile sito e il Responsabile GA possono consultare un anno passato in sola lettura
- [ ] Cambiando l'anno corrente, le attività e le iscrizioni del vecchio anno non sono più visibili agli utenti normali
- [ ] Test: dati creati in due anni diversi non compaiono mai insieme
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-029: Riproponi attività, relatori e docenti

**Description:** As an organizer, I want to re-propose last year's activity so that I don't have to rewrite it.

**Acceptance Criteria:**

- [ ] Nella pagina "Proponi attività" elenco delle mie attività dell'anno precedente con pulsante "Riproponi"
- [ ] Riproponi copia i dati in una nuova proposta dell'anno corrente (stato "proposta"), modificabile prima dell'invio
- [ ] Il Responsabile GA può riproporre relatori e docenti dell'anno precedente come contatti dell'anno corrente
- [ ] L'attività originale resta invariata
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-030: Home

**Description:** As a user, I want a Home that tells me what to do now.

**Acceptance Criteria:**

- [ ] Mostra date GA (o "da definire"), stato delle iscrizioni, numero di attività scelte con link al programma, link alle attività
- [ ] Spiega in tre righe come funzionano precedenza e assegnazione casuale
- [ ] Sezione sondaggi/bacheca assente (arriveranno in seguito)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## 5. Requisiti funzionali

- FR-1: Solo chi è nell'elenco ID (allievi) e conosce il codice generale, oppure chi ha un link d'invito (docenti e relatori), può registrarsi; il tipo di utente è deciso da questo canale, mai scelto a mano.
- FR-2: Il codice personale è inviato all'indirizzo ID per e-mail; la password si sceglie solo dopo averlo inserito.
- FR-3: Le password e i codici sono salvati solo come hash.
- FR-4: Il sito invia mail solo per codice personale e recupero password.
- FR-5: Ogni utente ha un ruolo base; gli altri ruoli aggiungono permessi; i permessi sono l'unione.
- FR-6: Ogni attività, iscrizione e presenza appartiene a un anno scolastico e gli anni non si mischiano.
- FR-7: Un utente può avere una sola attività per blocco e giorno, imposto dal database.
- FR-8: Le iscrizioni hanno tre stati (solo organizzatori, tutti, chiuse) impostati a mano.
- FR-9: I posti liberi si aggiornano in tempo reale su tutte le pagine aperte.
- FR-10: L'assegnazione casuale non supera mai il massimo e non crea doppi impegni.
- FR-11: Solo il Responsabile GA approva le attività; la Direzione approva fuori dal sito.
- FR-12: Blocchi orari, date e anno corrente sono modificabili dal sito.
- FR-13: Esportazioni in CSV e XLSX filtrabili.

## 6. Non-goals (fuori ambito)

- Assemblea paritetica, Eco Comitato, sondaggi, bacheca, proposte anonime, festa di fine anno (PRD successivi).
- Chat di qualunque tipo.
- Invio automatico di mail diverse da codice personale e recupero password (promemoria, avvisi, mail ai relatori: le manda Claude via Claude in Chrome su richiesta).
- Lettura automatica delle caselle Outlook (GA, Eco, Assemblea) e estrazione dati dalle mail.
- Torneo di calcio (fase successiva) e gestione di info point e buvette.
- Pagamenti, API a pagamento, intelligenza artificiale esterna.

## 7. Design

- Seguire la bozza cliccabile (`Bozza_Sito/index.html`): schede per attività, barra dei posti, menu a capo su più righe, tema chiaro/scuro.
- Italiano, usabile da telefono (400px) e senza scorrimento orizzontale della pagina.
- Il nome del sito è provvisorio e deve stare in un solo punto di configurazione.

## 8. Considerazioni tecniche

- Node.js + TypeScript, PostgreSQL, container Docker. L'hosting non è deciso (Infomaniak è l'ipotesi): il progetto deve girare su qualunque server che accetta Docker, con tutta la configurazione (database, SMTP, indirizzo del sito) nelle variabili d'ambiente e nessun riferimento a un fornitore nel codice. Non va bene un hosting condiviso senza Docker/Node.
- Tempo reale con SSE e Postgres LISTEN/NOTIFY.
- Mail: SMTP verso un account Outlook dedicato con password per app (limite giornaliero di invio da tenere presente con ~330 registrazioni).
- L'ID dell'allievo è il suo indirizzo e-mail scolastico (es. `ssl586@studenti.edu.ti.ch`).
- Test: usare sempre il database di test locale, mai quello di produzione.
- Privacy dei minorenni (nLPD): approvata e gestita dalla direzione; raccogliere solo i dati indicati in questo PRD.

## 9. Metriche di successo

- Un allievo completa registrazione e prima iscrizione in meno di 3 minuti.
- Zero iscrizioni oltre il massimo dei posti e zero doppi impegni nello stesso blocco.
- Il Responsabile GA ottiene la lista presenze di tutte le attività con un solo export.
- Nessun dato di un anno compare in un altro.

## 10. Domande aperte

- Date delle GA e blocchi orari definitivi (Yasser decide dopo le 17 del 15.10).
- Elenco ID allievi (Yasser lo fornisce più avanti).
- Indirizzi dei tre account Outlook e quale usare per l'invio dei codici.
- Nome definitivo del sito.
- Lettura delle mail ricevute dalle caselle (rimandata): serve davvero?
- Dove ospitare il sito (Infomaniak non confermato) e tipo di server: deve accettare Docker.
