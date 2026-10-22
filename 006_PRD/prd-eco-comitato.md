# PRD: Portale CPT Trevano — Eco Comitato e Spazio

## 1. Introduzione

Secondo PRD del portale (il primo è `prd-fondamenta-ga.md`: fondamenta, GA, tornei). Questo PRD copre tutto ciò che serve all'**Eco Comitato** del CPT Trevano per far vivere lo **Spazio** (l'aula del progetto Cittadinanza / Eco-Schools): governance, regolamento, turni dei gestori, attività ed eventi, iscrizioni, riunioni e verbali, sondaggi e piano d'azione.

Parte dalle bozze del coordinatore Luca Moscatelli (mail "mappa dei passi", `Regolamento_Spazio_BOZZA.docx`, `Organigramma_Rotazione_BOZZA.docx`) e dalle decisioni già prese (`CLAUDE.md`, `Matrice_Permessi_BOZZA.md`).

**Dipende dalle fondamenta** del primo PRD (US-001–013: scheletro, utenti e ruoli, registrazione, login, permessi, layout, anno scolastico, impostazioni). Non le ripete: le riusa. Il nome dello Spazio è provvisorio e sta in un solo punto di configurazione.

Autore e Responsabile sito: Yasser Oudabashi.

## 2. Obiettivi

- Lo Spazio ha un regolamento e un organigramma ufficiali, versionati e consultabili da tutti.
- I gestori di turno ruotano con un calendario chiaro e un registro di passaggio consegne al posto della carta.
- Allievi e docenti propongono attività, il Resp. Eco le approva, tutti vedono i giorni liberi e si iscrivono con posti in tempo reale.
- Ogni attività si valuta con un breve questionario; le attività pilota producono dati.
- Riunioni, verbali (I/C/D/E), compiti e scadenze stanno nel sito.
- Sondaggi a scenari concreti con restituzione dei risultati.
- Il sito tiene traccia dei documenti del piano d'azione Eco-Schools e rimanda alla piattaforma ufficiale.
- Nessuna API a pagamento; il sito vive senza Yasser.

## 3. Ruoli (dettagli in `Matrice_Permessi_BOZZA.md`)

I ruoli si sommano (unione dei permessi). Nuovi o precisati per l'Eco:

- **Allievo / Docente** (base): vedono lo Spazio, le attività, si iscrivono, propongono, rispondono ai sondaggi.
- **Organizzatore** (derivato): chi ha proposto un'attività approvata; gestisce solo le sue.
- **Membro Eco Comitato**: partecipa alle riunioni, vede verbali e compiti, può essere gestore o verbalista.
- **Gestore di turno**: 2–3 studenti a rotazione; apre/chiude lo Spazio, compila il registro di passaggio, segnala anomalie. Il ruolo vale solo nel periodo del turno.
- **Responsabile Eco** con tre sotto-ruoli già decisi: **Aula** (Lorenzo: calendario aperta/chiusa, orari), **Attività** (Ramon: approva e gestisce le attività), **Comunicazione** (Yasser: docenti/direzione, sondaggi e restituzione). Chi ha più sotto-ruoli li somma.
- **Referente adulto** (coordinatore Eco-Schools): sola lettura di tutto l'Eco (supervisione, non gestione); può commentare i verbali.
- **Responsabile sito**: tutto.
- La Direzione non ha un ruolo nel sito.

## 4. User Stories

### Fase 1 — Spazio e governance

### ECO-001: Schema dati dell'Eco Comitato

**Description:** As a developer, I need the Eco Comitato data model so that all following pages share one structure per school year.

**Acceptance Criteria:**

- [ ] Tabelle: spazio (nome, finalità, stato), periodi di apertura, versioni del regolamento, turni, registro di passaggio, segnalazioni, attività, iscrizioni, materiali, valutazioni, riunioni, presenze, righe di verbale, file, sondaggi, domande, risposte, documenti del piano d'azione
- [ ] Ogni riga appartiene a un anno scolastico (FR-6 del PRD fondamenta)
- [ ] Migrazioni ripetibili sul database di test locale
- [ ] Typecheck passes

### ECO-002: Ruoli Eco

**Description:** As Responsabile sito, I want to assign Eco roles so that each person sees and does only what they should.

**Acceptance Criteria:**

- [ ] Ruoli assegnabili: Membro Eco, Resp. Eco (con spunta dei sotto-ruoli Aula / Attività / Comunicazione), Referente adulto
- [ ] Il ruolo Gestore di turno si assegna automaticamente dai turni (ECO-006) e vale solo nel periodo
- [ ] I permessi sono l'unione di tutti i ruoli della persona (nessun conflitto con Allievo o Organizzatore GA)
- [ ] Il Referente adulto vede tutto l'Eco in sola lettura
- [ ] Test: allievo + membro Eco + gestore di turno ha l'unione dei permessi
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-003: Pagina dello Spazio

**Description:** As a user, I want a page about the Space so that I know what it is, when it is open and what the rules are.

**Acceptance Criteria:**

- [ ] Mostra nome (da configurazione), finalità, stato adesso (aperto / chiuso / chiuso per evento), orari, gestori di turno attuali
- [ ] Link al regolamento in vigore, all'organigramma e alla piattaforma Eco-Schools (app.ecoschools-ch.org)
- [ ] Visibile a tutti gli utenti loggati
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-004: Calendario dell'aula

**Description:** As Responsabile Eco (Aula), I want to open and close the Space and set hours by hand so that the calendar always reflects reality.

**Acceptance Criteria:**

- [ ] Apertura/chiusura manuale con un clic (stato attuale) e orari per giorno della settimana
- [ ] Periodi eccezionali (vacanze, chiusure) con data inizio/fine e motivo
- [ ] La modifica si vede subito in ECO-003 e nel calendario delle attività
- [ ] Accessibile al sotto-ruolo Aula e al Resp. sito
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-005: Regolamento d'uso versionato

**Description:** As an Eco Comitato member, I want the regulation (9 articles) in the site, with versions, so that everyone reads the current one and changes are traceable.

**Acceptance Criteria:**

- [ ] Articoli numerati con titolo e testo; il testo iniziale è l'attuale bozza in nove articoli
- [ ] Stati: `bozza` → `approvato`; l'approvazione registra la data e il testo dell'esito (es. "approvato a maggioranza")
- [ ] Modificare un regolamento approvato crea una nuova bozza; la versione approvata resta in vigore finché la nuova non è approvata
- [ ] Storico delle versioni consultabile, con confronto fra due versioni
- [ ] Gli utenti normali vedono solo la versione approvata; i membri Eco vedono anche la bozza e possono lasciare osservazioni per articolo
- [ ] I parametri aperti della bozza (es. giorni minimi di anticipo per proporre un evento) sono campi configurabili e usati da ECO-009
- [ ] Modifica riservata a Resp. Eco e Resp. sito
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-006: Organigramma e piano di rotazione

**Description:** As Responsabile Eco, I want to publish the three-level organization and the shift calendar so that everybody knows who manages the Space.

**Acceptance Criteria:**

- [ ] Pagina Organigramma: tre livelli (gestori di turno, Eco Comitato, referente adulto) con persone e funzioni, ruoli e responsabilità dei gestori
- [ ] Tabella turni: periodo (inizio–fine), Gestore 1, Gestore 2, Sostituto, scelti tra i membri Eco
- [ ] Durata standard del turno impostabile (2 settimane / 1 mese) e generazione automatica dei periodi per un semestre
- [ ] Una persona non è in due turni sovrapposti come gestore; avviso (non blocco) se manca il sostituto
- [ ] Il turno corrente è visibile in ECO-003 e in Home
- [ ] Il Resp. Eco può sostituire un gestore a turno in corso, con nota
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-007: Registro di passaggio consegne

**Description:** As a duty manager, I want to log the state of the Space and hand over to the next manager so that damage and open issues are never lost.

**Acceptance Criteria:**

- [ ] Inizio e fine turno: scheda con stato arredi, materiale, pulizia (ok / problema + nota)
- [ ] Passaggio di consegne in quattro passi spuntabili: ispezione congiunta, registro compilato, consegna chiavi/badge, comunicazione avvenuta
- [ ] Il registro porta le segnalazioni ancora aperte al gestore subentrante
- [ ] Il passaggio si chiude solo con le spunte dei due gestori (uscente e subentrante)
- [ ] Storico del registro filtrabile per data e gestore
- [ ] Solo gestore di turno, Resp. Eco e Resp. sito scrivono; Referente adulto legge
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-008: Segnalazioni e sospensione dell'accesso

**Description:** As a duty manager or Resp. Eco, I want to report problems and, if needed, suspend someone so that the regulation (art. 6–8) can be applied.

**Acceptance Criteria:**

- [ ] Segnalazione di tipo `danno`, `anomalia` o `violazione`: data, descrizione, persona coinvolta (facoltativa), stato `aperta` → `in valutazione` → `chiusa` con esito
- [ ] Le segnalazioni su una persona sono visibili solo a Resp. Eco, Resp. sito e Referente adulto (non ai membri semplici)
- [ ] Sospensione temporanea dell'accesso (data fine e motivo) decisa dal Resp. Eco; la persona sospesa non può iscriversi a nuove attività dello Spazio e vede il motivo e la data fine
- [ ] Le infrazioni gravi si possono marcare "inoltrata alla direzione" (la procedura disciplinare resta fuori dal sito)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### Fase 2 — Attività ed eventi

### ECO-009: Proporre un'attività o evento

**Description:** As a student or teacher, I want to propose an event for the Space so that the Eco Comitato can approve it.

**Acceptance Criteria:**

- [ ] Campi: titolo, descrizione, tipo (dibattito, workshop, proiezione, ospite esterno, sensibilizzazione, altro), data, orario, responsabile (default: il proponente), partecipanti previsti, tetto massimo, materiali richiesti, flag `pilota`
- [ ] Rifiutata se la data è più vicina dei giorni minimi di anticipo (parametro del regolamento, ECO-005) o cade in un periodo di chiusura (ECO-004)
- [ ] Avviso se un'altra attività è già approvata nello stesso orario; nessun doppio evento approvato nello stesso orario
- [ ] Le richieste di materiali creano righe nella lista materiali (ECO-013)
- [ ] Stato iniziale `da approvare`; il proponente può modificare o ritirare finché non è approvata
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-010: Approvazione delle attività

**Description:** As Responsabile Eco (Attività), I want to approve, modify or reject proposals so that only valid events are published.

**Acceptance Criteria:**

- [ ] Elenco `da approvare` con dettagli e conflitti evidenziati
- [ ] Azioni: approva, approva con modifiche, respingi; la motivazione è obbligatoria in caso di modifica o rifiuto (art. 5) ed è visibile al proponente
- [ ] Le attività approvate compaiono per tutti; chi propone diventa Organizzatore per quell'attività
- [ ] Storico delle decisioni (chi, quando, motivo)
- [ ] Solo sotto-ruolo Attività e Resp. sito
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-011: Attività, giorni liberi e iscrizione

**Description:** As a student or teacher, I want to see upcoming activities and free days and join one so that I can take part.

**Acceptance Criteria:**

- [ ] Elenco e calendario delle attività approvate con filtri (tipo, data, pilota) e giorni liberi dell'aula
- [ ] Iscrizione e annullamento con tetto massimo; posti liberi in tempo reale su tutte le pagine aperte (come FR-9)
- [ ] Zero iscrizioni oltre il tetto (test con iscrizioni concorrenti)
- [ ] Le persone sospese (ECO-008) non si iscrivono
- [ ] Un utente non si iscrive a un'attività Eco che coincide con una sua attività GA approvata nello stesso blocco (avviso, non blocco)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-012: La mia attività

**Description:** As an organizer, I want to manage my activity so that I know who is coming.

**Acceptance Criteria:**

- [ ] Modifica descrizione e tetto (non sotto il numero di iscritti)
- [ ] Elenco iscritti con nome e classe, segnare le presenze, export CSV
- [ ] Accessibile solo all'Organizzatore di quella attività, al Resp. Eco e al Resp. sito
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-013: Lista materiali

**Description:** As Responsabile Eco, I want a list of requested materials so that I can prepare what each event needs.

**Acceptance Criteria:**

- [ ] Righe: materiale, quantità, attività collegata, richiedente, stato (`richiesto`, `disponibile`, `non disponibile`) e nota
- [ ] Filtri per attività, stato e data dell'evento
- [ ] Aggiunta e modifica da Resp. Eco; il richiedente vede lo stato
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-014: Valutazione dopo l'attività

**Description:** As a participant, I want to fill a short feedback form so that the Eco Comitato measures participation and satisfaction.

**Acceptance Criteria:**

- [ ] Dopo la data dell'attività, ai soli iscritti compare il questionario (soddisfazione 1–5, "lo rifaresti?", commento facoltativo)
- [ ] Una sola risposta per persona per attività; le risposte sono anonime per l'Organizzatore e visibili con il nome solo al Resp. sito
- [ ] Report per attività: iscritti, presenti, media della soddisfazione, commenti; confronto fra attività pilota
- [ ] Export CSV del report
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### Fase 3 — Riunioni e verbali

### ECO-015: Riunioni e presenze

**Description:** As Responsabile Eco, I want numbered meetings with agenda and attendance so that the Committee's work is recorded.

**Acceptance Criteria:**

- [ ] Riunione numerata automaticamente per anno (1, 2, 3…), con data, ora, luogo, ordine del giorno
- [ ] Presenze, scusati e assenti divisi in docenti / allievi / direzione, segnabili dal verbalista o dal Resp. Eco
- [ ] I membri vedono le prossime riunioni in Home
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-016: Verbale con righe I/C/D/E

**Description:** As the minute-taker, I want to write the minutes as typed lines so that decisions and tasks are clear.

**Acceptance Criteria:**

- [ ] Righe con sigla I (Informazione), C (Compito), D (Decisione), E (Elaborazione), testo, responsabile e termine (per i compiti)
- [ ] Verbalista a rotazione: il sito propone il prossimo membro dalla rotazione; scelta modificabile
- [ ] Ruoli numerati per membro in ogni riunione (assegnabili e modificabili)
- [ ] Esporta il verbale in docx o stampa pulita
- [ ] Il Referente adulto può commentare le righe
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-017: Compiti e scadenze

**Description:** As a member, I want to see my tasks and deadlines so that nothing is forgotten.

**Acceptance Criteria:**

- [ ] Ogni riga C del verbale diventa un compito con responsabile e termine
- [ ] "I miei compiti" in Home e nel menu: aperti, in scadenza, scaduti; segna come fatto
- [ ] Vista complessiva del Resp. Eco filtrabile per persona e riunione
- [ ] Il sito non invia mail di promemoria (FR-4 del PRD fondamenta)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-018: File delle riunioni

**Description:** As Responsabile Eco, I want to share documents with the members so that drafts and minutes live in one place.

**Acceptance Criteria:**

- [ ] Caricamento di file (docx, xlsx, pdf, immagini) collegati a una riunione o a un documento del piano d'azione; dimensione massima configurabile
- [ ] Visibili ai membri Eco e al Referente adulto; scaricabili
- [ ] File salvati su volume configurabile (nessun servizio esterno a pagamento)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### Fase 4 — Sondaggi e piano d'azione

### ECO-019: Sondaggi a scenari

**Description:** As Responsabile Eco (Comunicazione), I want to create structured surveys so that I get concrete, usable answers.

**Acceptance Criteria:**

- [ ] Domande a scelta singola o multipla, con opzione "altro, specificare" e domanda libera facoltativa
- [ ] Testo di contesto per domanda (scenario) e scadenza del sondaggio
- [ ] Stato `bozza` → `aperto` → `chiuso`; il sondaggio in bozza è visibile solo ai responsabili
- [ ] Risponde ogni utente registrato una sola volta; risposte anonime (il sito non collega persona e risposta nei risultati)
- [ ] Duplicazione di un sondaggio dell'anno precedente
- [ ] Sondaggio iniziale precaricato dalla bozza di Marco Del Core (scenari: un evento al mese tra dibattito, workshop, proiezione, ospite esterno, altro)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-020: Risultati e restituzione

**Description:** As Responsabile Eco, I want live statistics and a public results page so that results can be shown to the school community.

**Acceptance Criteria:**

- [ ] Per domanda: numero di risposte, percentuali, grafico a barre, elenco delle risposte "altro"
- [ ] Filtro per classe/indirizzo se la persona ha scelto di indicarlo (altrimenti solo totali)
- [ ] Pagina risultati pubblicabile a tutti dopo la chiusura, con un clic
- [ ] Export CSV/XLSX
- [ ] Risultati aggiornati in tempo reale mentre il sondaggio è aperto (solo per i responsabili)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-021: Piano d'azione Eco-Schools

**Description:** As Responsabile Eco, I want to track the documents and tasks of the action plan so that the platform fields are filled on time.

**Acceptance Criteria:**

- [ ] Elenco documenti: Regolamento, Organigramma, Sondaggio, Piano delle attività pilota, Documento di comunicazione, Piano d'azione sulla piattaforma
- [ ] Per ogni voce: responsabile, scadenza, stato (`da fare`, `in corso`, `consegnato`, `inserito in piattaforma`), link al file (ECO-018) o alla pagina del sito (es. regolamento approvato, risultati sondaggio)
- [ ] Scadenze globali visibili in cima: check-point, avvio e fine dell'attuazione (date impostabili)
- [ ] Link alla piattaforma app.ecoschools-ch.org; il sito non scrive sulla piattaforma
- [ ] Le 7 fasi Eco-Schools restano gestite sulla piattaforma (non-goal)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### ECO-022: Home dell'Eco Comitato

**Description:** As an Eco member, I want a home that shows what to do now.

**Acceptance Criteria:**

- [ ] Stato dello Spazio e gestori di turno, prossime attività e riunioni, i miei compiti, sondaggi aperti, attività da approvare (solo per chi approva)
- [ ] Per allievi e docenti non membri: stato dello Spazio, prossime attività, sondaggi aperti, link al regolamento
- [ ] Sezione bacheca/proposte anonime assente (ultima fase)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## 5. Requisiti funzionali

- FR-E1: Ogni dato Eco appartiene a un anno scolastico e gli anni non si mischiano.
- FR-E2: Il regolamento approvato non si modifica: ogni cambio è una nuova versione con data di approvazione.
- FR-E3: I gestori di turno sono membri Eco; il ruolo vale solo per il periodo del turno.
- FR-E4: Nessuna attività approvata si sovrappone a un'altra nello stesso orario né a un periodo di chiusura dell'aula.
- FR-E5: I posti non superano mai il tetto; i posti liberi si aggiornano in tempo reale.
- FR-E6: Le decisioni di approvazione hanno sempre un motivo se sono modifiche o rifiuti.
- FR-E7: I sondaggi e le valutazioni sono anonimi nei risultati; una risposta per persona.
- FR-E8: Segnalazioni su persone visibili solo a Resp. Eco, Resp. sito e Referente adulto.
- FR-E9: Il sito non invia mail oltre codice personale e recupero password.

## 6. Non-goals (fuori ambito)

- Chat di qualunque tipo.
- Bacheca con avvisi, commenti e proposte anonime (ultima fase).
- Le 7 fasi Eco-Schools: restano su app.ecoschools-ch.org; qui solo link e tracciamento dei documenti.
- Locandina, reel Instagram e testi per il sito della scuola (restano fuori dal sito; il sito tiene solo lo stato del documento).
- Procedura disciplinare dell'istituto.
- Prenotazione dello Spazio per gruppi esterni all'Eco Comitato oltre al flusso di ECO-009.
- Gestione di chiavi e badge reali (solo la spunta nel passaggio di consegne).
- Pagamenti, API a pagamento, intelligenza artificiale esterna.

## 7. Design

- Seguire lo stile della bozza cliccabile del PRD fondamenta (schede, barra dei posti, tema chiaro/scuro).
- Italiano, usabile da telefono (400px), senza scorrimento orizzontale della pagina.
- Menu Eco separato dal menu GA; i ruoli decidono quali voci compaiono.

## 8. Considerazioni tecniche

- Stack e vincoli identici al PRD fondamenta (Node.js + TypeScript, PostgreSQL, Docker, SSE con LISTEN/NOTIFY, configurazione in variabili d'ambiente).
- File caricati su volume Docker; limite di dimensione configurabile.
- Test sempre sul database di test locale, mai su quello di produzione.
- Privacy dei minorenni (nLPD): approvata e gestita dalla direzione; i sondaggi non collegano persona e risposta; le segnalazioni sono limitate ai ruoli indicati.

## 9. Metriche di successo

- Regolamento e organigramma approvati e pubblicati nel sito entro la prima riunione utile dopo la presentazione.
- Una proposta di attività si inoltra in meno di 2 minuti e viene approvata o respinta con motivo.
- Zero iscrizioni oltre il tetto; zero attività approvate sovrapposte.
- Il passaggio di consegne di ogni turno è registrato.
- Il sondaggio iniziale raccoglie risposte da una parte significativa dei ~330 allievi (obiettivo da fissare con l'Eco Comitato).
- Ogni attività pilota ha un report di valutazione.

## 10. Domande aperte

- Nome definitivo dello Spazio (proposta di primavera: "Punto di svolta"; da ricontrollare chi ha proposto cosa).
- Numero di giorni minimi di anticipo per un evento (la bozza dice [X]) e durata dei turni (2 settimane o 1 mese).
- Come entrano Moscatelli e gli altri adulti: il Referente adulto vede tutto o solo i verbali?
- Prenotazione dello Spazio da parte di classi o docenti fuori dal flusso di proposta (decisione ancora aperta dal 08.10).
- Chi sono i gestori di turno del primo periodo e chi tiene il registro.
- Il sondaggio chiede classe/indirizzo (utile alle statistiche) o resta del tutto anonimo?
