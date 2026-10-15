# Analisi "EcoSpazio CPT" (artifact del Prof. Moscatelli) vs nostro sito

Analisi dell'08.10.2026 su https://claude.ai/artifact/EigPgZMk3Vth3rLBbiyQbD.
Copia dell'HTML in `ecospazio_backup.html` (stessa cartella).

## 0. Cos'è davvero

**È un mockup statico, non un sistema funzionante.** È un unico file HTML: i dati sono scritti nel codice (4 eventi, 3 post, 3 proposte, 6 membri). Non c'è database né login. Like, voti, prenotazioni e proposte mostrano solo un messaggio ("✓ Prenotazione inviata!") e si perdono al ricaricamento. La disponibilità dei giorni nel calendario è **casuale** (`Math.random()`).
→ Va preso come **esempio di UX e di funzioni desiderate dal docente**, non come architettura.

## 1. Cosa contiene

| Sezione | Contenuto | Cosa fa davvero |
|---|---|---|
| Home | banner "Lo spazio è degli studenti. Fallo vivere.", contatori (eventi settimana, proposte attive), 3 azioni rapide, prossimi eventi | eventi cliccabili → scheda con "Partecipo!" (finto) |
| Prenota | striscia 14 giorni (sab/dom chiuso), 6 fasce orarie, form (tipo attività, n. partecipanti max 30, note) | nessun salvataggio, fasce "Prenotato" fisse |
| Bacheca | filtri Tutti/Avvisi/Discussioni/Risorse, post con autore + ruolo, like, commenti, condividi | filtri non filtrano, commenti/condividi non fanno nulla |
| Proposte | elenco votabile (▲ + conteggio), autore + indirizzo, "Hai un'idea?" con opzione **anonima** | "Le più votate vengono discusse in assemblea" |
| Info | 7 fasi Eco-Schools con stato, membri del comitato con ruolo, documenti (Regolamento, Organigramma e rotazioni, Verbali) | "Leggi ›" non apre nulla |
| Navigazione | barra in basso a 5 tab, mobile-first, notifiche 🔔 e profilo 👤 | icone senza funzione |

**Ruoli che compaiono:** Referente Eco-Schools (docente), Gestore di turno (a rotazione), Comunicazione, Membro, account istituzionale "Eco Comitato" per comunicazioni ufficiali.

## 2. Problemi del mockup da non copiare

- **Fasce orarie diverse dalle nostre** (08:00-09:30, 09:45-11:15, ...). Le nostre: 8:30-10:00, 10:15-11:45, pranzo 11:45-12:45, 12:45-14:15, 14:30-16:00. Sul sito servirà **una sola tabella fasce** condivisa da tutto il sito.
- **Giorno della settimana scritto a mano e sbagliato**: il cineforum del 10.10.2026 è un sabato, il post dice "venerdì". Il giorno va calcolato dalla data.
- **Fasi Eco-Schools duplicate**: dal verbale dell'01.10.2026 risulta che le 7 fasi si gestiscono già sulla piattaforma ufficiale `app.ecoschools-ch.org` (ogni membro ha le credenziali). Noi **mettiamo solo un link**, senza rifare il tracciamento.
- **Voto senza regole**: non sono definiti il limite di un voto per persona né la soglia per portare una proposta in assemblea.
- **Anonimato**: deve essere anonimo per gli altri allievi ma tracciabile dall'admin (moderazione, minorenni, nLPD). **Deciso:** anonime per tutti tranne l'admin.
- **Prenotazioni senza conflitti**: servono il vincolo unico spazio + data + fascia nel DB e un'approvazione da parte del gestore di turno.

## 3. Cosa prendiamo (mappato sul nostro sito)

Legenda: ✅ prendiamo così · 🔄 prendiamo ma adattato · ➕ già nostro, il mockup lo conferma · ❌ non prendiamo

| Idea EcoSpazio | Decisione | Dove va nel nostro sito |
|---|---|---|
| Mobile-first, barra in basso, card, emoji, tono "lo spazio è vostro" | ✅ | UI di tutto il sito (gli allievi usano il telefono) |
| Home con contatori + azioni rapide + prossimi eventi | 🔄 | **Home unica** con riquadri per fase: GA (iscriviti, posti liberi), Assemblea (prossima seduta), Eco (prossima riunione + link a EcoSpazio). Contenuto diverso in base ai ruoli |
| Eventi con categoria e scheda di dettaglio | 🔄 | **Entità "Evento" unica**: attività GA, riunione Assemblea, riunione Eco. Stessi campi base (titolo, data, fascia, aula, organizzatore, max posti) |
| "Partecipo!" | 🔄 | = **iscrizione** delle GA (posti in tempo reale) |
| Prenotazione spazio con fasce | ⏸ | **Decidiamo poi.** Per ora resta su EcoSpazio. Se un giorno la portiamo noi: A-113 sulle **nostre fasce**, vincolo unico spazio+data+fascia |
| Bacheca con avvisi ufficiali / discussioni / risorse | 🔄 | **Bacheca unica** con canale per fase (GA / Assemblea / Eco). Pubblicano gli avvisi ufficiali solo i ruoli autorizzati. **Deciso: commenti sì**, con moderazione (segnala + elimina da admin/moderatori) |
| Proposte votabili, anche anonime | 🔄 | **Proposte unica** con destinazione: GA (proposta attività), Assemblea (punto all'ordine del giorno), Eco (punto per la riunione; le idee per lo spazio restano su EcoSpazio). Le più votate → bozza di OdG della prossima riunione |
| Membri con ruolo a rotazione | ➕ | Ruoli Eco numerati + verbalista a rotazione (CLAUDE.md). Servono **assegnazioni con data inizio/fine** (es. "Gestore di turno" a settimana) |
| Documenti (regolamento, organigramma, verbali) | 🔄 | Archivio per fase. I verbali sono **dati strutturati** (righe I/C/D/E, responsabile, scadenza), non solo file, e si possono esportare in docx/PDF |
| 7 fasi Eco-Schools | ❌ | solo link a app.ecoschools-ch.org |
| Like / condividi | ❌ | inutili. Il voto sulle proposte basta (ponytail) |
| Notifiche 🔔 | 🔄 | mail SMTP già prevista + badge sul sito. Push solo se serve |

## 4. Cosa manca nel mockup e c'è nel nostro sito

- Login e ruoli che si sommano (Admin, Organizzatore GA, Docente, Allievo, Relatore, Eco, Assemblea, Direzione).
- GA: catalogo attività (vedi analisi Lilu2), relatori e mail, aule, posti in tempo reale.
- Assemblea: ordine del giorno, presenze divise per docenti/allievi/direzione, verbale I/C/D/E, azioni con responsabile e scadenza da seguire nel tempo.
- Eco: riunioni numerate (siamo alla n° 5), verbalista a rotazione, **sondaggi** (es. SpazioAutogestito, 100 risposte). Nel mockup i sondaggi non ci sono, eppure il verbale dell'01.10 dice "Attivazione e gestione dei sondaggi".
- Export CSV/XLSX e correzione manuale dei dati.

## 5. Modello unificato (bozza)

Poche entità condivise invece di un modulo separato per ogni fase:

- **Fascia** (giorno, inizio, fine): una sola tabella
- **Spazio/Aula**
- **Evento** (tipo: attività GA / riunione Assemblea / riunione Eco; fascia; aula; max posti; organizzatore)
- **Iscrizione** (persona ↔ evento, unica; il conteggio posti viene da qui)
- ~~Prenotazione~~: rimandata (vedi §3)
- **Post** (canale, tipo avviso/discussione/risorsa, autore, ufficiale sì/no) → **Commento** (autore, testo, segnalato sì/no, eliminato sì/no)
- **Proposta** (destinazione, anonima sì/no, voti 1 per persona, stato: aperta → in OdG → decisa)
- **Riunione** (organo: Assemblea/Eco, numero, OdG, presenze) → **Verbale** → **Righe I/C/D/E** → **Azioni** (responsabile, scadenza, stato)
- **Sondaggio** (domande, risposte, export)
- **Assegnazione ruolo** (persona, ruolo, organo, dal–al)

## 6. Decisioni (08.10.2026)

1. **EcoSpazio resta separato.** È il sito del Prof. Moscatelli e noi mettiamo solo un link. Ne prendiamo lo stile e le idee UX, ma nel nostro sito la parte Eco copre solo riunioni, verbali, ruoli e sondaggi.
2. **Prenotazione dello spazio:** decidiamo poi.
3. **Proposte anonime:** anonime per tutti tranne l'admin, che vede l'autore per poter moderare.
4. **Bacheca:** avvisi + commenti, con moderazione.

Ancora aperto: soglia di voti per portare una proposta all'OdG, e chi modera i commenti (solo admin o anche gli organizzatori di ogni fase).
