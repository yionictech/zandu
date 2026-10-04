export type Channel = 'whatsapp' | 'sms' | 'push';

export interface OutgoingMessage {
  channel: Channel;
  recipient: string;
  /** Nom du modèle pré-approuvé (WhatsApp Business exige des modèles validés par Meta). */
  template: string;
  variables: Record<string, string>;
  /** Texte rendu, utilisé pour le SMS et les journaux. */
  text: string;
}

/** Port vers le fournisseur de messagerie (API WhatsApp Business, passerelle SMS locale…). */
export interface NotificationSender {
  send(message: OutgoingMessage): Promise<{ providerRef?: string }>;
}

/** Implémentation de développement et de test : garde les messages en mémoire. */
export class MemoryNotificationSender implements NotificationSender {
  readonly sent: OutgoingMessage[] = [];
  failChannels = new Set<Channel>();

  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
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

/** Développement local : affiche les messages dans la console (dont les codes de connexion). */
export class ConsoleNotificationSender implements NotificationSender {
  async send(message: OutgoingMessage): Promise<{ providerRef?: string }> {
    console.log(`[${message.channel.toUpperCase()} -> ${message.recipient}] ${message.text}`);
    return {};
  }
}
