import { describe, expect, it } from 'vitest';
import {
  isAllowedJudicialArchiveHostname,
  isBlockedIpAddress,
  unwrapJudicialArchiveUrl,
} from './safe-judicial-archive-url';

describe('safe-judicial-archive-url', () => {
  it('desenvuelve SafeLinks de Outlook', () => {
    const wrapped =
      'https://nam.safelinks.protection.outlook.com/?url=' +
      encodeURIComponent('https://procesojudicial.ramajudicial.gov.co/demandaenlinea/archivo.zip');
    expect(unwrapJudicialArchiveUrl(wrapped)).toBe(
      'https://procesojudicial.ramajudicial.gov.co/demandaenlinea/archivo.zip',
    );
  });

  it('permite hosts de la Rama y órganos de cierre', () => {
    expect(isAllowedJudicialArchiveHostname('procesojudicial.ramajudicial.gov.co')).toBe(true);
    expect(isAllowedJudicialArchiveHostname('ramajudicial.gov.co')).toBe(true);
    expect(isAllowedJudicialArchiveHostname('siugj-sgde.ramajudicial.gov.co')).toBe(true);
    expect(isAllowedJudicialArchiveHostname('www.corteconstitucional.gov.co')).toBe(true);
  });

  it('rechaza hosts ajenos, IPs literales y localhost', () => {
    expect(isAllowedJudicialArchiveHostname('evil.example')).toBe(false);
    expect(isAllowedJudicialArchiveHostname('127.0.0.1')).toBe(false);
    expect(isAllowedJudicialArchiveHostname('169.254.169.254')).toBe(false);
    expect(isAllowedJudicialArchiveHostname('ramajudicial.gov.co.evil.example')).toBe(false);
  });

  it('bloquea rangos RFC1918, loopback y link-local', () => {
    expect(isBlockedIpAddress('127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('10.0.0.8')).toBe(true);
    expect(isBlockedIpAddress('192.168.1.1')).toBe(true);
    expect(isBlockedIpAddress('172.16.0.1')).toBe(true);
    expect(isBlockedIpAddress('169.254.169.254')).toBe(true);
    expect(isBlockedIpAddress('::1')).toBe(true);
    expect(isBlockedIpAddress('8.8.8.8')).toBe(false);
  });
});
