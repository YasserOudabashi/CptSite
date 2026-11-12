import nodemailer from 'nodemailer';

export interface OutgoingMail {
  to?: string;
  bcc?: string[];
  subject: string;
  text: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

// Errore mostrato all'azione chiamante quando l'invio non riesce.
export class MailSendError extends Error {
  constructor(cause: unknown) {
    super('Invio e-mail non riuscito: riprova più tardi o contatta il Responsabile sito.');
    this.name = 'MailSendError';
    this.cause = cause;
  }
}

// Trasporto finto per sviluppo e test: salva le mail in memoria, nessun invio reale.
export class FakeTransport implements MailTransport {
  outbox: OutgoingMail[] = [];
  failNext = 0; // per i test: quante prossime chiamate devono fallire

  async send(mail: OutgoingMail): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Errore SMTP simulato');
    }
    this.outbox.push(mail);
  }
}

class SmtpTransport implements MailTransport {
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  async send(mail: OutgoingMail): Promise<void> {
    await this.transporter.sendMail({ from: fromAddress(), ...mail });
  }
}

export function fromAddress(): string {
  return process.env.SMTP_FROM || 'noreply@localhost';
}

let current: MailTransport | undefined;

// SMTP vero solo in produzione con SMTP_HOST impostato; altrimenti trasporto finto.
export function getTransport(): MailTransport {
  if (!current) {
    const prod = process.env.NODE_ENV === 'production';
    // In produzione senza SMTP le mail non partirebbero in silenzio: meglio fermarsi subito.
    if (prod && !process.env.SMTP_HOST) throw new Error('SMTP_HOST mancante: in produzione serve un server SMTP');
    current = prod ? new SmtpTransport() : new FakeTransport();
  }
  return current;
}

export function setTransport(transport: MailTransport): void {
  current = transport;
}
