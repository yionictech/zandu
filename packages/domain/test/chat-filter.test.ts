import { describe, expect, it } from 'vitest';
import { filterChatMessage } from '../src/index.js';

describe('filterChatMessage', () => {
  it.each([
    'Appelle-moi au 06 612 34 56',
    'mon numéro +242066123456',
    'whatsapp 06.612.34.56 stp',
    '00242 05 512 34 56',
  ])('masque le numéro dans « %s »', (msg) => {
    const r = filterChatMessage(msg);
    expect(r.masked).toBe(true);
    expect(r.reasons).toContain('phone');
    expect(r.text).not.toMatch(/\d{2}[\s.]?\d{3}/);
  });

  it('masque liens, domaines nus et e-mails', () => {
    const r = filterChatMessage(
      'Va sur https://exemple.com/x ou boutique.cg, écris à moi@mail.com, ou wa.me/242066123456',
    );
    expect(r.reasons.sort()).toEqual(['email', 'link']);
    expect(r.text).not.toMatch(/exemple|boutique\.cg|mail\.com|wa\.me/);
  });

  it('laisse passer les prix et les messages ordinaires', () => {
    const msg = 'Bonjour, il est à 25 000 FCFA, livraison 1 500. Disponible en taille 42 ?';
    expect(filterChatMessage(msg)).toEqual({ text: msg, masked: false, reasons: [] });
  });
});
