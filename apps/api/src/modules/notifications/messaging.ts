import type { NotificationSender, OutgoingMessage } from './sender.js';

/**
 * Fournisseurs de messagerie (décision D16, docs/exploitation/points-bloquants.md).
 *
 * - SMS par Infobip (API « SMS v3 ») : codes de connexion, code de remise, alertes. Un autre
 *   fournisseur (MTN, Airtel, passerelle locale) s'ajoute en écrivant une classe de plus.
 * - WhatsApp par l'API Cloud de Meta : avis de commande, moins chers que le SMS. Chaque modèle de
 *   templates.ts est créé chez Meta sous le même nom, en français, avec des paramètres nommés
 *   ({{ref}}, {{code}}…) ; Meta doit les avoir approuvés avant le premier envoi.
 * - Un WhatsApp refusé d'emblée (numéro sans WhatsApp, modèle absent) part en SMS.
 */
const digits = (e164: string) => e164.replace(/^\+/, '');

export interface InfobipOptions {
  /** Adresse propre au compte, ex. https://xxxxx.api.infobip.com */
  baseUrl: string;
  apiKey: string;
  /** Nom affiché comme expéditeur (« Zandu », à faire enregistrer auprès des opérateurs). */
  sender: string;
  fetch?: typeof fetch;
}

export class InfobipSmsSender implements NotificationSender {
  constructor(private readonly options: InfobipOptions) {}

  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    const res = await (this.options.fetch ?? fetch)(
      new URL('/sms/3/messages', this.options.baseUrl),
      {
        method: 'POST',
        headers: {
          authorization: `App ${this.options.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              sender: this.options.sender,
              destinations: [{ to: digits(message.recipient) }],
              content: { text: message.text },
            },
          ],
        }),
      },
    );
    if (!res.ok) throw new Error(`SMS refusé par Infobip : HTTP ${res.status}`);
    const body = (await res.json()) as {
      messages?: Array<{ messageId?: string; status?: { groupName?: string; name?: string } }>;
    };
    const sent = body.messages?.[0];
    if (sent?.status?.groupName === 'REJECTED')
      throw new Error(`SMS refusé par Infobip : ${sent.status.name ?? 'REJECTED'}`);
    return sent?.messageId ? { providerRef: sent.messageId } : {};
  }
}

export interface WhatsAppCloudOptions {
  phoneNumberId: string;
  accessToken: string;
  /** Langue des modèles approuvés chez Meta. */
  language?: string;
  apiVersion?: string;
  fetch?: typeof fetch;
}

export class WhatsAppCloudSender implements NotificationSender {
  constructor(private readonly options: WhatsAppCloudOptions) {}

  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    const version = this.options.apiVersion ?? 'v23.0';
    const parameters = Object.entries(message.variables).map(([name, text]) => ({
      type: 'text',
      parameter_name: name,
      text,
    }));
    const res = await (this.options.fetch ?? fetch)(
      `https://graph.facebook.com/${version}/${this.options.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: digits(message.recipient),
          type: 'template',
          template: {
            name: message.template,
            language: { code: this.options.language ?? 'fr' },
            ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}),
          },
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { code?: number; message?: string };
    };
    if (!res.ok || !body.messages?.[0])
      throw new Error(
        `WhatsApp refusé : ${body.error?.code ?? res.status} ${body.error?.message ?? ''}`.trim(),
      );
    return { providerRef: body.messages[0].id };
  }
}

/** SMS et WhatsApp vers leurs fournisseurs ; WhatsApp absent ou refusé → SMS. */
export class MessagingSender implements NotificationSender {
  constructor(
    private readonly sms: NotificationSender,
    private readonly whatsapp: NotificationSender | null,
    private readonly log: (error: unknown, message: OutgoingMessage) => void = () => {},
  ) {}

  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    if (message.channel === 'whatsapp' && this.whatsapp) {
      try {
        return await this.whatsapp.send(message);
      } catch (error) {
        this.log(error, message);
      }
    }
    return this.sms.send({ ...message, channel: 'sms' });
  }
}

/** Recette : envoie pour de vrai et garde une copie dans la boîte de réception des testeurs. */
export class CopySender implements NotificationSender {
  constructor(
    private readonly main: NotificationSender,
    readonly copy: NotificationSender,
  ) {}

  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    await this.copy.send(message);
    return this.main.send(message);
  }
}
