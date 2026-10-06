import { logger } from '../config/logger';
import db from '../config/database';
import { generateVerificationToken } from '../utils/crypto';
import { MultiDomainDKIMManager } from './MultiDomainDKIMManager';
import { DomainValidator } from './DomainValidator';
import { SimpleEmailValidator } from '../email/EmailValidator';
import { buildManagedMailFromDomain, DEFAULT_PLATFORM_MX_HOST } from '../utils/mailFrom';
import { Env } from '../utils/env';
import { planLimitsService } from './PlanLimitsService';
import dns from 'dns';
import { promisify } from 'util';

// Promisificar métodos DNS para uso com async/await
const resolveTxt = promisify(dns.resolveTxt);
const resolveA = promisify(dns.resolve4);
const resolveMx = promisify(dns.resolveMx);

export interface DomainRecord {
  id: number;
  user_id: number;
  domain_name: string;
  verification_token: string;
  verification_method: string;
  is_verified: boolean;
  dkim_enabled: boolean;
  dkim_selector: string;
  spf_enabled: boolean;
  dmarc_enabled: boolean;
  dmarc_policy: string;
  created_at: Date;
  updated_at: Date;
  verified_at?: Date;
}

export interface DNSRecordInstruction {
  record: string;
  value: string;
  priority?: number;
  description: string;
}

export interface DNSInstructions {
  sending_domain: string;
  mail_from_domain: string;
  mail_from_mx: DNSRecordInstruction;
  spf: DNSRecordInstruction;
  dkim: DNSRecordInstruction;
  dmarc: DNSRecordInstruction;
  notes: string[];
  deliverability_requirements: string[];
  recommended_practices: string[];
}

export interface DomainSetupResult {
  domain: DomainRecord;
  dns_instructions: DNSInstructions;
  verification_token: string;
  setup_guide: string[];
}

export interface DNSVerificationResult {
  valid: boolean;
  value?: string;
  error?: string;
  expectedValue: string;
  actualValue?: string;
}

export interface VerificationResult {
  success: boolean;
  domain: string;
  all_passed: boolean;
  results: {
    mail_from_mx: DNSVerificationResult;
    spf: DNSVerificationResult;
    dkim: DNSVerificationResult;
    dmarc: DNSVerificationResult;
  };
  verified_at: Date;
  nextSteps: string[];
}

export interface DomainStatus {
  domain: DomainRecord;
  mail_from_status: {
    configured: boolean;
    dns_valid: boolean;
    domain: string;
  };
  dkim_status: {
    configured: boolean;
    public_key?: string;
    dns_valid: boolean;
  };
  spf_status: {
    configured: boolean;
    dns_valid: boolean;
  };
  dmarc_status: {
    configured: boolean;
    dns_valid: boolean;
  };
  overall_status: 'pending' | 'partial' | 'verified' | 'failed';
  completion_percentage: number;
}

/**
 * Serviço para configuração completa de domínios
 * Implementa todo o ciclo de vida de setup de domínio para clientes
 */
export class DomainSetupService {
  private readonly dkimManager: MultiDomainDKIMManager;
  private readonly domainValidator: DomainValidator;
  
  // Configurações DNS UltraZend
  private readonly PLATFORM_MAIL_FROM_MX = DEFAULT_PLATFORM_MX_HOST;
  private readonly ULTRAZEND_SPF_INCLUDE = Env.get('ULTRAZEND_SPF_INCLUDE', '').trim().toLowerCase();
  private readonly ULTRAZEND_SPF_IPS = this.parseCsvList(Env.get('ULTRAZEND_SPF_IPS', ''))
    .filter((ip) => this.isValidIpv4(ip));
  private readonly ULTRAZEND_SPF_HOSTS = this.parseCsvList(Env.get('ULTRAZEND_SPF_HOSTS', ''))
    .map((host) => this.normalizeDnsHostname(host));
  private readonly ULTRAZEND_DMARC_RUA = Env.get('ULTRAZEND_DMARC_RUA', 'dmarc@velomail.com.br').trim().toLowerCase();
  private readonly DNS_TIMEOUT = 10000; // 10 segundos
  private readonly MAX_DNS_RETRIES = 3;
  private readonly ENABLE_DNS_FALLBACK = Env.get('ENABLE_DNS_FALLBACK', 'true').toLowerCase() !== 'false';
  private readonly DNS_FALLBACK_SERVERS = this.parseCsvList(Env.get('DNS_FALLBACK_SERVERS', '1.1.1.1,8.8.8.8'));

  constructor() {
    this.dkimManager = new MultiDomainDKIMManager();
    this.domainValidator = new DomainValidator();
    
    logger.debug('DomainSetupService initialized');
  }

  /**
   * Inicia o processo de configuração de um domínio
   * 
   * @param userId - ID do usuário
   * @param domain - Domínio a ser configurado
   * @returns Resultado do setup com instruções DNS
   */
  async initiateDomainSetup(userId: number, domain: string): Promise<DomainSetupResult> {
    try {
      logger.info('Initiating domain setup', { userId, domain });

      // 1. Validar formato do domínio
      if (!this.isValidDomainFormat(domain)) {
        throw new Error('Formato de domínio inválido. Use um domínio válido como exemplo.com ou exemplo.com.br');
      }

      // Normalizar domínio
      const normalizedDomain = DomainValidator.normalizeDomain(domain);
      
      // 2. Verificar se domínio já existe para este usuário
      const existingDomain = await this.checkExistingDomain(userId, normalizedDomain);
      if (existingDomain && existingDomain.user_id !== userId) {
        throw new Error(`Domain ${normalizedDomain} is already linked to another account. Remove it from the previous account or contact support.`);
      }
      if (existingDomain) {
        throw new Error(`Domínio ${normalizedDomain} já está configurado para esta conta`);
      }

      // 3. Verificar se domínio é interno (UltraZend)
      if (this.isUltraZendDomain(normalizedDomain)) {
        throw new Error('Domínios UltraZend são gerenciados automaticamente e não podem ser configurados manualmente');
      }

      await planLimitsService.assertResourceLimit(userId, 'domains');

      // 4. Gerar token de verificação
      const verificationToken = generateVerificationToken();
      
      logger.debug('Generated verification token', { 
        userId, 
        domain: normalizedDomain,
        tokenLength: verificationToken.length 
      });

      // 5. CRIAR DOMÍNIO PRIMEIRO, depois DKIM
      let domainRecord: DomainRecord;
      let domainId: number;
      
      await db.transaction(async (trx) => {
        try {
          // Criar registro do domínio PRIMEIRO
          const domainData = {
            user_id: userId,
            domain_name: normalizedDomain,
            verification_token: verificationToken,
            verification_method: 'dns',
            is_verified: false,
            dkim_enabled: true,
            dkim_selector: 'default',
            spf_enabled: true,
            dmarc_enabled: true,
            dmarc_policy: 'none',
            created_at: new Date(),
            updated_at: new Date()
          };

          // Knex insert payloads vary by driver, so we always reload using unique fields.
          await trx('domains').insert(domainData);
          domainRecord = await trx('domains')
            .where('user_id', userId)
            .where('domain_name', normalizedDomain)
            .orderBy('id', 'desc')
            .first() as DomainRecord;

          if (!domainRecord) {
            throw new Error(`Domain ${normalizedDomain} was inserted, but could not be reloaded.`);
          }

          domainId = domainRecord.id;

          logger.info('�o. Domain record created successfully', { 
            userId, 
            domain: normalizedDomain, 
            domainId 
          });

        } catch (transactionError) {
          const handledError = this.isUniqueConstraintViolation(transactionError)
            ? new Error(`Domain ${normalizedDomain} is already registered in another account or was created in parallel.`)
            : transactionError;

          logger.error('Domain creation transaction failed', {
            userId,
            domain: normalizedDomain,
            error: handledError instanceof Error ? handledError.message : String(handledError)
          });
          
          // Transação será automaticamente revertida.
          throw new Error(`Falha critica na criacao do dominio: ${handledError instanceof Error ? handledError.message : 'Erro desconhecido'}`);
        }
      });
      
      // 6. AGORA GERAR DKIM para o domínio que já existe
      logger.info('Generating DKIM keys for domain after creation', { 
        domain: normalizedDomain, 
        domainId 
      });
      
      const dkimGenerated = await this.dkimManager.regenerateDKIMKeysForDomain(normalizedDomain);
      if (!dkimGenerated) {
        throw new Error(`Falha ao gerar chaves DKIM para ${normalizedDomain}`);
      }

      // 7. BUSCAR CHAVES DKIM GERADAS
      const dkimRecord = await db('dkim_keys')
        .select('private_key', 'public_key')
        .where('domain_id', domainId)
        .first();

      if (!dkimRecord || !dkimRecord.private_key || !dkimRecord.public_key) {
        throw new Error(`Chaves DKIM não encontradas após geração para ${normalizedDomain}`);
      }

      const dkimKeys = {
        privateKey: dkimRecord.private_key,
        publicKey: dkimRecord.public_key
      };

      logger.info('�o. DKIM keys generated successfully', {
        domain: normalizedDomain,
        domainId,
        publicKeyLength: dkimKeys.publicKey.length
      });
      
      // 8. Criar instruções DNS detalhadas
      const dnsInstructions = this.createDNSInstructions(
        domainRecord,
        dkimKeys.publicKey
      );

      // 9. Gerar guia de configuração
      const setupGuide = this.generateSetupGuide(domainRecord);

      const result: DomainSetupResult = {
        domain: domainRecord,
        dns_instructions: dnsInstructions,
        verification_token: verificationToken,
        setup_guide: setupGuide
      };

      logger.info('Domain setup initiated successfully', {
        userId,
        domain: normalizedDomain,
        domainId: domainRecord.id,
        dkimGenerated: !!dkimKeys.publicKey
      });

      return result;
    } catch (error) {
      logger.error('Failed to initiate domain setup', {
        userId,
        domain,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Verifica a configuração DNS de um domínio
   * 
   * @param userId - ID do usuário
   * @param domainId - ID do domínio no banco
   * @returns Resultado da verificação
   */
  async verifyDomainSetup(userId: number, domainId: string | number): Promise<VerificationResult> {
    try {
      logger.info('Starting domain verification', { userId, domainId });

      const domain = await db('domains')
        .where('id', domainId)
        .where('user_id', userId)
        .first() as DomainRecord | undefined;

      if (!domain) {
        throw new Error('Domínio não encontrado ou acesso negado');
      }

      logger.debug('Found domain for verification', {
        userId,
        domainId,
        domainName: domain.domain_name,
        isVerified: domain.is_verified
      });

      const [mailFromMxResult, spfResult, dkimResult, dmarcResult] = await Promise.allSettled([
        this.verifyMailFromMxRecord(domain.domain_name),
        this.verifySpfRecord(domain.domain_name),
        this.verifyDkimRecord(domain.domain_name, domain.dkim_selector),
        this.verifyDmarcRecord(domain.domain_name, domain.dmarc_policy)
      ]);

      const results = {
        mail_from_mx: this.processVerificationResult(mailFromMxResult, 'MAIL-FROM-MX'),
        spf: this.processVerificationResult(spfResult, 'SPF'),
        dkim: this.processVerificationResult(dkimResult, 'DKIM'),
        dmarc: this.processVerificationResult(dmarcResult, 'DMARC')
      };

      const all_passed = results.mail_from_mx.valid &&
                        results.spf.valid &&
                        results.dkim.valid &&
                        results.dmarc.valid;
      const verificationTimestamp = new Date();
      const verificationErrors = this.buildVerificationErrors(results);

      logger.info('DNS verification completed', {
        userId,
        domainId,
        domain: domain.domain_name,
        allPassed: all_passed,
        results: {
          mail_from_mx: results.mail_from_mx.valid,
          spf: results.spf.valid,
          dkim: results.dkim.valid,
          dmarc: results.dmarc.valid
        }
      });

      await db('domains')
        .where('id', domainId)
        .update({
          is_verified: all_passed,
          dkim_enabled: true,
          spf_enabled: true,
          dmarc_enabled: true,
          verified_at: all_passed ? verificationTimestamp : null,
          last_verification_attempt: verificationTimestamp,
          verification_errors: verificationErrors.length > 0
            ? JSON.stringify(verificationErrors)
            : null,
          updated_at: verificationTimestamp
        });

      logger.info('Domain verification state persisted', {
        userId,
        domainId,
        domain: domain.domain_name,
        allPassed: all_passed,
        verificationErrorsCount: verificationErrors.length
      });

      return {
        success: all_passed,
        domain: domain.domain_name,
        all_passed,
        results,
        verified_at: verificationTimestamp,
        nextSteps: all_passed ? [] : this.generateNextSteps(results)
      };
    } catch (error) {
      logger.error('Domain verification failed', {
        userId,
        domainId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Garante que o domínio principal esteja verificado
   * CORRE�?�fO CRÍTICA: Validação obrigatória do domínio principal
   * 
   * @returns Promise<boolean> - true se verificado, false caso contrário
   */
  async ensureMainDomainVerification(): Promise<boolean> {
    try {
      const mainDomain = 'velomail.com.br';
      logger.info('�Y"� CORRE�?�fO CRÍTICA: Verificando domínio principal obrigatoriamente', {
        domain: mainDomain
      });

      // Buscar usuário sistema ou admin para o domínio principal
      const systemUser = await db('users')
        .where('email', 'like', '%velomail.com.br')
        .orWhere('is_admin', true)
        .first();

      if (!systemUser) {
        logger.error('�O CRÍTICO: Usuário sistema não encontrado para domínio principal');
        return false;
      }

      // Buscar domínio principal
      const mainDomainRecord = await db('domains')
        .where('domain_name', mainDomain)
        .where('user_id', systemUser.id)
        .first();

      if (!mainDomainRecord) {
        logger.error('�O CRÍTICO: Registro do domínio principal não encontrado');
        return false;
      }

      // Se já está verificado, validar se DNS ainda funciona
      if (mainDomainRecord.is_verified) {
        logger.info('�Y"� Revalidando domínio principal já verificado');
        const revalidation = await this.verifyDomainSetup(systemUser.id, mainDomainRecord.id);
        return revalidation.all_passed;
      }

      // Se não verificado, fazer verificação completa
      logger.info('�s� Verificando domínio principal pela primeira vez');
      const verification = await this.verifyDomainSetup(systemUser.id, mainDomainRecord.id);

      if (!verification.all_passed) {
        logger.error('�O CRÍTICO: Domínio principal falhou na verificação DNS', {
          domain: mainDomain,
          results: verification.results
        });
        return false;
      }

      logger.info('�o. SUCESSO: Domínio principal verificado com sucesso');
      return true;

    } catch (error) {
      logger.error('�O ERRO CRÍTICO: Falha na verificação do domínio principal', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Obtém o status de todos os domínios de um usuário
   * 
   * @param userId - ID do usuário
   * @returns Lista de domínios com status detalhado
   */
  async getUserDomainsStatus(userId: number): Promise<DomainStatus[]> {
    try {
      logger.debug('Getting domains status for user', { userId });

      const domains = await db('domains')
        .select('*')
        .where('user_id', userId)
        .orderBy('created_at', 'desc') as DomainRecord[];

      const domainsWithStatus = await Promise.all(
        domains.map(async (domain) => {
          try {
            const mailFromStatus = await this.checkMailFromStatus(domain.domain_name);

            // Verificar status DKIM
            const dkimStatus = await this.checkDKIMStatus(domain.domain_name, domain.dkim_selector);
            
            // Verificar status SPF
            const spfStatus = await this.checkSPFStatus(domain.domain_name);
            
            // Verificar status DMARC
            const dmarcStatus = await this.checkDMARCStatus(domain.domain_name, domain.dmarc_policy);

            // Calcular status geral
            const overallStatus = this.calculateOverallStatus(domain, mailFromStatus, dkimStatus, spfStatus, dmarcStatus);
            const completionPercentage = this.calculateCompletionPercentage(domain, mailFromStatus, dkimStatus, spfStatus, dmarcStatus);

            return {
              domain,
              mail_from_status: mailFromStatus,
              dkim_status: dkimStatus,
              spf_status: spfStatus,
              dmarc_status: dmarcStatus,
              overall_status: overallStatus,
              completion_percentage: completionPercentage
            } as DomainStatus;
          } catch (error) {
            logger.error('Error checking domain status', {
              domainId: domain.id,
              domainName: domain.domain_name,
              error: error instanceof Error ? error.message : String(error)
            });

            // Retornar status de erro
            return {
              domain,
              mail_from_status: {
                configured: false,
                dns_valid: false,
                domain: this.getMailFromDomain(domain.domain_name)
              },
              dkim_status: { configured: false, dns_valid: false },
              spf_status: { configured: false, dns_valid: false },
              dmarc_status: { configured: false, dns_valid: false },
              overall_status: 'failed' as const,
              completion_percentage: 0
            } as DomainStatus;
          }
        })
      );

      logger.debug('Retrieved domains status', {
        userId,
        domainCount: domains.length
      });

      return domainsWithStatus;
    } catch (error) {
      logger.error('Failed to get user domains status', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Remove um domínio PERMANENTEMENTE do banco de dados
   * 
   * @param userId - ID do usuário
   * @param domainId - ID do domínio
   * @returns true se removido com sucesso
   */
  async removeDomain(userId: number, domainId: string | number): Promise<boolean> {
    try {
      logger.info('Removing domain', { userId, domainId });

      // Verificar se domínio pertence ao usuário
      const domain = await db('domains')
        .where('id', domainId)
        .where('user_id', userId)
        .first();

      if (!domain) {
        logger.warn('Domain not found or access denied', { userId, domainId });
        return false;
      }

      // REMO�?�fO REAL do domínio e dados relacionados
      await db.transaction(async (trx) => {
        // Remover chaves DKIM associadas
        if (await trx.schema.hasTable('dkim_keys')) {
          await trx('dkim_keys')
            .where('domain_id', domainId)
            .del();
        }

        // Remover registros de verificação DNS se existirem
        if (await trx.schema.hasTable('dns_verification_records')) {
          await trx('dns_verification_records')
            .where('domain_id', domainId)
            .del();
        }

        // Remover qualquer histórico de verificação
        if (await trx.schema.hasTable('domain_verification_history')) {
          await trx('domain_verification_history')
            .where('domain_id', domainId)
            .del();
        }

        if (await trx.schema.hasTable('domain_verification_logs')) {
          await trx('domain_verification_logs')
            .where('domain_id', domainId)
            .del();
        }

        // Finalmente, remover o domínio
        await trx('domains')
          .where('id', domainId)
          .del();
      });

      logger.info('Domain removed successfully', {
        userId,
        domainId,
        domainName: domain.domain_name
      });

      return true;
    } catch (error) {
      logger.error('Failed to remove domain', {
        userId,
        domainId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Gera chaves DKIM para um domínio
   * 
   * @param domainId - ID do domínio
   * @param domain - Nome do domínio
   * @returns Chaves DKIM geradas
   */
  private async generateDKIMKeysForDomain(domainId: number, domain: string): Promise<{
    privateKey: string;
    publicKey: string;
  }> {
    try {
      logger.debug('Generating DKIM keys for domain', { domainId, domain });

      // Usar MultiDomainDKIMManager para gerar chaves
      const regenerated = await this.dkimManager.regenerateDKIMKeysForDomain(domain);
      
      if (!regenerated) {
        throw new Error('Falha ao gerar chaves DKIM');
      }

      // Buscar chaves geradas
      const dkimRecord = await db('dkim_keys')
        .where('domain_id', domainId)
        .first();

      if (!dkimRecord) {
        throw new Error('Chaves DKIM não foram salvas corretamente');
      }

      logger.info('DKIM keys generated successfully', { 
        domainId, 
        domain,
        hasPrivateKey: !!dkimRecord.private_key,
        hasPublicKey: !!dkimRecord.public_key
      });

      return {
        privateKey: dkimRecord.private_key,
        publicKey: dkimRecord.public_key
      };
    } catch (error) {
      logger.error('Failed to generate DKIM keys', {
        domainId,
        domain,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Gera chaves DKIM para um domínio dentro de uma transação de banco
   * Versão profissional que trabalha com transações atômicas
   * 
   * @param trx - Transação do Knex
   * @param domainId - ID do domínio
   * @param domain - Nome do domínio
   * @returns Chaves DKIM geradas
   */
  private async generateDKIMKeysForDomainTransaction(
    trx: any, 
    domainId: number, 
    domain: string
  ): Promise<{
    privateKey: string;
    publicKey: string;
  }> {
    try {
      logger.debug('Generating DKIM keys for domain in transaction', { domainId, domain });

      // CRÍTICO: Verificar se já existem chaves para evitar duplicatas
      const existingDkimKey = await trx('dkim_keys').where('domain_id', domainId).first();
      if (existingDkimKey) {
        logger.warn('DKIM keys already exist for domain, removing old keys first', { 
          domainId, 
          domain 
        });
        await trx('dkim_keys').where('domain_id', domainId).del();
      }

      // Usar MultiDomainDKIMManager para gerar chaves
      const regenerated = await this.dkimManager.regenerateDKIMKeysForDomain(domain);
      
      if (!regenerated) {
        throw new Error(`MultiDomainDKIMManager falhou ao gerar chaves para ${domain}`);
      }

      // VALIDA�?�fO: Buscar chaves geradas na transação
      const dkimRecord = await trx('dkim_keys').where('domain_id', domainId).first();

      if (!dkimRecord) {
        // Tentar buscar por nome do domínio como fallback
        const dkimByDomain = await trx('dkim_keys')
          .join('domains', 'dkim_keys.domain_id', '=', 'domains.id')
          .where('domains.domain_name', domain)
          .select('dkim_keys.*')
          .first();

        if (dkimByDomain) {
          logger.info('DKIM found by domain name, updating domain_id', {
            domainId,
            domain,
            foundDkimId: dkimByDomain.id
          });
          
          // Atualizar domain_id correto
          await trx('dkim_keys').where('id', dkimByDomain.id).update({ domain_id: domainId });
          
          return {
            privateKey: dkimByDomain.private_key,
            publicKey: dkimByDomain.public_key
          };
        }
        
        throw new Error(`Chaves DKIM não foram salvas na transação para domínio ${domain}`);
      }

      // VALIDA�?�fO CRÍTICA: Verificar se as chaves são válidas
      if (!dkimRecord.private_key || !dkimRecord.public_key) {
        throw new Error(`Chaves DKIM inválidas geradas para domínio ${domain}`);
      }

      if (dkimRecord.private_key.length < 100 || dkimRecord.public_key.length < 100) {
        throw new Error(`Chaves DKIM muito curtas para domínio ${domain} - possível corrupção`);
      }

      logger.info('�o. DKIM keys generated successfully in transaction', { 
        domainId, 
        domain,
        privateKeyLength: dkimRecord.private_key.length,
        publicKeyLength: dkimRecord.public_key.length,
        hasPrivateKey: !!dkimRecord.private_key,
        hasPublicKey: !!dkimRecord.public_key
      });

      return {
        privateKey: dkimRecord.private_key,
        publicKey: dkimRecord.public_key
      };

    } catch (error) {
      logger.error('�O CRITICAL: Failed to generate DKIM keys in transaction', {
        domainId,
        domain,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Re-throw para fazer rollback da transação
      throw new Error(`Falha crítica na geração de DKIM: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Cria instruções DNS detalhadas para um domínio
   * 
   * @param domain - Nome do domínio
   * @param verificationToken - Token de verificação
   * @param dkimPublicKey - Chave pública DKIM
   * @returns Instruções DNS estruturadas
   */
  private createDNSInstructions(domainRecord: DomainRecord, dkimPublicKey: string): DNSInstructions {
    const mailFromDomain = this.getMailFromDomain(domainRecord.domain_name);
    const spfRecordValue = this.buildExpectedSpfRecord();
    const dmarcRecordValue = this.buildExpectedDmarcRecord(domainRecord.dmarc_policy);

    return {
      sending_domain: domainRecord.domain_name,
      mail_from_domain: mailFromDomain,
      mail_from_mx: {
        record: mailFromDomain,
        value: this.PLATFORM_MAIL_FROM_MX,
        priority: 10,
        description: 'Registro MX do subdominio tecnico de return-path. Ele recebe bounces sem tocar no MX principal do cliente.'
      },
      spf: {
        record: mailFromDomain,
        value: spfRecordValue,
        description: 'SPF do subdominio tecnico do Return-Path. Mantenha apenas um TXT SPF neste host.'
      },
      dkim: {
        record: `default._domainkey.${domainRecord.domain_name}`,
        value: `v=DKIM1; k=rsa; p=${dkimPublicKey}`,
        description: 'Chave DKIM do dominio de envio. Ela autentica o cabecalho From.'
      },
      dmarc: {
        record: `_dmarc.${domainRecord.domain_name}`,
        value: dmarcRecordValue,
        description: 'Politica DMARC do dominio de envio. O onboarding inicia em none para evitar impacto no mail flow existente.'
      },
      notes: [
        'Nao altere os registros @, www ou o MX principal do dominio.',
        'O subdominio tecnico de return-path e isolado do site e do email corporativo do cliente.',
        `Mantenha um unico registro SPF em ${mailFromDomain}. Se ja existir SPF neste host, mescle em um unico TXT.`,
        'DKIM no dominio principal + MAIL FROM tecnico formam o setup recomendado para email transacional.'
      ],
      deliverability_requirements: [
        'SPF, DKIM e DMARC devem estar validos antes do primeiro envio em producao.',
        'Use um remetente real do dominio autenticado (ex: no-reply@seu-dominio.com).',
        'Mantenha taxa de bounce baixa e remova contatos invalidos imediatamente.',
        'Evite picos bruscos de volume no primeiro dia; aqueça o dominio gradualmente.'
      ],
      recommended_practices: [
        'Para campanhas, inclua List-Unsubscribe e uma pagina de opt-out clara.',
        'Comece DMARC em none, monitore por 7-14 dias e avance para quarantine/reject.',
        'Use apenas listas com opt-in e nunca compre bases de contatos.',
        'Monitore reputacao em Google Postmaster e outros paines de entregabilidade.'
      ]
    };
  }

  /**
   * Gera guia passo a passo para configuração
   * 
   * @param domain - Nome do domínio
   * @returns Array de instruções
   */
  private generateSetupGuide(domainRecord: DomainRecord): string[] {
    const mailFromDomain = this.getMailFromDomain(domainRecord.domain_name);
    const spfRecordValue = this.buildExpectedSpfRecord();

    return [
      'CONFIGURACAO SEGURA - sem mexer no site ou no MX principal do cliente',
      '1. Acesse o provedor DNS do dominio.',
      '2. Mantenha intactos os registros @, www e o MX atual do dominio principal.',
      `3. Adicione o MX do subdominio tecnico ${mailFromDomain} apontando para ${this.PLATFORM_MAIL_FROM_MX}.`,
      `4. Publique um unico TXT SPF em ${mailFromDomain} com o valor: ${spfRecordValue}.`,
      `5. Adicione o TXT DKIM em default._domainkey.${domainRecord.domain_name}.`,
      `6. Adicione ou ajuste o TXT DMARC em _dmarc.${domainRecord.domain_name}.`,
      '7. Aguarde a propagacao DNS e execute a verificacao.',
      '8. Libere o envio somente quando MAIL FROM, SPF, DKIM e DMARC estiverem validos.'
    ];
  }

  private getMailFromDomain(domain: string): string {
    return buildManagedMailFromDomain(domain);
  }

  private parseCsvList(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private isValidIpv4(value: string): boolean {
    return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value);
  }

  private normalizeSpfToken(token: string): string {
    const normalized = token.trim().toLowerCase();
    if (['+', '-', '~', '?'].includes(normalized.charAt(0))) {
      return normalized.slice(1);
    }
    return normalized;
  }

  private hasSpfMechanism(tokens: string[], expectedMechanism: string): boolean {
    const expected = expectedMechanism.toLowerCase();
    return tokens.some((token) => this.normalizeSpfToken(token) === expected);
  }

  private getExpectedSpfMechanisms(): string[] {
    const mechanisms: string[] = [];
    const normalizedMxHost = this.normalizeDnsHostname(this.PLATFORM_MAIL_FROM_MX);

    if (normalizedMxHost) {
      mechanisms.push(`a:${normalizedMxHost}`);
    }

    this.ULTRAZEND_SPF_HOSTS.forEach((host) => {
      if (host) {
        mechanisms.push(`a:${host}`);
      }
    });

    this.ULTRAZEND_SPF_IPS.forEach((ip) => {
      mechanisms.push(`ip4:${ip}`);
    });

    if (this.ULTRAZEND_SPF_INCLUDE) {
      mechanisms.push(`include:${this.ULTRAZEND_SPF_INCLUDE}`);
    }

    return Array.from(new Set(mechanisms.map((item) => item.toLowerCase())));
  }

  private buildExpectedSpfRecord(): string {
    const mechanisms = this.getExpectedSpfMechanisms();
    return `v=spf1 ${mechanisms.join(' ')} -all`;
  }

  private buildExpectedDmarcRecord(policy: string): string {
    const parts = [`v=DMARC1`, `p=${policy}`];

    if (this.ULTRAZEND_DMARC_RUA) {
      parts.push(`rua=mailto:${this.ULTRAZEND_DMARC_RUA}`);
    }

    return parts.join('; ');
  }

  private normalizeDkimPublicKey(value: string | null | undefined): string {
    return (value || '').replace(/\s+/g, '').replace(/"/g, '').trim();
  }

  private extractDkimPublicKey(record: string): string {
    const match = record.match(/(?:^|;)\s*p=([^;]+)/i);
    return this.normalizeDkimPublicKey(match?.[1] || '');
  }

  private extractDmarcPolicy(record: string): string | null {
    const match = record.match(/(?:^|;)\s*p=([a-z]+)/i);
    return match?.[1]?.toLowerCase() || null;
  }

  private async getExpectedDkimPublicKey(domain: string, selector: string): Promise<string | null> {
    const dkimRecord = await db('dkim_keys')
      .join('domains', 'dkim_keys.domain_id', '=', 'domains.id')
      .where('domains.domain_name', domain)
      .where('dkim_keys.selector', selector)
      .where('dkim_keys.is_active', true)
      .select('dkim_keys.public_key')
      .orderBy('dkim_keys.created_at', 'desc')
      .first();

    const normalized = this.normalizeDkimPublicKey(dkimRecord?.public_key);
    return normalized || null;
  }

  /**
   * Verifica registro A de um subdomínio
   *
   * @param subdomain - Subdomínio completo (ex: smtp.exemplo.com)
   * @param expectedIp - IP esperado
   * @returns Resultado da verificação A
   */
  private async verifyARecord(subdomain: string, expectedIp: string): Promise<DNSVerificationResult> {
    try {
      logger.debug('Verifying A record', { subdomain, expectedIp });

      const aRecords = await this.resolveAWithRetry(subdomain);
      const hasExpectedIp = aRecords.includes(expectedIp);

      return {
        valid: hasExpectedIp,
        expectedValue: expectedIp,
        actualValue: aRecords.join(', '),
        error: hasExpectedIp ? undefined : `Registro A não encontrado ou IP incorreto para ${subdomain}`
      };
    } catch (error) {
      logger.debug('A record verification failed', {
        subdomain,
        expectedIp,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        valid: false,
        expectedValue: expectedIp,
        error: `Resolução DNS falhou: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Verifica o MX do subdominio tecnico de MAIL FROM / Return-Path.
   */
  private async verifyMailFromMxRecord(domain: string): Promise<DNSVerificationResult> {
    const mailFromDomain = this.getMailFromDomain(domain);
    const expectedMx = this.PLATFORM_MAIL_FROM_MX;

    try {
      logger.debug('Verifying mail-from MX record', { domain, mailFromDomain, expectedMx });

      const mxRecords = await this.resolveMxWithRetry(mailFromDomain);
      const hasExpectedMx = mxRecords.some(mx =>
        this.normalizeDnsHostname(mx.exchange) === this.normalizeDnsHostname(expectedMx)
      );

      return {
        valid: hasExpectedMx,
        expectedValue: expectedMx,
        actualValue: mxRecords.map(mx => `${mx.exchange} (${mx.priority})`).join(', '),
        error: hasExpectedMx ? undefined : `Registro MX tecnico nao aponta para ${expectedMx}`
      };
    } catch (error) {
      logger.debug('Mail-from MX verification failed', {
        domain,
        mailFromDomain,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        valid: false,
        expectedValue: expectedMx,
        error: `Resolucao DNS falhou: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Verifica registro SPF de um domínio
   *
   * @param domain - Nome do domínio
   * @returns Resultado da verificação SPF
   */
  private async verifySpfRecord(domain: string): Promise<DNSVerificationResult> {
    const mailFromDomain = this.getMailFromDomain(domain);
    const expectedValue = this.buildExpectedSpfRecord();
    const expectedMechanisms = this.getExpectedSpfMechanisms();
    
    try {
      logger.debug('Verifying SPF record', { domain, mailFromDomain, expectedValue });

      const txtRecords = await this.resolveTxtWithRetry(mailFromDomain);
      const spfRecords = txtRecords.filter(record =>
        record.toLowerCase().startsWith('v=spf1')
      );

      if (spfRecords.length === 0) {
        return {
          valid: false,
          expectedValue,
          error: 'No SPF record found'
        };
      }

      if (spfRecords.length > 1) {
        return {
          valid: false,
          expectedValue,
          actualValue: spfRecords.join(' | '),
          error: 'Multiple SPF records found'
        };
      }

      const spfRecord = spfRecords[0];
      const spfTokens = spfRecord
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);

      const missingMechanisms = expectedMechanisms.filter((mechanism) =>
        !this.hasSpfMechanism(spfTokens, mechanism)
      );
      const hasTerminalPolicy = spfTokens.some((token) => this.normalizeSpfToken(token) === 'all');
      const valid = missingMechanisms.length === 0 && hasTerminalPolicy;
      const missingDetails = missingMechanisms.length > 0
        ? `Missing mechanisms: ${missingMechanisms.join(', ')}`
        : '';
      const policyDetails = hasTerminalPolicy ? '' : 'Missing terminal all policy (-all or ~all)';
      const errorDetails = [missingDetails, policyDetails].filter(Boolean).join('. ');
      
      return {
        valid,
        expectedValue,
        actualValue: spfRecord,
        error: valid ? undefined : errorDetails || 'SPF record is incomplete'
      };
    } catch (error) {
      logger.debug('SPF verification failed', { 
        domain, 
        mailFromDomain,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        valid: false,
        expectedValue,
        error: `DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Verifica registro DKIM de um domínio
   * 
   * @param domain - Nome do domínio
   * @param selector - Seletor DKIM
   * @returns Resultado da verificação DKIM
   */
  private async verifyDkimRecord(domain: string, selector: string): Promise<DNSVerificationResult> {
    const dkimDomain = `${selector}._domainkey.${domain}`;
    
    try {
      logger.debug('Verifying DKIM record', { domain, selector, dkimDomain });

      const txtRecords = await this.resolveTxtWithRetry(dkimDomain);
      const dkimRecords = txtRecords.filter((record) =>
        record.toLowerCase().startsWith('v=dkim1')
      );

      if (dkimRecords.length === 0) {
        return {
          valid: false,
          expectedValue: 'v=DKIM1; k=rsa; p=<public_key>',
          error: 'No DKIM record found'
        };
      }

      // Verificar se tem chave pública
      if (dkimRecords.length > 1) {
        return {
          valid: false,
          expectedValue: 'Single DKIM TXT record for selector',
          actualValue: dkimRecords.join(' | '),
          error: 'Multiple DKIM records found for this selector'
        };
      }

      const dkimRecord = dkimRecords[0];
      const actualPublicKey = this.extractDkimPublicKey(dkimRecord);
      if (!actualPublicKey) {
        return {
          valid: false,
          expectedValue: 'v=DKIM1; k=rsa; p=<public_key>',
          actualValue: dkimRecord,
          error: 'DKIM record is missing public key'
        };
      }

      const expectedPublicKey = await this.getExpectedDkimPublicKey(domain, selector);
      const keyMatches = expectedPublicKey ? actualPublicKey === expectedPublicKey : true;

      return {
        valid: keyMatches,
        expectedValue: 'v=DKIM1; k=rsa; p=<public_key>',
        actualValue: dkimRecord,
        error: keyMatches ? undefined : 'DKIM public key mismatch for active selector'
      };
    } catch (error) {
      logger.debug('DKIM verification failed', { 
        domain, 
        selector,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        valid: false,
        expectedValue: 'v=DKIM1; k=rsa; p=<public_key>',
        error: `DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Verifica registro DMARC de um domínio
   * 
   * @param domain - Nome do domínio
   * @returns Resultado da verificação DMARC
   */
  private async verifyDmarcRecord(domain: string, policy: string): Promise<DNSVerificationResult> {
    const dmarcDomain = `_dmarc.${domain}`;
    const expectedValue = this.buildExpectedDmarcRecord(policy);
    
    try {
      logger.debug('Verifying DMARC record', { domain, dmarcDomain });

      const txtRecords = await this.resolveTxtWithRetry(dmarcDomain);
      const dmarcRecords = txtRecords.filter((record) =>
        record.toLowerCase().startsWith('v=dmarc1')
      );

      if (dmarcRecords.length === 0) {
        return {
          valid: false,
          expectedValue,
          error: 'No DMARC record found'
        };
      }

      if (dmarcRecords.length > 1) {
        return {
          valid: false,
          expectedValue,
          actualValue: dmarcRecords.join(' | '),
          error: 'Multiple DMARC records found'
        };
      }

      const dmarcRecord = dmarcRecords[0];
      const expectedPolicy = policy.toLowerCase();
      const actualPolicy = this.extractDmarcPolicy(dmarcRecord);
      const hasPolicy = actualPolicy === expectedPolicy;
      const error = !actualPolicy
        ? 'DMARC record is missing policy'
        : hasPolicy
          ? undefined
          : `DMARC policy mismatch. Expected p=${expectedPolicy}, found p=${actualPolicy}`;

      return {
        valid: hasPolicy,
        expectedValue,
        actualValue: dmarcRecord,
        error
      };
    } catch (error) {
      logger.debug('DMARC verification failed', { 
        domain,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        valid: false,
        expectedValue,
        error: `DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Verifica token de propriedade do domínio
   * 
   * @param domain - Nome do domínio
   * @param expectedToken - Token esperado
   * @returns Resultado da verificação
   */
  private async verifyDomainOwnership(domain: string, expectedToken: string): Promise<DNSVerificationResult> {
    const verificationDomain = `ultrazend-verification.${domain}`;
    
    try {
      logger.debug('Verifying domain ownership', { domain, verificationDomain });

      const txtRecords = await this.resolveTxtWithRetry(verificationDomain);
      const verificationRecord = txtRecords.find(record => 
        record.trim() === expectedToken
      );

      return {
        valid: !!verificationRecord,
        expectedValue: expectedToken,
        actualValue: verificationRecord,
        error: verificationRecord ? undefined : 'Verification token not found in DNS'
      };
    } catch (error) {
      logger.debug('Domain ownership verification failed', { 
        domain,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        valid: false,
        expectedValue: expectedToken,
        error: `DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Resolve registros TXT com retry automático
   * 
   * @param domain - Domínio a resolver
   * @returns Array de registros TXT
   */
  private async resolveTxtViaFallbackResolvers(domain: string): Promise<string[] | null> {
    if (!this.ENABLE_DNS_FALLBACK || this.DNS_FALLBACK_SERVERS.length === 0) {
      return null;
    }

    for (const resolverServer of this.DNS_FALLBACK_SERVERS) {
      try {
        const resolver = new dns.promises.Resolver();
        resolver.setServers([resolverServer]);

        const records = await Promise.race([
          resolver.resolveTxt(domain),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('DNS timeout')), this.DNS_TIMEOUT)
          )
        ]);

        const flattened = records.map((entry) => entry.join(''));
        if (flattened.length > 0) {
          logger.debug('DNS TXT resolution succeeded via fallback resolver', {
            domain,
            resolverServer,
            recordCount: flattened.length
          });
          return flattened;
        }
      } catch (error) {
        logger.debug('DNS TXT fallback resolver failed', {
          domain,
          resolverServer,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return null;
  }

  private async resolveTxtWithRetry(domain: string): Promise<string[]> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= this.MAX_DNS_RETRIES; attempt++) {
      try {
        logger.debug(`DNS resolution attempt ${attempt}/${this.MAX_DNS_RETRIES}`, { domain });
        
        const records = await Promise.race([
          resolveTxt(domain),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('DNS timeout')), this.DNS_TIMEOUT)
          )
        ]);

        return records.map(entry => entry.join(''));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug(`DNS resolution attempt ${attempt} failed`, { 
          domain, 
          error: lastError.message 
        });
        
        if (attempt < this.MAX_DNS_RETRIES) {
          // Aguardar antes da próxima tentativa
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    const fallbackRecords = await this.resolveTxtViaFallbackResolvers(domain);
    if (fallbackRecords && fallbackRecords.length > 0) {
      return fallbackRecords;
    }

    throw lastError || new Error('Resolução DNS falhou após tentativas');
  }

  /**
   * Resolve registros A com retry automático
   *
   * @param domain - Domínio a resolver
   * @returns Array de IPs
   */
  private async resolveAWithRetry(domain: string): Promise<string[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.MAX_DNS_RETRIES; attempt++) {
      try {
        logger.debug(`DNS A resolution attempt ${attempt}/${this.MAX_DNS_RETRIES}`, { domain });

        const records = await Promise.race([
          resolveA(domain),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('DNS timeout')), this.DNS_TIMEOUT)
          )
        ]);

        return records;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug(`DNS A resolution attempt ${attempt} failed`, {
          domain,
          error: lastError.message
        });

        if (attempt < this.MAX_DNS_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError || new Error('Resolução DNS A falhou após tentativas');
  }

  /**
   * Resolve registros MX com retry automático
   *
   * @param domain - Domínio a resolver
   * @returns Array de registros MX
   */
  private async resolveMxWithRetry(domain: string): Promise<{exchange: string, priority: number}[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.MAX_DNS_RETRIES; attempt++) {
      try {
        logger.debug(`DNS MX resolution attempt ${attempt}/${this.MAX_DNS_RETRIES}`, { domain });

        const records = await Promise.race([
          resolveMx(domain),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('DNS timeout')), this.DNS_TIMEOUT)
          )
        ]);

        return records;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug(`DNS MX resolution attempt ${attempt} failed`, {
          domain,
          error: lastError.message
        });

        if (attempt < this.MAX_DNS_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError || new Error('Resolução DNS MX falhou após tentativas');
  }

  /**
   * Processa resultado de Promise.allSettled
   * 
   * @param result - Resultado da promise
   * @param operation - Nome da operação
   * @returns Resultado processado
   */
  private processVerificationResult(
    result: PromiseSettledResult<DNSVerificationResult>,
    operation: string
  ): DNSVerificationResult {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    logger.debug(`${operation} verification rejected`, { reason: result.reason });

    return {
      valid: false,
      expectedValue: 'N/A',
      error: `${operation} verification failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
    };
  }

  private buildVerificationErrors(results: VerificationResult['results']): string[] {
    const labels = {
      mail_from_mx: 'MAIL FROM MX',
      spf: 'SPF',
      dkim: 'DKIM',
      dmarc: 'DMARC'
    } satisfies Record<keyof VerificationResult['results'], string>;

    return Object.entries(results)
      .filter(([, result]) => !result.valid)
      .map(([key, result]) => {
        const typedKey = key as keyof VerificationResult['results'];
        const details = result.error || `Expected ${result.expectedValue}`;
        return `${labels[typedKey]}: ${details}`;
      });
  }

  private normalizeDnsHostname(hostname: string): string {
    return hostname.trim().replace(/\.+$/, '').toLowerCase();
  }

  /**
   * Gera próximos passos baseado nos resultados da verificação
   * 
   * @param results - Resultados das verificações
   * @returns Array de próximos passos
   */
  private generateNextSteps(results: VerificationResult['results']): string[] {
    const steps: string[] = [];

    if (!results.mail_from_mx.valid) {
      steps.push('Adicione o MX do subdominio tecnico uz-mail.seudominio.com apontando para mail.velomail.com.br.');
    }

    if (!results.spf.valid) {
      steps.push('Publique um unico SPF no subdominio tecnico uz-mail.seudominio.com usando os mecanismos exibidos no assistente.');
    }

    if (!results.dkim.valid) {
      steps.push('Adicione ou atualize o registro DKIM em default._domainkey.seudominio.com.');
    }

    if (!results.dmarc.valid) {
      steps.push('Ajuste o DMARC em _dmarc.seudominio.com para a politica exibida no assistente.');
    }

    if (steps.length === 0) {
      steps.push('Todos os registros DNS foram verificados com sucesso. O dominio esta pronto para enviar emails.');
    } else {
      steps.push('Aguarde a propagacao DNS antes de verificar novamente.');
      steps.push('Nao altere o MX principal do dominio. Apenas o subdominio tecnico precisa apontar para a UltraZend.');
    }

    return steps;
  }

  /**
   * Verifica se um domínio já está configurado para o usuário
   * 
   * @param userId - ID do usuário
   * @param domain - Nome do domínio
   * @returns Domínio existente ou null
   */
  private async checkExistingDomain(userId: number, domain: string): Promise<DomainRecord | null> {
    const existing = await db('domains')
      .where('domain_name', domain)
      .first() as DomainRecord | undefined;

    return existing || null;
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    const databaseError = error as {
      code?: string;
      errno?: number;
      message?: string;
    };
    const message = String(databaseError?.message || '').toLowerCase();

    return databaseError?.code === '23505' ||
      databaseError?.code === 'SQLITE_CONSTRAINT' ||
      databaseError?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      databaseError?.code === 'ER_DUP_ENTRY' ||
      databaseError?.errno === 1062 ||
      (message.includes('unique') && message.includes('domain_name'));
  }

  /**
   * Verifica se formato do domínio é válido
   * 
   * @param domain - Domínio a verificar
   * @returns true se válido
   */
  private isValidDomainFormat(domain: string): boolean {
    return SimpleEmailValidator.isValidDomainFormat(domain);
  }

  /**
   * Verifica se é domínio interno UltraZend
   * 
   * @param domain - Domínio a verificar
   * @returns true se for interno
   */
  private isUltraZendDomain(domain: string): boolean {
    const ultraZendDomains = [
      'velomail.com.br',
      'mail.velomail.com.br',
      'www.velomail.com.br'
    ];
    
    return ultraZendDomains.includes(domain.toLowerCase());
  }

  /**
   * Verifica status do MX do subdominio tecnico de MAIL FROM.
   */
  private async checkMailFromStatus(domain: string) {
    try {
      const mailFromResult = await this.verifyMailFromMxRecord(domain);

      return {
        configured: Boolean(mailFromResult.actualValue),
        dns_valid: mailFromResult.valid,
        domain: this.getMailFromDomain(domain)
      };
    } catch (error) {
      return {
        configured: false,
        dns_valid: false,
        domain: this.getMailFromDomain(domain)
      };
    }
  }

  /**
   * Verifica status DKIM atual de um domínio
   * 
   * @param domain - Nome do domínio
   * @param selector - Seletor DKIM
   * @returns Status DKIM
   */
  private async checkDKIMStatus(domain: string, selector: string) {
    try {
      const dkimResult = await this.verifyDkimRecord(domain, selector);
      
      return {
        configured: Boolean(dkimResult.actualValue),
        public_key: dkimResult.actualValue,
        dns_valid: dkimResult.valid
      };
    } catch (error) {
      return {
        configured: false,
        dns_valid: false
      };
    }
  }

  /**
   * Verifica status SPF atual de um domínio
   * 
   * @param domain - Nome do domínio
   * @returns Status SPF
   */
  private async checkSPFStatus(domain: string) {
    try {
      const spfResult = await this.verifySpfRecord(domain);
      
      return {
        configured: Boolean(spfResult.actualValue),
        dns_valid: spfResult.valid
      };
    } catch (error) {
      return {
        configured: false,
        dns_valid: false
      };
    }
  }

  /**
   * Verifica status DMARC atual de um domínio
   * 
   * @param domain - Nome do domínio
   * @returns Status DMARC
   */
  private async checkDMARCStatus(domain: string, policy: string) {
    try {
      const dmarcResult = await this.verifyDmarcRecord(domain, policy);
      
      return {
        configured: Boolean(dmarcResult.actualValue),
        dns_valid: dmarcResult.valid
      };
    } catch (error) {
      return {
        configured: false,
        dns_valid: false
      };
    }
  }

  /**
   * Calcula status geral de um domínio
   * 
   * @param domain - Registro do domínio
   * @param dkimStatus - Status DKIM
   * @param spfStatus - Status SPF
   * @param dmarcStatus - Status DMARC
   * @returns Status geral
   */
  private calculateOverallStatus(
    domain: DomainRecord,
    mailFromStatus: any,
    dkimStatus: any,
    spfStatus: any,
    dmarcStatus: any
  ): 'pending' | 'partial' | 'verified' | 'failed' {
    const validChecks = [
      mailFromStatus.dns_valid,
      dkimStatus.dns_valid,
      spfStatus.dns_valid,
      dmarcStatus.dns_valid
    ].filter(Boolean).length;

    if (domain.is_verified || validChecks === 4) {
      return 'verified';
    }

    if (validChecks === 0) {
      return 'pending';
    } else if (validChecks < 4) {
      return 'partial';
    } else {
      return 'verified';
    }
  }

  /**
   * Calcula porcentagem de completude de um domínio
   * 
   * @param domain - Registro do domínio
   * @param dkimStatus - Status DKIM
   * @param spfStatus - Status SPF
   * @param dmarcStatus - Status DMARC
   * @returns Porcentagem de 0 a 100
   */
  private calculateCompletionPercentage(
    domain: DomainRecord,
    mailFromStatus: any,
    dkimStatus: any,
    spfStatus: any,
    dmarcStatus: any
  ): number {
    const totalChecks = 4;
    let completedChecks = 0;

    if (mailFromStatus.dns_valid) completedChecks++;
    if (dkimStatus.dns_valid) completedChecks++;
    if (spfStatus.dns_valid) completedChecks++;
    if (dmarcStatus.dns_valid) completedChecks++;

    if (domain.is_verified) {
      return 100;
    }

    return Math.round((completedChecks / totalChecks) * 100);
  }
}

// Preserve the historical singleton export without constructing DKIM/DNS
// dependencies merely because this module was imported. Consumers that use the
// singleton still receive the same DomainSetupService instance on first use.
let domainSetupServiceInstance: DomainSetupService | undefined;

export function getDomainSetupService(): DomainSetupService {
  if (!domainSetupServiceInstance) {
    domainSetupServiceInstance = new DomainSetupService();
  }

  return domainSetupServiceInstance;
}

export const domainSetupService = new Proxy({} as DomainSetupService, {
  get(_target, property) {
    const service = getDomainSetupService() as unknown as Record<PropertyKey, unknown>;
    const value = service[property];
    return typeof value === 'function' ? value.bind(service) : value;
  },
  set(_target, property, value) {
    const service = getDomainSetupService() as unknown as Record<PropertyKey, unknown>;
    service[property] = value;
    return true;
  }
});
