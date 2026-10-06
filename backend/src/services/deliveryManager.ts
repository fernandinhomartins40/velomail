import { logger } from '../config/logger';
import { ReputationManager } from './reputationManager';
import { DKIMManager } from './dkimManager';
import { SecurityManager } from './securityManager';
import { TenantContextService } from './TenantContextService';
import { createTransport, Transporter, SendMailOptions } from 'nodemailer';
import { simpleParser } from 'mailparser';
import db from '../config/database';
import { Env } from '../utils/env';
import { getNextDeliveryAttempt } from '../utils/deliveryAttempts';

export interface DeliveryConfig {
  maxConcurrentDeliveries: number;
  retryAttempts: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  maxRetryDelayMs: number;
  deliveryTimeout: number;
  enableFeedbackLoop: boolean;
  enableBounceHandling: boolean;
}

export interface EmailDelivery {
  id?: number;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  headers: any;
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'bounced' | 'deferred';
  attempts: number;
  lastAttempt?: Date;
  nextAttempt?: Date;
  errorMessage?: string;
  deliveredAt?: Date;
  priority: number;
  userId?: number;
  campaignId?: number;
  bounceType?: string;
  deliveryReport?: any;
}

export interface DeliveryResult {
  success: boolean;
  messageId?: string;
  errorMessage?: string;
  bounced?: boolean;
  bounceType?: string;
  statusCode?: number;
  enhancedStatusCode?: string;
  deliveryTime?: number;
}

export interface DeliveryQueueStats {
  pending: number;
  processing: number;
  delivered: number;
  failed: number;
  bounced: number;
  deferred: number;
  totalToday: number;
  averageDeliveryTime: number;
}

// 🔥 NOVA INTERFACE: Stats por tenant
export interface TenantDeliveryStats {
  tenantId: number;
  pending: number;
  processing: number;
  delivered: number;
  failed: number;
  bounced: number;
  deferred: number;
  totalToday: number;
  averageDeliveryTime: number;
  rateLimitsRemaining: {
    daily: number;
    hourly: number;
    perMinute: number;
  };
}

export class DeliveryManager {
  private config: DeliveryConfig;
  private reputationManager: ReputationManager;
  private dkimManager: DKIMManager;
  private securityManager: SecurityManager;
  private tenantContextService: TenantContextService; // 🔥 NOVO: Tenant context service
  private isProcessing = false;
  private isPollingDeliveryQueue = false;
  private activeDeliveries = 0;
  private deliveryQueue: Map<number, NodeJS.Timeout> = new Map();
  private processorInterval?: NodeJS.Timeout;
  private transporter: Transporter;
  private tenantProcessors: Map<number, NodeJS.Timeout> = new Map(); // 🔥 NOVO: Processadores por tenant

  constructor(
    reputationManager: ReputationManager,
    dkimManager: DKIMManager,
    securityManager: SecurityManager,
    tenantContextService: TenantContextService, // 🔥 NOVO: Parâmetro tenant context service
    config: Partial<DeliveryConfig> = {}
  ) {
    this.config = {
      maxConcurrentDeliveries: 10,
      retryAttempts: 5,
      retryDelayMs: 60000, // 1 minuto
      backoffMultiplier: 2,
      maxRetryDelayMs: 3600000, // 1 hora
      deliveryTimeout: 30000, // 30 segundos
      enableFeedbackLoop: true,
      enableBounceHandling: true,
      ...config
    };

    this.reputationManager = reputationManager;
    this.dkimManager = dkimManager;
    this.securityManager = securityManager;
    this.tenantContextService = tenantContextService; // 🔥 NOVO: Inicializar tenant context service

    this.setupTransporter();
    this.validateRequiredTables();
    this.startTenantAwareDeliveryProcessor(); // 🔥 NOVO: Processador tenant-aware
  }

  private setupTransporter(): void {
    this.transporter = createTransport({
      host: Env.get('SMTP_HOST', 'localhost'),
      port: Env.getNumber('SMTP_PORT', 25),
      secure: false, // Use STARTTLS
      requireTLS: true,
      auth: Env.isDevelopment ? undefined : {
        user: Env.get('SMTP_USER'),
        pass: Env.get('SMTP_PASS')
      },
      connectionTimeout: this.config.deliveryTimeout,
      greetingTimeout: this.config.deliveryTimeout,
      socketTimeout: this.config.deliveryTimeout,
      logger: false,
      debug: false
    });
  }

  // 🔥 NOVO MÉTODO: Queue email com validação de tenant
  public async queueEmail(emailData: Partial<EmailDelivery>): Promise<number> {
    try {
      // 🔥 CRÍTICO: Validar tenant obrigatório
      if (!emailData.userId) {
        throw new Error('Missing required tenant userId for email delivery');
      }

      // Validar dados obrigatórios
      if (!emailData.from || !emailData.to || !emailData.subject || !emailData.body) {
        throw new Error('Missing required email fields');
      }

      // 🔥 NOVO: Validar contexto e permissões do tenant
      const tenantContext = await this.tenantContextService.getTenantContext(emailData.userId);
      if (!tenantContext.isActive) {
        throw new Error(`Tenant ${emailData.userId} is inactive and cannot send emails`);
      }

      // 🔥 NOVO: Validar se tenant pode enviar este email
      const canSendEmail = await this.tenantContextService.validateTenantOperation(
        emailData.userId,
        {
          operation: 'send_email',
          resource: emailData.from.split('@')[1],
          type: 'email_send',
          // Cota já validada na aceitação (emailProcessor); aqui só bloqueios.
          metadata: { stage: 'delivery' },
          data: {
            from: emailData.from,
            to: emailData.to,
            domain: emailData.from.split('@')[1]
          }
        }
      );

      if (!canSendEmail.allowed) {
        throw new Error(`Tenant ${emailData.userId} cannot send email: ${canSendEmail.reason}`);
      }

      // Gerar messageId se não fornecido
      if (!emailData.messageId) {
        emailData.messageId = this.generateMessageId(emailData.from);
      }

      // Verificar reputação do domínio antes de enfileirar
      const domain = this.extractDomain(emailData.to);
      const reputationCheck = await this.reputationManager.checkDeliveryAllowed(domain);
      
      if (!reputationCheck.allowed && reputationCheck.recommendations?.includes('block')) {
        throw new Error(`Delivery blocked for domain ${domain}: ${reputationCheck.reason}`);
      }

      // Determinar prioridade baseada na reputação e tenant
      const priority = this.calculateTenantPriority(reputationCheck, tenantContext, emailData.priority || 0);

      // Inserir na fila de entrega
      const [deliveryId] = await db('email_delivery_queue').insert({
        message_id: emailData.messageId,
        from_address: emailData.from,
        to_address: emailData.to,
        subject: emailData.subject,
        body: emailData.body,
        headers: JSON.stringify(emailData.headers || {}),
        status: 'pending',
        attempts: 0,
        priority,
        user_id: emailData.userId,
        campaign_id: emailData.campaignId,
        created_at: new Date(),
        next_attempt: new Date()
      });

      logger.info('Email queued for delivery', {
        deliveryId,
        tenantId: emailData.userId, // 🔥 NOVO: Log do tenant
        messageId: emailData.messageId,
        from: emailData.from,
        to: emailData.to,
        priority
      });

      return deliveryId;

    } catch (error) {
      logger.error('Failed to queue email', { error, emailData });
      throw error;
    }
  }

  // 🔥 NOVO MÉTODO: Process delivery com validação de tenant
  public async processDelivery(deliveryId: number, tenantId?: number): Promise<DeliveryResult> {
    try {
      // 🔥 CRÍTICO: Buscar email na fila COM validação de tenant
      let deliveryQuery = db('email_delivery_queue')
        .where('id', deliveryId)
        .where('status', 'pending');

      // Se tenantId fornecido, garantir que delivery pertence ao tenant
      if (tenantId) {
        deliveryQuery.where('user_id', tenantId);
      }

      const delivery = await deliveryQuery.first();

      if (!delivery) {
        const errorMsg = tenantId 
          ? `Delivery ${deliveryId} not found for tenant ${tenantId} or not pending`
          : `Delivery ${deliveryId} not found or not pending`;
        throw new Error(errorMsg);
      }

      // 🔥 NOVO: Validar contexto do tenant do delivery
      if (delivery.user_id) {
        const tenantContext = await this.tenantContextService.getTenantContext(delivery.user_id);
        if (!tenantContext.isActive) {
          throw new Error(`Tenant ${delivery.user_id} is inactive, cannot process delivery`);
        }
      }

      // O predicado de status transforma a atualizaÃ§Ã£o em um claim atÃ´mico:
      // somente uma rÃ©plica pode sair de pending para processing.
      const attempts = getNextDeliveryAttempt(delivery.attempts);
      const claimed = await db('email_delivery_queue')
        .where('id', deliveryId)
        .where('status', 'pending')
        .update({
          status: 'processing',
          last_attempt: new Date(),
          attempts
        });

      if (!claimed) {
        throw new Error(`Delivery ${deliveryId} was already claimed by another worker`);
      }

      delivery.attempts = attempts;

      this.activeDeliveries++;

      try {
        // 🔥 NOVO: Verificar reputação e validação de tenant antes da entrega
        const domain = this.extractDomain(delivery.to_address);
        const reputationCheck = await this.reputationManager.checkDeliveryAllowed(domain);

        if (!reputationCheck.allowed) {
          throw new Error(`Delivery not allowed for domain ${domain}: ${reputationCheck.reason}`);
        }

        // 🔥 NOVO: Re-validar se tenant ainda pode enviar este email
        if (delivery.user_id) {
          const canStillSend = await this.tenantContextService.validateTenantOperation(
            delivery.user_id,
            {
              operation: 'send_email',
              resource: delivery.from_address.split('@')[1],
              type: 'email_send',
              metadata: { stage: 'delivery' },
              data: {
                from: delivery.from_address,
                to: delivery.to_address,
                domain: delivery.from_address.split('@')[1]
              }
            }
          );

          if (!canStillSend.allowed) {
            throw new Error(`Tenant ${delivery.user_id} can no longer send this email: ${canStillSend.reason}`);
          }
        }

        // Assinar email com DKIM
        const signedEmailData = await this.dkimManager.signEmail({
          from: delivery.from_address,
          to: delivery.to_address,
          subject: delivery.subject,
          body: delivery.body,
          headers: this.parseDeliveryHeaders(delivery.headers)
        });

        // Preparar opções de envio
        const mailOptions: SendMailOptions = {
          from: delivery.from_address,
          to: delivery.to_address,
          subject: delivery.subject,
          text: delivery.body,
          html: delivery.body,
          headers: signedEmailData.headers,
          messageId: delivery.message_id
        };

        // Realizar entrega
        const startTime = Date.now();
        const result = await this.transporter.sendMail(mailOptions);
        const deliveryTime = Date.now() - startTime;

        // Registrar entrega bem-sucedida
        await this.handleSuccessfulDelivery(deliveryId, result, deliveryTime);
        
        // Atualizar reputação
        await this.reputationManager.recordSuccessfulDelivery(domain, 'localhost', deliveryTime);

        logger.info('Email delivered successfully', {
          deliveryId,
          tenantId: delivery.user_id, // 🔥 NOVO: Log do tenant
          messageId: delivery.message_id,
          to: delivery.to_address,
          deliveryTime
        });

        return {
          success: true,
          messageId: result.messageId,
          deliveryTime
        };

      } catch (error) {
        // Tratar erro de entrega
        await this.handleDeliveryFailure(deliveryId, delivery, error);
        
        // Atualizar reputação negativa
        const domain = this.extractDomain(delivery.to_address);
        await this.reputationManager.recordFailedDelivery(domain, (error as Error).message, 'smtp_error');

        return {
          success: false,
          errorMessage: (error as Error).message
        };
      } finally {
        this.activeDeliveries--;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error processing delivery', { error: errorMessage, deliveryId });
      return {
        success: false,
        errorMessage
      };
    }
  }

  private async handleSuccessfulDelivery(
    deliveryId: number,
    result: any,
    deliveryTime: number
  ): Promise<void> {
    await db('email_delivery_queue')
      .where('id', deliveryId)
      .update({
        status: 'delivered',
        delivered_at: new Date(),
        delivery_time: deliveryTime,
        delivery_report: JSON.stringify(result)
      });

    // Registrar estatística de entrega
    await db('delivery_stats').insert({
      delivery_id: deliveryId,
      status: 'delivered',
      delivery_time: deliveryTime,
      created_at: new Date()
    });
  }

  private async handleDeliveryFailure(
    deliveryId: number,
    delivery: any,
    error: any
  ): Promise<void> {
    const maxAttempts = this.config.retryAttempts;
    const attempts = Number(delivery.attempts || 0);

    if (attempts >= maxAttempts) {
      // Falha permanente
      await db('email_delivery_queue')
        .where('id', deliveryId)
        .update({
          status: 'failed',
          error_message: (error as Error).message,
          next_attempt: null
        });

      await this.recordDeadLetter(delivery, (error as Error).message);

      logger.warn('Email delivery permanently failed', {
        deliveryId,
        messageId: delivery.message_id,
        attempts,
        error: error.message
      });
    } else {
      // Programar nova tentativa
      const delay = this.calculateRetryDelay(attempts);
      const nextAttempt = new Date(Date.now() + delay);

      await db('email_delivery_queue')
        .where('id', deliveryId)
        .update({
          status: 'pending',
          error_message: (error as Error).message,
          next_attempt: nextAttempt
        });

      // Programar nova tentativa
      this.scheduleRetry(deliveryId, delay);

      logger.info('Email delivery scheduled for retry', {
        deliveryId,
        attempt: attempts,
        nextAttempt,
        delay
      });
    }

    // Registrar estatística de falha
    await db('delivery_stats').insert({
      delivery_id: deliveryId,
      status: 'failed',
      error_message: error.message,
      created_at: new Date()
    });
  }

  /**
   * PostgreSQL returns JSON columns as objects while legacy SQLite rows keep
   * serialized strings. Both representations are valid delivery headers.
   */
  private parseDeliveryHeaders(headers: unknown): Record<string, unknown> {
    if (headers === null || headers === undefined || headers === '') {
      return {};
    }

    if (typeof headers === 'string') {
      const parsed = JSON.parse(headers) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw new Error('Delivery headers must be a JSON object');
    }

    if (typeof headers === 'object' && !Array.isArray(headers)) {
      return headers as Record<string, unknown>;
    }

    throw new Error('Delivery headers must be a JSON object');
  }

  private async recordDeadLetter(delivery: any, errorMessage: string): Promise<void> {
    try {
      await db('queue_job_failures').insert({
        job_id: String(delivery.id),
        queue_name: 'email_delivery_queue',
        job_name: 'smtp_delivery',
        job_data: JSON.stringify({
          messageId: delivery.message_id,
          userId: delivery.user_id
        }),
        error_message: errorMessage,
        attempts: Number(delivery.attempts || 0),
        failed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      });
    } catch (deadLetterError) {
      logger.error('Failed to record delivery dead letter', {
        deliveryId: delivery.id,
        error: deadLetterError instanceof Error ? deadLetterError.message : 'Unknown error'
      });
    }
  }

  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.config.retryDelayMs;
    const exponentialDelay = baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    
    // Adicionar jitter para evitar thundering herd
    const jitter = Math.random() * 0.1 * exponentialDelay;
    
    return Math.min(exponentialDelay + jitter, this.config.maxRetryDelayMs);
  }

  private scheduleRetry(deliveryId: number, delay: number): void {
    const timeout = setTimeout(() => {
      this.deliveryQueue.delete(deliveryId);
      this.processDelivery(deliveryId);
    }, delay);

    this.deliveryQueue.set(deliveryId, timeout);
  }

  private generateMessageId(fromAddress: string): string {
    const domain = this.extractDomain(fromAddress);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `<${timestamp}.${random}@${domain}>`;
  }

  private extractDomain(email: string): string {
    return email.split('@')[1] || 'unknown';
  }

  // 🔥 NOVO MÉTODO: Calcular prioridade baseada em tenant e reputação
  private calculateTenantPriority(reputationCheck: any, tenantContext: any, basePriority: number): number {
    let priority = basePriority;
    
    // Prioridade baseada na reputação do domínio
    if (reputationCheck.score > 0.8) {
      priority += 10; // Alta prioridade para domínios com boa reputação
    } else if (reputationCheck.score < 0.3) {
      priority -= 10; // Baixa prioridade para domínios com má reputação
    }

    // 🔥 NOVO: Prioridade baseada no plano do tenant
    if (tenantContext.plan === 'enterprise') {
      priority += 20; // Máxima prioridade para enterprise
    } else if (tenantContext.plan === 'professional') {
      priority += 10; // Alta prioridade para professional
    } else if (tenantContext.plan === 'basic') {
      priority += 0; // Prioridade padrão para basic
    }

    // 🔥 NOVO: Ajustar prioridade baseada no histórico do tenant
    if (tenantContext.reputation && tenantContext.reputation > 0.9) {
      priority += 5; // Bonus para tenants com histórico excelente
    }

    return Math.max(0, Math.min(100, priority));
  }

  // 🔥 NOVO MÉTODO: Processador de entrega tenant-aware
  private async startTenantAwareDeliveryProcessor(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    this.processorInterval = setInterval(() => {
      void this.runTenantAwareDeliveryCycle();
    }, 5000); // Verificar a cada 5 segundos

    logger.info('Tenant-aware delivery processor started');
  }

  private async runTenantAwareDeliveryCycle(): Promise<void> {
    if (this.isPollingDeliveryQueue) {
      logger.debug('Skipping overlapping tenant-aware delivery cycle');
      return;
    }

    this.isPollingDeliveryQueue = true;

    try {
      await this.recoverStaleDeliveries();

      if (this.activeDeliveries >= this.config.maxConcurrentDeliveries) {
        return;
      }

      // Descobrir tenants ativos e processar por tenant
      const activeTenants = await this.discoverTenantsWithPendingDeliveries();

      for (const tenantId of activeTenants) {
        if (this.activeDeliveries >= this.config.maxConcurrentDeliveries) {
          break;
        }

        try {
          await this.processTenantDeliveries(tenantId);
        } catch (error) {
          logger.error(`Error processing deliveries for tenant ${tenantId}`, { error, tenantId });
        }
      }
    } catch (error) {
      logger.error('Error in tenant-aware delivery processor', { error });
    } finally {
      this.isPollingDeliveryQueue = false;
    }
  }

  private async recoverStaleDeliveries(): Promise<void> {
    const staleBefore = new Date(Date.now() - (this.config.deliveryTimeout * 2));
    const staleDeliveries = await db('email_delivery_queue')
      .where('status', 'processing')
      .where('last_attempt', '<', staleBefore)
      .select('id', 'attempts', 'message_id');

    for (const delivery of staleDeliveries) {
      const exhausted = Number(delivery.attempts || 0) >= this.config.retryAttempts;
      await db('email_delivery_queue')
        .where('id', delivery.id)
        .where('status', 'processing')
        .update({
          status: exhausted ? 'failed' : 'pending',
          error_message: 'Delivery lease expired before completion',
          next_attempt: exhausted ? null : new Date(),
          updated_at: new Date()
        });

      if (exhausted) {
        await this.recordDeadLetter(delivery, 'Delivery lease expired before completion');
      }
    }
  }

  public shutdown(): void {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = undefined;
    }

    for (const timeout of this.deliveryQueue.values()) {
      clearTimeout(timeout);
    }
    this.deliveryQueue.clear();
    this.isProcessing = false;
  }

  // 🔥 NOVO MÉTODO: Descobrir tenants com entregas pendentes
  private async discoverTenantsWithPendingDeliveries(): Promise<number[]> {
    try {
      const tenants = await db('email_delivery_queue')
        .distinct('user_id')
        .where('status', 'pending')
        .where('next_attempt', '<=', new Date())
        .whereNotNull('user_id')
        .pluck('user_id');

      return tenants;
    } catch (error) {
      logger.error('Error discovering tenants with pending deliveries', { error });
      return [];
    }
  }

  // 🔥 NOVO MÉTODO: Processar entregas de um tenant específico
  private async processTenantDeliveries(tenantId: number): Promise<void> {
    try {
      // Validar contexto do tenant primeiro
      const tenantContext = await this.tenantContextService.getTenantContext(tenantId);
      if (!tenantContext.isActive) {
        logger.warn(`Skipping deliveries for inactive tenant ${tenantId}`);
        return;
      }

      // Calcular limite de entregas concorrentes para este tenant
      const tenantDeliveryLimit = this.calculateTenantDeliveryLimit(tenantContext);
      const availableSlots = Math.min(
        tenantDeliveryLimit,
        this.config.maxConcurrentDeliveries - this.activeDeliveries
      );

      if (availableSlots <= 0) {
        return;
      }

      // 🔥 CRÍTICO: Buscar entregas SOMENTE deste tenant
      const pendingDeliveries = await db('email_delivery_queue')
        .where('user_id', tenantId) // 🔒 ISOLAMENTO POR TENANT!
        .where('status', 'pending')
        .where('next_attempt', '<=', new Date())
        .orderBy('priority', 'desc')
        .orderBy('created_at', 'asc')
        .limit(availableSlots)
        .select('id');

      logger.debug(`Processing ${pendingDeliveries.length} deliveries for tenant ${tenantId}`, {
        tenantId,
        pendingCount: pendingDeliveries.length,
        availableSlots
      });

      for (const delivery of pendingDeliveries) {
        this.processDelivery(delivery.id, tenantId); // Passa tenantId para validação
      }

    } catch (error) {
      logger.error(`Error processing tenant ${tenantId} deliveries`, { error, tenantId });
    }
  }

  // 🔥 NOVO MÉTODO: Calcular limite de entregas concorrentes por tenant
  private calculateTenantDeliveryLimit(tenantContext: any): number {
    switch (tenantContext.plan) {
      case 'enterprise':
        return 5; // 50% dos slots disponíveis para enterprise
      case 'professional':
        return 3; // 30% dos slots para professional  
      case 'basic':
        return 1; // 10% dos slots para basic
      default:
        return 1;
    }
  }

  // 🔥 MÉTODO MODIFICADO: Stats globais (para admin) - mantido para compatibilidade 
  public async getStats(): Promise<DeliveryQueueStats> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [statusCounts, totalToday, avgDeliveryTime] = await Promise.all([
        db('email_delivery_queue')
          .groupBy('status')
          .count('* as count')
          .select('status'),
        db('email_delivery_queue')
          .where('created_at', '>=', today)
          .count('* as total')
          .first(),
        db('email_delivery_queue')
          .where('status', 'delivered')
          .where('delivered_at', '>=', today)
          .avg('delivery_time as avg_time')
          .first()
      ]);

      const stats: DeliveryQueueStats = {
        pending: 0,
        processing: 0,
        delivered: 0,
        failed: 0,
        bounced: 0,
        deferred: 0,
        totalToday: parseInt(String(totalToday?.total || '0')),
        averageDeliveryTime: parseFloat(avgDeliveryTime?.avg_time || '0')
      };

      statusCounts.forEach(({ status, count }) => {
        if (stats.hasOwnProperty(status)) {
          stats[status] = parseInt(count);
        }
      });

      return stats;

    } catch (error) {
      logger.error('Failed to get delivery stats', { error });
      return {
        pending: 0,
        processing: 0,
        delivered: 0,
        failed: 0,
        bounced: 0,
        deferred: 0,
        totalToday: 0,
        averageDeliveryTime: 0
      };
    }
  }

  // 🔥 NOVO MÉTODO: Stats por tenant com isolamento completo
  public async getTenantStats(tenantId: number): Promise<TenantDeliveryStats> {
    try {
      // Validar tenant primeiro
      const tenantContext = await this.tenantContextService.getTenantContext(tenantId);
      if (!tenantContext.isActive) {
        throw new Error(`Tenant ${tenantId} is inactive`);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [statusCounts, totalToday, avgDeliveryTime] = await Promise.all([
        db('email_delivery_queue')
          .where('user_id', tenantId) // 🔒 ISOLAMENTO POR TENANT!
          .groupBy('status')
          .count('* as count')
          .select('status'),
        db('email_delivery_queue')
          .where('user_id', tenantId) // 🔒 ISOLAMENTO POR TENANT!
          .where('created_at', '>=', today)
          .count('* as total')
          .first(),
        db('email_delivery_queue')
          .where('user_id', tenantId) // 🔒 ISOLAMENTO POR TENANT!
          .where('status', 'delivered')
          .where('delivered_at', '>=', today)
          .avg('delivery_time as avg_time')
          .first()
      ]);

      const stats: TenantDeliveryStats = {
        tenantId,
        pending: 0,
        processing: 0,
        delivered: 0,
        failed: 0,
        bounced: 0,
        deferred: 0,
        totalToday: parseInt(String(totalToday?.total || '0')),
        averageDeliveryTime: parseFloat(avgDeliveryTime?.avg_time || '0'),
        rateLimitsRemaining: {
          daily: Math.max(0, tenantContext.dailyEmailLimit - (tenantContext.dailyEmailsSent || 0)),
          hourly: Math.max(0, tenantContext.hourlyEmailLimit - (tenantContext.hourlyEmailsSent || 0)),
          perMinute: Math.max(0, tenantContext.perMinuteEmailLimit - (tenantContext.perMinuteEmailsSent || 0))
        }
      };

      statusCounts.forEach(({ status, count }) => {
        if (stats.hasOwnProperty(status)) {
          (stats as any)[status] = parseInt(count);
        }
      });

      return stats;

    } catch (error) {
      logger.error(`Failed to get tenant ${tenantId} delivery stats`, { error, tenantId });
      throw error;
    }
  }

  // 🔥 MÉTODO MODIFICADO: Cancel delivery com validação de tenant
  public async cancelDelivery(deliveryId: number, tenantId?: number): Promise<boolean> {
    try {
      const query = db('email_delivery_queue')
        .where('id', deliveryId)
        .whereIn('status', ['pending', 'deferred']);

      // 🔥 NOVO: Se tenantId fornecido, garantir que delivery pertence ao tenant
      if (tenantId) {
        query.where('user_id', tenantId);
      }

      const updated = await query.update({
        status: 'failed',
        error_message: 'Cancelled by user',
        updated_at: new Date()
      });

      if (updated > 0) {
        // Cancelar timeout se existir
        const timeout = this.deliveryQueue.get(deliveryId);
        if (timeout) {
          clearTimeout(timeout);
          this.deliveryQueue.delete(deliveryId);
        }

        logger.info('Delivery cancelled', { deliveryId, tenantId }); // 🔥 NOVO: Log do tenant
        return true;
      }

      return false;

    } catch (error) {
      logger.error('Failed to cancel delivery', { error, deliveryId });
      return false;
    }
  }

  private async validateRequiredTables(): Promise<void> {
    try {
      const requiredTables = [
        'email_delivery_queue',
        'delivery_stats'
      ];

      for (const tableName of requiredTables) {
        const hasTable = await db.schema.hasTable(tableName);
        if (!hasTable) {
          throw new Error(`Tabela obrigatória '${tableName}' não encontrada. Execute as migrations primeiro.`);
        }
      }

      logger.info('DeliveryManager: Todas as tabelas obrigatórias validadas com sucesso');
    } catch (error) {
      logger.error('Erro ao validar tabelas do DeliveryManager:', error);
      throw error;
    }
  }

  public async cleanup(): Promise<void> {
    try {
      // Limpar entregas antigas (mais de 30 dias)
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const deleted = await db('email_delivery_queue')
        .where('created_at', '<', cutoffDate)
        .whereIn('status', ['delivered', 'failed'])
        .del();

      if (deleted > 0) {
        logger.info('Cleaned up old delivery records', { deleted });
      }

      // Limpar timeouts orfãos
      this.deliveryQueue.clear();

    } catch (error) {
      logger.error('Delivery cleanup failed', { error });
    }
  }

  public async stop(): Promise<void> {
    this.isProcessing = false;
    
    // Cancelar todos os timeouts pendentes
    for (const timeout of this.deliveryQueue.values()) {
      clearTimeout(timeout);
    }
    this.deliveryQueue.clear();

    // 🔥 NOVO: Cancelar processadores por tenant
    for (const timeout of this.tenantProcessors.values()) {
      clearTimeout(timeout);
    }
    this.tenantProcessors.clear();

    // Fechar transporter
    if (this.transporter) {
      this.transporter.close();
    }

    logger.info('Tenant-aware delivery manager stopped');
  }
}
