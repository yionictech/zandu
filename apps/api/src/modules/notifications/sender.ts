export type Channel = 'whatsapp' | 'sms' | 'push';

export interface OutgoingMessage {
  channel: Channel;
  recipient: string;
  /** Nom du modèle pré-approuvé (WhatsApp Business exige des modèles validés par Meta). */
  template: string;
  variables: Record<string, string>;
  /** Texte rendu, utilisé pour le SMS et les journaux. */
  text: string;
  /** Notification sur le téléphone : titre court et données (identifiant, écran à ouvrir). */
  title?: string;
  data?: Record<string, string>;
}

/** Jeton refusé par le service de notifications (application désinstallée…) : à ne plus utiliser. */
export class PushTokenInvalidError extends Error {
  constructor(readonly token: string) {
    super('Jeton de notification invalide');
    this.name = 'PushTokenInvalidError';
  }
}

/** Port vers le fournisseur de messagerie (API WhatsApp Business, passerelle SMS locale…). */
export interface NotificationSender {
  send(message: OutgoingMessage): Promise<{ providerRef?: string }>;
}

/** Implémentation de développement et de test : garde les messages en mémoire. */
export class MemoryNotificationSender implements NotificationSender {
  readonly sent: OutgoingMessage[] = [];
  failChannels = new Set<Channel>();
  /** Jetons de notification que le service déclare invalides. */
  invalidTokens = new Set<string>();

  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    if (message.channel === 'push' && this.invalidTokens.has(message.recipient))
      throw new PushTokenInvalidError(message.recipient);
    if (this.failChannels.has(message.channel))
      throw new Error(`Canal ${message.channel} indisponible`);
    this.sent.push(message);
    return { providerRef: `mem-${this.sent.length}` };
  }

  lastTo(recipient: string, template?: string): OutgoingMessage | undefined {
    return [...this.sent]
      .reverse()
      .find((m) => m.recipient === recipient && (!template || m.template === template));
  }
}

/**
 * Développement local : affiche les messages dans la console et garde les 200 derniers,
 * consultables via `GET /dev/messages` (connexion sur un téléphone de test sans lire les journaux).
 */
export class DevNotificationSender implements NotificationSender {
  readonly recent: Array<OutgoingMessage & { sentAt: string }> = [];

  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    console.log(`[${message.channel.toUpperCase()} -> ${message.recipient}] ${message.text}`);
    this.recent.push({ ...message, sentAt: new Date().toISOString() });
    if (this.recent.length > 200) this.recent.shift();
    return {};
  }
}

/**
 * Notifications Android par le service d'Expo (qui passe par Firebase Cloud Messaging) :
 * l'application obtient un jeton Expo, le serveur n'a besoin d'aucun identifiant Firebase.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */
export class ExpoPushSender implements NotificationSender {
  constructor(
    private readonly accessToken: string | null,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    const response = await this.fetchFn('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({
        to: message.recipient,
        title: message.title,
        body: message.text,
        data: message.data ?? {},
        channelId: 'commandes',
        priority: 'high',
        sound: 'default',
      }),
    });
    if (!response.ok) throw new Error(`Service de notifications : HTTP ${response.status}`);
    const { data } = (await response.json()) as {
      data: { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };
    };
    if (data.status === 'ok') return { providerRef: data.id };
    if (data.details?.error === 'DeviceNotRegistered')
      throw new PushTokenInvalidError(message.recipient);
    throw new Error(`Notification refusée : ${data.message ?? data.details?.error ?? 'inconnu'}`);
  }
}

/** Chaque canal vers son fournisseur (notifications d'un côté, WhatsApp/SMS de l'autre). */
export class RoutingNotificationSender implements NotificationSender {
  constructor(
    readonly push: NotificationSender,
    readonly messaging: NotificationSender,
  ) {}

  send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    return (message.channel === 'push' ? this.push : this.messaging).send(message);
  }
}
