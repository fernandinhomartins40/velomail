import { Router, Response } from 'express';
import { AuthenticatedRequest, authenticateJWT, requirePermission } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';
import { DomainSetupService } from '../services/DomainSetupService';
import { MultiDomainDKIMManager } from '../services/MultiDomainDKIMManager';
import { logger } from '../config/logger';
import db from '../config/database';
import { z } from 'zod';
import { getAccountUserId } from '../utils/accountContext';
import { getRouteParam } from '../utils/routeParams';

const router = Router();

// Aplicar autenticação JWT para todas as rotas
router.use(authenticateJWT);

// Schemas de validação
const domainSetupSchema = z.object({
  domain: z.string()
    .min(3, 'Domain must be at least 3 characters')
    .max(253, 'Domain must be less than 253 characters')
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/, 'Invalid domain format')
    .transform(domain => domain.toLowerCase().trim())
});

const domainIdSchema = z.object({
  domainId: z.string().regex(/^\d+$/, 'Domain ID must be numeric').transform(Number)
});

const domainValidationSchema = z.object({
  domain: z.string()
    .min(3, 'Domain must be at least 3 characters')
    .max(253, 'Domain must be less than 253 characters')
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/, 'Invalid domain format')
    .transform(domain => domain.toLowerCase().trim())
});

const domainUpdateSchema = z.object({
  dkim_enabled: z.boolean().optional(),
  spf_enabled: z.boolean().optional(),
  dmarc_enabled: z.boolean().optional(),
  dmarc_policy: z.enum(['none', 'quarantine', 'reject']).optional()
});

/**
 * POST /api/domain-setup/setup
 * Inicia configuração de um novo domínio
 */
router.post('/setup', 
  requirePermission('domain:write'),
  validateRequest({ body: domainSetupSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { domain } = req.body;
    const userId = getAccountUserId(req);

    logger.info('Domain setup request received', { 
      userId, 
      domain,
      userAgent: req.headers['user-agent'],
      ip: req.ip 
    });

    try {
      const setupService = new DomainSetupService();
      const result = await setupService.initiateDomainSetup(userId, domain);

      // Não incluir dados sensíveis na resposta
      const response = {
        success: true,
        message: 'Domain setup initiated successfully',
        data: {
          domain: {
            id: result.domain.id,
            name: result.domain.domain_name,
            status: 'pending_verification',
            created_at: result.domain.created_at
          },
          dns_instructions: result.dns_instructions,
          setup_guide: result.setup_guide
        }
      };

      logger.info('Domain setup completed successfully', { 
        userId, 
        domain, 
        domainId: result.domain.id 
      });

      res.status(201).json(response);
    } catch (error) {
      logger.error('Domain setup failed', {
        userId,
        domain,
        error: error instanceof Error ? error.message : String(error)
      });

      // Retornar erro específico para o cliente
      if (error instanceof Error) {
        const planLimitReached = (error as any).code === 'PLAN_LIMIT_REACHED';
        res.status(planLimitReached ? 403 : 400).json({
          success: false,
          error: error.message,
          code: planLimitReached ? 'PLAN_LIMIT_REACHED' : 'DOMAIN_SETUP_FAILED'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'An unexpected error occurred during domain setup',
          code: 'INTERNAL_ERROR'
        });
      }
    }
  })
);

/**
 * POST /api/domain-setup/:domainId/verify
 * Verifica configuração DNS de um domínio
 */
router.post('/:domainId/verify',
  requirePermission('domain:write'),
  validateRequest({ params: domainIdSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const domainId = getRouteParam(req.params.domainId);
    const userId = getAccountUserId(req);

    logger.info('Domain verification request received', { 
      userId, 
      domainId,
      ip: req.ip 
    });

    try {
      const setupService = new DomainSetupService();
      const verification = await setupService.verifyDomainSetup(userId, domainId);

      const response = {
        success: verification.success,
        message: verification.all_passed ? 
          'Domain verification completed successfully' : 
          'Domain verification completed with issues',
        data: {
          domain: verification.domain,
          all_passed: verification.all_passed,
          verified_at: verification.verified_at,
          results: {
            mail_from_mx: {
              valid: verification.results.mail_from_mx.valid,
              status: verification.results.mail_from_mx.valid ? 'verified' : 'failed',
              expected: verification.results.mail_from_mx.expectedValue,
              found: verification.results.mail_from_mx.actualValue,
              error: verification.results.mail_from_mx.error
            },
            spf: {
              valid: verification.results.spf.valid,
              status: verification.results.spf.valid ? 'verified' : 'failed',
              expected: verification.results.spf.expectedValue,
              found: verification.results.spf.actualValue,
              error: verification.results.spf.error
            },
            dkim: {
              valid: verification.results.dkim.valid,
              status: verification.results.dkim.valid ? 'verified' : 'failed',
              expected: verification.results.dkim.expectedValue,
              found: verification.results.dkim.actualValue,
              error: verification.results.dkim.error
            },
            dmarc: {
              valid: verification.results.dmarc.valid,
              status: verification.results.dmarc.valid ? 'verified' : 'failed',
              expected: verification.results.dmarc.expectedValue,
              found: verification.results.dmarc.actualValue,
              error: verification.results.dmarc.error
            }
          },
          next_steps: verification.nextSteps
        }
      };

      logger.info('Domain verification completed', { 
        userId, 
        domainId,
        domain: verification.domain,
        allPassed: verification.all_passed,
        results: {
          mail_from_mx: verification.results.mail_from_mx.valid,
          spf: verification.results.spf.valid,
          dkim: verification.results.dkim.valid,
          dmarc: verification.results.dmarc.valid
        }
      });

      res.json(response);
    } catch (error) {
      logger.error('Domain verification failed', {
        userId,
        domainId,
        error: error instanceof Error ? error.message : String(error)
      });

      if (error instanceof Error) {
        res.status(400).json({
          success: false,
          error: error.message,
          code: 'DOMAIN_VERIFICATION_FAILED'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'An unexpected error occurred during domain verification',
          code: 'INTERNAL_ERROR'
        });
      }
    }
  })
);

/**
 * GET /api/domain-setup/domains
 * Obtém status de todos os domínios do usuário
 */
router.get('/domains', 
  requirePermission('domain:read'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getAccountUserId(req);

    logger.debug('Domains status request received', { userId });

    try {
      const setupService = new DomainSetupService();
      const domainsStatus = await setupService.getUserDomainsStatus(userId);

      const response = {
        success: true,
        message: 'Domains status retrieved successfully',
        data: {
          domains: domainsStatus.map(status => ({
            id: status.domain.id,
            name: status.domain.domain_name,
            status: status.overall_status,
            completion_percentage: status.completion_percentage,
            is_verified: status.domain.is_verified,
            created_at: status.domain.created_at,
            verified_at: status.domain.verified_at,
            dns_status: {
              mail_from: {
                configured: status.mail_from_status.configured,
                valid: status.mail_from_status.dns_valid,
                domain: status.mail_from_status.domain
              },
              dkim: {
                configured: status.dkim_status.configured,
                valid: status.dkim_status.dns_valid
              },
              spf: {
                configured: status.spf_status.configured,
                valid: status.spf_status.dns_valid
              },
              dmarc: {
                configured: status.dmarc_status.configured,
                valid: status.dmarc_status.dns_valid
              }
            }
          })),
          summary: {
            total: domainsStatus.length,
            verified: domainsStatus.filter(d => d.overall_status === 'verified').length,
            pending: domainsStatus.filter(d => d.overall_status === 'pending').length,
            partial: domainsStatus.filter(d => d.overall_status === 'partial').length,
            failed: domainsStatus.filter(d => d.overall_status === 'failed').length
          }
        }
      };

      logger.debug('Domains status retrieved successfully', { 
        userId,
        totalDomains: domainsStatus.length
      });

      res.json(response);
    } catch (error) {
      logger.error('Failed to retrieve domains status', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve domains status',
        code: 'DOMAINS_STATUS_FAILED'
      });
    }
  })
);

/**
 * GET /api/domain-setup/domains/:domainId
 * Obtém detalhes completos de um domínio específico
 */
router.get('/domains/:domainId',
  requirePermission('domain:read'),
  validateRequest({ params: domainIdSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const domainId = getRouteParam(req.params.domainId);
    const userId = getAccountUserId(req);

    logger.debug('Domain details request received', { userId, domainId });

    try {
      const setupService = new DomainSetupService();
      const domainsStatus = await setupService.getUserDomainsStatus(userId);
      
      const domainStatus = domainsStatus.find(d => d.domain.id === parseInt(domainId));
      
      if (!domainStatus) {
        return res.status(404).json({
          success: false,
          error: 'Domain not found or access denied',
          code: 'DOMAIN_NOT_FOUND'
        });
      }

      const response = {
        success: true,
        message: 'Domain details retrieved successfully',
        data: {
          domain: {
            id: domainStatus.domain.id,
            name: domainStatus.domain.domain_name,
            status: domainStatus.overall_status,
            completion_percentage: domainStatus.completion_percentage,
            is_verified: domainStatus.domain.is_verified,
            verification_method: domainStatus.domain.verification_method,
            created_at: domainStatus.domain.created_at,
            updated_at: domainStatus.domain.updated_at,
            verified_at: domainStatus.domain.verified_at
          },
          configuration: {
            mail_from: {
              enabled: true,
              domain: domainStatus.mail_from_status.domain,
              configured: domainStatus.mail_from_status.configured,
              dns_valid: domainStatus.mail_from_status.dns_valid,
              mx_target: 'mail.velomail.com.br'
            },
            dkim: {
              enabled: true,
              selector: domainStatus.domain.dkim_selector,
              configured: domainStatus.dkim_status.configured,
              dns_valid: domainStatus.dkim_status.dns_valid,
              public_key: domainStatus.dkim_status.public_key
            },
            spf: {
              enabled: true,
              configured: domainStatus.spf_status.configured,
              dns_valid: domainStatus.spf_status.dns_valid
            },
            dmarc: {
              enabled: true,
              policy: domainStatus.domain.dmarc_policy,
              configured: domainStatus.dmarc_status.configured,
              dns_valid: domainStatus.dmarc_status.dns_valid
            }
          }
        }
      };

      logger.debug('Domain details retrieved successfully', { 
        userId,
        domainId,
        domainName: domainStatus.domain.domain_name
      });

      res.json(response);
    } catch (error) {
      logger.error('Failed to retrieve domain details', {
        userId,
        domainId,
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve domain details',
        code: 'DOMAIN_DETAILS_FAILED'
      });
    }
  })
);

/**
 * DELETE /api/domain-setup/domains/:domainId
 * Remove um domínio (marca como inativo)
 */
router.delete('/domains/:domainId',
  requirePermission('domain:write'),
  validateRequest({ params: domainIdSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const domainId = getRouteParam(req.params.domainId);
    const userId = getAccountUserId(req);

    logger.info('Domain removal request received', { userId, domainId });

    try {
      const setupService = new DomainSetupService();
      const removed = await setupService.removeDomain(userId, domainId);

      if (!removed) {
        return res.status(404).json({
          success: false,
          error: 'Domain not found or could not be removed',
          code: 'DOMAIN_REMOVAL_FAILED'
        });
      }

      logger.info('Domain removed successfully', { userId, domainId });

      res.json({
        success: true,
        message: 'Domain removed successfully',
        data: {
          domainId,
          removed_at: new Date()
        }
      });
    } catch (error) {
      logger.error('Failed to remove domain', {
        userId,
        domainId,
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: 'Failed to remove domain',
        code: 'DOMAIN_REMOVAL_ERROR'
      });
    }
  })
);

/**
 * POST /api/domain-setup/domains/:domainId/regenerate-dkim
 * Regenera chaves DKIM para um domínio
 */
router.post('/domains/:domainId/regenerate-dkim',
  requirePermission('domain:write'),
  validateRequest({ params: domainIdSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const domainId = getRouteParam(req.params.domainId);
    const userId = getAccountUserId(req);

    logger.info('DKIM regeneration request received', { userId, domainId });

    try {
      // Buscar domínio para verificar propriedade
      const domainRecord = await db('domains')
        .where('id', domainId)
        .where('user_id', userId)
        .first();

      if (!domainRecord) {
        return res.status(404).json({
          success: false,
          error: 'Domain not found or access denied',
          code: 'DOMAIN_NOT_FOUND'
        });
      }

      // Regenerar chaves DKIM
      const dkimManager = new MultiDomainDKIMManager();
      const regenerated = await dkimManager.regenerateDKIMKeysForDomain(domainRecord.domain_name);

      if (!regenerated) {
        return res.status(500).json({
          success: false,
          error: 'Failed to regenerate DKIM keys',
          code: 'DKIM_REGENERATION_FAILED'
        });
      }

      // Buscar nova chave pública
      const newDkimKey = await db('dkim_keys')
        .where('domain_id', domainId)
        .first();

      logger.info('DKIM keys regenerated successfully', { 
        userId, 
        domainId,
        domainName: domainRecord.domain_name
      });

      res.json({
        success: true,
        message: 'DKIM keys regenerated successfully',
        data: {
          domain: domainRecord.domain_name,
          new_public_key: newDkimKey?.public_key,
          regenerated_at: new Date(),
          dns_update_required: true,
          new_dns_record: {
            record: `default._domainkey.${domainRecord.domain_name}`,
            value: `v=DKIM1; k=rsa; p=${newDkimKey?.public_key}`
          }
        }
      });
    } catch (error) {
      logger.error('Failed to regenerate DKIM keys', {
        userId,
        domainId,
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: 'Failed to regenerate DKIM keys',
        code: 'DKIM_REGENERATION_ERROR'
      });
    }
  })
);

/**
 * GET /api/domain-setup/dns-instructions/:domainId
 * Obtém instruções DNS atualizadas para um domínio
 */
router.get('/dns-instructions/:domainId',
  requirePermission('domain:read'),
  validateRequest({ params: domainIdSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const domainId = getRouteParam(req.params.domainId);
    const userId = getAccountUserId(req);

    logger.debug('DNS instructions request received', { userId, domainId });

    try {
      // Buscar domínio e chaves DKIM
      const domainRecord = await db('domains')
        .where('id', domainId)
        .where('user_id', userId)
        .first();

      if (!domainRecord) {
        return res.status(404).json({
          success: false,
          error: 'Domain not found or access denied',
          code: 'DOMAIN_NOT_FOUND'
        });
      }

      const dkimKey = await db('dkim_keys')
        .where('domain_id', domainId)
        .first();

      if (!dkimKey) {
        return res.status(404).json({
          success: false,
          error: 'DKIM keys not found for this domain',
          code: 'DKIM_NOT_FOUND'
        });
      }

      // Criar instruções DNS usando o mesmo método do DomainSetupService
      const setupService = new DomainSetupService();
      const dnsInstructions = setupService['createDNSInstructions'](
        domainRecord,
        dkimKey.public_key
      );

      const response = {
        success: true,
        message: 'DNS instructions retrieved successfully',
        data: {
          domain: domainRecord.domain_name,
          instructions: dnsInstructions,
          setup_guide: setupService['generateSetupGuide'](domainRecord),
          last_updated: new Date()
        }
      };

      res.json(response);
    } catch (error) {
      logger.error('Failed to retrieve DNS instructions', {
        userId,
        domainId,
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve DNS instructions',
        code: 'DNS_INSTRUCTIONS_FAILED'
      });
    }
  })
);

/**
 * PUT /api/domain-setup/domains/:domainId
 * Atualiza configurações de um domínio existente
 */
router.put('/domains/:domainId',
  requirePermission('domain:write'),
  validateRequest({ params: domainIdSchema, body: domainUpdateSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const domainId = getRouteParam(req.params.domainId);
    const userId = getAccountUserId(req);
    const { dkim_enabled, spf_enabled, dmarc_enabled, dmarc_policy } = req.body;

    logger.debug('Domain update request received', { userId, domainId, updates: req.body });

    try {
      // Verificar se domínio pertence ao usuário
      const domain = await db('domains')
        .where('id', domainId)
        .where('user_id', userId)
        .first();

      if (!domain) {
        return res.status(404).json({
          success: false,
          error: 'Domínio não encontrado ou acesso negado',
          code: 'DOMAIN_NOT_FOUND'
        });
      }

      // Atualizar configurações do domínio
      await db('domains')
        .where('id', domainId)
        .update({
          dkim_enabled: typeof dkim_enabled === 'boolean' ? dkim_enabled : domain.dkim_enabled,
          spf_enabled: typeof spf_enabled === 'boolean' ? spf_enabled : domain.spf_enabled,
          dmarc_enabled: typeof dmarc_enabled === 'boolean' ? dmarc_enabled : domain.dmarc_enabled,
          dmarc_policy: dmarc_policy ?? domain.dmarc_policy,
          updated_at: new Date()
        });

      logger.info('Domain updated successfully', {
        userId,
        domainId,
        domainName: domain.domain_name,
        updates: { dkim_enabled, spf_enabled, dmarc_enabled, dmarc_policy }
      });

      res.json({
        success: true,
        message: 'Configurações do domínio atualizadas com sucesso',
        data: {
          domainId: parseInt(domainId),
          updated_at: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to update domain', {
        userId,
        domainId,
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: 'Falha ao atualizar configurações do domínio',
        code: 'DOMAIN_UPDATE_FAILED'
      });
    }
  })
);

/**
 * POST /api/domain-setup/validate
 * Valida um domínio antes de configurá-lo
 */
router.post('/validate',
  requirePermission('domain:write'),
  validateRequest({ body: domainValidationSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { domain } = req.body;
    const userId = getAccountUserId(req);

    logger.debug('Domain validation request received', { userId, domain });

    try {
      // Verificar se domínio já está cadastrado pelo usuário
      const existingDomain = await db('domains')
        .where('domain_name', domain)
        .where('user_id', userId)
        .first();

      if (existingDomain) {
        return res.json({
          success: true,
          data: {
            valid: false,
            domain,
            available: false,
            message: 'Este domínio já está cadastrado em sua conta',
            reason: 'DOMAIN_ALREADY_EXISTS',
            existing_status: existingDomain.is_verified ? 'verified' : 'pending'
          }
        });
      }

      // Verificar se domínio está sendo usado por outro usuário
      const domainInUse = await db('domains')
        .where('domain_name', domain)
        .first();

      if (domainInUse) {
        return res.json({
          success: true,
          data: {
            valid: false,
            domain,
            available: false,
            message: 'Este domínio já está sendo usado por outra conta',
            reason: 'DOMAIN_IN_USE'
          }
        });
      }

      // Validação adicional de formato (já validada pelo schema, mas reforçando)
      const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
      if (!domainRegex.test(domain)) {
        return res.json({
          success: true,
          data: {
            valid: false,
            domain,
            available: false,
            message: 'Formato de domínio inválido',
            reason: 'INVALID_FORMAT'
          }
        });
      }

      // Verificar TLD válido (lista básica)
      const validTlds = ['.com', '.net', '.org', '.edu', '.gov', '.mil', '.br', '.co.uk', 
                        '.de', '.fr', '.it', '.es', '.nl', '.au', '.ca', '.jp', '.cn', 
                        '.in', '.ru', '.mx', '.ar', '.cl', '.pe', '.co', '.io', '.me', 
                        '.tv', '.info', '.biz', '.name', '.pro'];
      
      const hasValidTld = validTlds.some(tld => domain.toLowerCase().endsWith(tld));
      
      if (!hasValidTld) {
        return res.json({
          success: true,
          data: {
            valid: false,
            domain,
            available: false,
            message: 'Extensão de domínio não suportada',
            reason: 'UNSUPPORTED_TLD'
          }
        });
      }

      // Validações básicas de segurança
      const forbiddenPatterns = ['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'test.com'];
      const isForbidden = forbiddenPatterns.some(pattern => domain.toLowerCase().includes(pattern));
      
      if (isForbidden) {
        return res.json({
          success: true,
          data: {
            valid: false,
            domain,
            available: false,
            message: 'Este domínio não pode ser usado',
            reason: 'FORBIDDEN_DOMAIN'
          }
        });
      }

      // Se chegou até aqui, domínio é válido e disponível
      logger.info('Domain validation successful', { userId, domain });

      res.json({
        success: true,
        data: {
          valid: true,
          domain,
          available: true,
          message: 'Domínio válido e disponível para configuração',
          reason: 'VALID_AND_AVAILABLE',
          next_steps: [
            'Clique em "Configurar Domínio" para prosseguir',
            'Você receberá instruções DNS detalhadas',
            'Configure os registros DNS em seu provedor',
            'Execute a verificação DNS'
          ]
        }
      });

    } catch (error) {
      logger.error('Domain validation failed', {
        userId,
        domain,
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: 'Failed to validate domain',
        code: 'DOMAIN_VALIDATION_ERROR'
      });
    }
  })
);

export default router;
