import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import db from '../../../config/database';
import { generateVerificationToken } from '../../../utils/crypto';
import { DomainSetupService } from '../../../services/DomainSetupService';

jest.mock('../../../config/database');
jest.mock('../../../config/logger');
jest.mock('../../../utils/crypto', () => ({
  generateVerificationToken: jest.fn()
}));
jest.mock('../../../services/PlanLimitsService', () => ({
  planLimitsService: { assertResourceLimit: jest.fn(async () => undefined) }
}));
jest.mock('../../../services/MultiDomainDKIMManager', () => ({
  MultiDomainDKIMManager: jest.fn().mockImplementation(() => ({
    regenerateDKIMKeysForDomain: jest.fn()
  }))
}));

describe('DomainSetupService', () => {
  const createDnsInstructions = () => ({
    sending_domain: 'example.com',
    mail_from_domain: 'uz-mail.example.com',
    mail_from_mx: {
      record: 'uz-mail.example.com',
      value: 'mail.velomail.com.br',
      priority: 10,
      description: 'Mail-from MX record'
    },
    spf: {
      record: 'uz-mail.example.com',
      value: 'v=spf1 include:velomail.com.br -all',
      description: 'SPF record'
    },
    dkim: {
      record: 'default._domainkey.example.com',
      value: 'v=DKIM1; k=rsa; p=public-key',
      description: 'DKIM record'
    },
    dmarc: {
      record: '_dmarc.example.com',
      value: 'v=DMARC1; p=none',
      description: 'DMARC record'
    },
    notes: ['note 1']
  });

  const configureDbMocks = (options: {
    insertResult: unknown;
    reloadedId: number;
  }) => {
    const mockDb = db as unknown as jest.Mock;
    const reloadedDomain = {
      id: options.reloadedId,
      user_id: 1,
      domain_name: 'example.com',
      verification_token: 'token-123',
      verification_method: 'dns',
      is_verified: false,
      dkim_enabled: true,
      dkim_selector: 'default',
      spf_enabled: true,
      dmarc_enabled: true,
      dmarc_policy: 'none',
      created_at: new Date('2026-03-03T12:00:00.000Z'),
      updated_at: new Date('2026-03-03T12:00:00.000Z')
    };

    const dkimQuery: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve({
        private_key: 'private-key',
        public_key: 'public-key'
      }))
    };

    let domainTableCalls = 0;
    const insertBuilder: any = {
      insert: jest.fn(() => Promise.resolve(options.insertResult))
    };
    const reloadBuilder: any = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve(reloadedDomain))
    };

    const trx = jest.fn((table: string) => {
      if (table !== 'domains') {
        throw new Error(`Unexpected transaction table: ${table}`);
      }

      domainTableCalls += 1;
      return domainTableCalls === 1 ? insertBuilder : reloadBuilder;
    });

    mockDb.mockImplementation((table: string) => {
      if (table === 'dkim_keys') {
        return dkimQuery;
      }

      throw new Error(`Unexpected table outside transaction: ${table}`);
    });

    (mockDb as any).transaction = jest.fn(async (handler: (trx: any) => Promise<void>) => handler(trx));

    return { mockDb, insertBuilder, reloadBuilder };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (generateVerificationToken as jest.Mock).mockReturnValue('token-123');
  });

  it('reloads the domain after insert without depending on the insert return payload', async () => {
    const service = new DomainSetupService();
    const regenerateDKIMKeysForDomain = jest.fn(() => Promise.resolve(true));
    (service as any).dkimManager.regenerateDKIMKeysForDomain = regenerateDKIMKeysForDomain;

    jest.spyOn(service as any, 'checkExistingDomain').mockResolvedValue(null);
    jest.spyOn(service as any, 'createDNSInstructions').mockReturnValue(createDnsInstructions());
    jest.spyOn(service as any, 'generateSetupGuide').mockReturnValue(['step 1']);

    const { mockDb, insertBuilder, reloadBuilder } = configureDbMocks({
      insertResult: undefined,
      reloadedId: 17
    });

    const result = await service.initiateDomainSetup(1, 'example.com');

    expect(result.domain.id).toBe(17);
    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
    expect(reloadBuilder.orderBy).toHaveBeenCalledWith('id', 'desc');
    expect((mockDb as any).transaction).toHaveBeenCalledTimes(1);
    expect(regenerateDKIMKeysForDomain).toHaveBeenCalledWith('example.com');
  });

  it('accepts postgres-style insert payloads without calling returning', async () => {
    const service = new DomainSetupService();
    const regenerateDKIMKeysForDomain = jest.fn(() => Promise.resolve(true));
    (service as any).dkimManager.regenerateDKIMKeysForDomain = regenerateDKIMKeysForDomain;

    jest.spyOn(service as any, 'checkExistingDomain').mockResolvedValue(null);
    jest.spyOn(service as any, 'createDNSInstructions').mockReturnValue(createDnsInstructions());
    jest.spyOn(service as any, 'generateSetupGuide').mockReturnValue(['step 1']);

    const { insertBuilder } = configureDbMocks({
      insertResult: [{ id: '23' }],
      reloadedId: 23
    });

    const result = await service.initiateDomainSetup(1, 'example.com');

    expect(result.domain.id).toBe(23);
    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects domains already linked to a different account before opening the transaction', async () => {
    const service = new DomainSetupService();
    const transactionSpy = jest.spyOn(db as any, 'transaction');

    jest.spyOn(service as any, 'checkExistingDomain').mockResolvedValue({
      id: 44,
      user_id: 99,
      domain_name: 'example.com'
    });

    await expect(service.initiateDomainSetup(1, 'example.com')).rejects.toThrow(
      'already linked to another account'
    );
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('creates DNS instructions with a managed mail-from subdomain instead of apex MX takeover', () => {
    const service = new DomainSetupService();

    const instructions = (service as any).createDNSInstructions(
      {
        domain_name: 'example.com',
        dmarc_policy: 'none'
      },
      'public-key'
    );

    expect(instructions.mail_from_domain).toBe('uz-mail.example.com');
    expect(instructions.mail_from_mx.record).toBe('uz-mail.example.com');
    expect(instructions.mail_from_mx.value).toBe('mail.velomail.com.br');
    expect(instructions.spf.record).toBe('uz-mail.example.com');
    expect(instructions.spf.value).toBe('v=spf1 a:mail.velomail.com.br -all');
    expect(instructions.dmarc.value).toContain('v=DMARC1; p=none');
    expect(instructions.dmarc.value).toContain('rua=mailto:dmarc@velomail.com.br');
    expect(instructions.notes[0]).toContain('Nao altere os registros @');
  });

  it('verifies SPF on the managed mail-from subdomain and rejects duplicate SPF records', async () => {
    const service = new DomainSetupService();

    jest.spyOn(service as any, 'resolveTxtWithRetry').mockResolvedValue([
      'v=spf1 include:velomail.com.br -all',
      'v=spf1 include:another.example -all'
    ]);

    const result = await (service as any).verifySpfRecord('example.com');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Multiple SPF records');
    expect((service as any).resolveTxtWithRetry).toHaveBeenCalledWith('uz-mail.example.com');
  });

  it('persists the verification state after a successful DNS verification', async () => {
    const service = new DomainSetupService();
    const mockDb = db as unknown as jest.Mock;
    const domainRecord = {
      id: 19,
      user_id: 1,
      domain_name: 'example.com',
      verification_token: 'token-123',
      verification_method: 'dns',
      is_verified: false,
      dkim_enabled: false,
      dkim_selector: 'default',
      spf_enabled: false,
      dmarc_enabled: false,
      dmarc_policy: 'none',
      created_at: new Date('2026-03-03T12:00:00.000Z'),
      updated_at: new Date('2026-03-03T12:00:00.000Z')
    };
    const loadBuilder: any = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve(domainRecord))
    };
    const updateBuilder: any = {
      where: jest.fn().mockReturnThis(),
      update: jest.fn(() => Promise.resolve(1))
    };

    let tableCalls = 0;
    mockDb.mockImplementation((table: string) => {
      if (table !== 'domains') {
        throw new Error(`Unexpected table: ${table}`);
      }

      tableCalls += 1;
      return tableCalls === 1 ? loadBuilder : updateBuilder;
    });

    jest.spyOn(service as any, 'verifyMailFromMxRecord').mockResolvedValue({
      valid: true,
      expectedValue: 'mail.velomail.com.br',
      actualValue: 'mail.velomail.com.br (10)'
    });
    jest.spyOn(service as any, 'verifySpfRecord').mockResolvedValue({
      valid: true,
      expectedValue: 'v=spf1 include:velomail.com.br -all',
      actualValue: 'v=spf1 include:velomail.com.br -all'
    });
    jest.spyOn(service as any, 'verifyDkimRecord').mockResolvedValue({
      valid: true,
      expectedValue: 'v=DKIM1; k=rsa; p=<public_key>',
      actualValue: 'v=DKIM1; k=rsa; p=public-key'
    });
    jest.spyOn(service as any, 'verifyDmarcRecord').mockResolvedValue({
      valid: true,
      expectedValue: 'v=DMARC1; p=none',
      actualValue: 'v=DMARC1; p=none'
    });

    const result = await service.verifyDomainSetup(1, 19);

    expect(result.all_passed).toBe(true);
    expect(updateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      is_verified: true,
      dkim_enabled: true,
      spf_enabled: true,
      dmarc_enabled: true,
      verification_errors: null
    }));
  });
});
