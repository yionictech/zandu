import { describe, expect, it } from 'vitest';
import {
  InfobipSmsSender,
  MessagingSender,
  WhatsAppCloudSender,
} from '../src/modules/notifications/messaging.js';
import {
  MemoryNotificationSender,
  type OutgoingMessage,
} from '../src/modules/notifications/sender.js';

const message: OutgoingMessage = {
  channel: 'whatsapp',
  recipient: '+242061234567',
  template: 'buyer_in_delivery',
  variables: { ref: 'ZD-4821', rider: 'Junior' },
  text: 'Zandu : votre commande ZD-4821 est en route avec Junior.',
};

function recorder(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('Messagerie (D16)', () => {
  it('SMS Infobip : numéro sans « + », expéditeur Zandu, texte rendu', async () => {
    const api = recorder(200, {
      bulkId: 'b1',
      messages: [{ messageId: 'm-1', status: { groupName: 'PENDING', name: 'PENDING_ACCEPTED' } }],
    });
    const sms = new InfobipSmsSender({
      baseUrl: 'https://abc.api.infobip.com',
      apiKey: 'cle',
      sender: 'Zandu',
      fetch: api.fetchImpl,
    });
    expect(await sms.send({ ...message, channel: 'sms' })).toEqual({ providerRef: 'm-1' });
    expect(api.calls[0]!.url).toBe('https://abc.api.infobip.com/sms/3/messages');
    expect((api.calls[0]!.init.headers as Record<string, string>).authorization).toBe('App cle');
    expect(JSON.parse(String(api.calls[0]!.init.body))).toEqual({
      messages: [
        {
          sender: 'Zandu',
          destinations: [{ to: '242061234567' }],
          content: { text: message.text },
        },
      ],
    });
  });

  it('SMS rejeté : erreur (le worker réessaiera)', async () => {
    const api = recorder(200, {
      messages: [{ status: { groupName: 'REJECTED', name: 'REJECTED_DESTINATION' } }],
    });
    const sms = new InfobipSmsSender({
      baseUrl: 'https://x.api.infobip.com',
      apiKey: 'k',
      sender: 'Zandu',
      fetch: api.fetchImpl,
    });
    await expect(sms.send(message)).rejects.toThrow(/REJECTED_DESTINATION/);
  });

  it('WhatsApp : modèle approuvé, paramètres nommés', async () => {
    const api = recorder(200, { messages: [{ id: 'wamid.1' }] });
    const wa = new WhatsAppCloudSender({
      phoneNumberId: '1234',
      accessToken: 'jeton',
      fetch: api.fetchImpl,
    });
    expect(await wa.send(message)).toEqual({ providerRef: 'wamid.1' });
    expect(api.calls[0]!.url).toBe('https://graph.facebook.com/v23.0/1234/messages');
    expect(JSON.parse(String(api.calls[0]!.init.body))).toEqual({
      messaging_product: 'whatsapp',
      to: '242061234567',
      type: 'template',
      template: {
        name: 'buyer_in_delivery',
        language: { code: 'fr' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'ref', text: 'ZD-4821' },
              { type: 'text', parameter_name: 'rider', text: 'Junior' },
            ],
          },
        ],
      },
    });
  });

  it('WhatsApp refusé ou absent → SMS ; SMS toujours en SMS', async () => {
    const sms = new MemoryNotificationSender();
    const failing = new WhatsAppCloudSender({
      phoneNumberId: '1',
      accessToken: 't',
      fetch: recorder(400, { error: { code: 132001, message: 'Template name does not exist' } })
        .fetchImpl,
    });
    const logged: string[] = [];
    await new MessagingSender(sms, failing, (e) => logged.push(String(e))).send(message);
    expect(sms.sent[0]).toMatchObject({ channel: 'sms', text: message.text });
    expect(logged[0]).toMatch(/132001/);

    await new MessagingSender(sms, null).send(message);
    expect(sms.sent).toHaveLength(2);

    const wa = new MemoryNotificationSender();
    await new MessagingSender(sms, wa).send({ ...message, channel: 'sms', template: 'otp_code' });
    expect(wa.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(3);
  });
});
