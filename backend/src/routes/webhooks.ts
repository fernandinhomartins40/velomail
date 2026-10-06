import { Router, Response } from 'express';
import { AuthenticatedRequest, authenticateJWT, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import {
  createWebhookPayloadSchema,
  idParamSchema,
  updateWebhookPayloadSchema,
  validateRequest,
} from '../middleware/validation';
import { generateSecretKey } from '../utils/crypto';
import db from '../config/database';
import { resolveInsertedId } from '../utils/insertedId';
import { getAccountUserId } from '../utils/accountContext';
import { assertSafeWebhookUrl } from '../utils/urlSecurity';
import { webhookService } from '../services/webhookService';
import { planLimitsService } from '../services/PlanLimitsService';

const router = Router();

router.use(authenticateJWT);

const parseEvents = (events: unknown): string[] => {
  if (Array.isArray(events)) {
    return events.filter((event): event is string => typeof event === 'string');
  }

  if (typeof events === 'string') {
    try {
      const parsed = JSON.parse(events);
      return Array.isArray(parsed)
        ? parsed.filter((event): event is string => typeof event === 'string')
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

const buildWebhookName = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return 'Webhook';
  }
};

const normalizeWebhook = (
  webhook: any,
  stats?: { total_attempts: number; successful_attempts: number; last_delivery_at?: string | null }
) => {
  const totalAttempts = Number(stats?.total_attempts || 0);
  const successfulAttempts = Number(stats?.successful_attempts || 0);

  return {
    id: webhook.id,
    name: webhook.name || buildWebhookName(webhook.url),
    webhook_url: webhook.url,
    events: parseEvents(webhook.events),
    has_secret: Boolean(webhook.secret),
    is_active: Boolean(webhook.is_active),
    created_at: webhook.created_at,
    updated_at: webhook.updated_at,
    last_delivery_at: stats?.last_delivery_at || null,
    delivery_success_rate: totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0
  };
};

const normalizeLog = (log: any) => ({
  id: log.id,
  webhook_id: log.webhook_id,
  event_type: log.event,
  status: log.success ? 'success' : 'failed',
  http_status: log.status_code ?? null,
  request_body: log.payload || '',
  response_body: log.response_body || '',
  response_time_ms: log.response_time_ms ?? null,
  attempts: log.attempt,
  next_retry_at: null,
  created_at: log.created_at,
  error_message: log.error_message || null
});

const getWebhookStatsMap = async (webhookIds: number[]) => {
  if (webhookIds.length === 0) {
    return new Map<number, { total_attempts: number; successful_attempts: number; last_delivery_at?: string | null }>();
  }

  const hasWebhookLogsTable = await db.schema.hasTable('webhook_logs');
  if (!hasWebhookLogsTable) {
    return new Map<number, { total_attempts: number; successful_attempts: number; last_delivery_at?: string | null }>();
  }

  let stats: any[] = [];
  try {
    stats = await db('webhook_logs')
      .select(
        'webhook_id',
        db.raw('COUNT(*) as total_attempts'),
        db.raw('SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful_attempts'),
        db.raw('MAX(created_at) as last_delivery_at')
      )
      .whereIn('webhook_id', webhookIds)
      .groupBy('webhook_id');
  } catch {
    return new Map<number, { total_attempts: number; successful_attempts: number; last_delivery_at?: string | null }>();
  }

  return new Map(
    stats.map((row: any) => [
      Number(row.webhook_id),
      {
        total_attempts: Number(row.total_attempts || 0),
        successful_attempts: Number(row.successful_attempts || 0),
        last_delivery_at: row.last_delivery_at || null
      }
    ])
  );
};

router.get('/', requirePermission('webhook:read'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const accountUserId = getAccountUserId(req);
  const webhooks = await db('webhooks')
    .where('user_id', accountUserId)
    .orderBy('created_at', 'desc');

  const statsMap = await getWebhookStatsMap(webhooks.map((webhook: any) => Number(webhook.id)));

  res.json({
    webhooks: webhooks.map((webhook: any) => normalizeWebhook(webhook, statsMap.get(Number(webhook.id))))
  });
}));

router.post('/',
  requirePermission('webhook:write'),
  validateRequest({ body: createWebhookPayloadSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const accountUserId = getAccountUserId(req);
  const webhookUrl = req.body.webhook_url;
  const events = parseEvents(req.body.events);
  const name = req.body.name || buildWebhookName(webhookUrl);
  const secret = req.body.secret || generateSecretKey();

  if (!webhookUrl || events.length === 0) {
    return res.status(400).json({ error: 'Webhook URL and at least one event are required' });
  }

  try {
    await assertSafeWebhookUrl(webhookUrl);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid webhook URL'
    });
  }

  await planLimitsService.assertResourceLimit(accountUserId, 'webhooks');

  const insertResult = await db('webhooks').insert({
    url: webhookUrl,
    name,
    events: JSON.stringify(events),
    secret,
    is_active: true,
    user_id: accountUserId,
    created_at: new Date(),
    updated_at: new Date()
  });

  const webhookId = resolveInsertedId(insertResult)
    ?? Number(
      (
        await db('webhooks')
          .select('id')
          .where('user_id', accountUserId)
          .where('url', webhookUrl)
          .where('name', name)
          .orderBy('id', 'desc')
          .first()
      )?.id
    );

  if (!webhookId) {
    return res.status(500).json({ error: 'Falha ao resolver o webhook criado' });
  }

  const webhook = await db('webhooks').where('id', webhookId).first();

  res.status(201).json({
    webhook: normalizeWebhook(webhook),
    secret,
    warning: 'Guarde este secret agora. Ele nao sera exibido novamente depois da criacao.'
  });
}));

router.put('/:id',
  requirePermission('webhook:write'),
  validateRequest({ params: idParamSchema, body: updateWebhookPayloadSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const accountUserId = getAccountUserId(req);
  const { id } = req.params;

  const currentWebhook = await db('webhooks')
    .where('id', id)
    .where('user_id', accountUserId)
    .first();

  if (!currentWebhook) {
    return res.status(404).json({ error: 'Webhook não encontrado' });
  }

  const webhookUrl = req.body.webhook_url || currentWebhook.url;
  const events = req.body.events ? parseEvents(req.body.events) : parseEvents(currentWebhook.events);

  try {
    await assertSafeWebhookUrl(webhookUrl);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid webhook URL'
    });
  }

  await db('webhooks')
    .where('id', id)
    .where('user_id', accountUserId)
    .update({
      url: webhookUrl,
      name: req.body.name || currentWebhook.name || buildWebhookName(webhookUrl),
      events: JSON.stringify(events),
      secret: typeof req.body.secret === 'string' && req.body.secret.length > 0 ? req.body.secret : currentWebhook.secret,
      is_active: typeof req.body.is_active === 'boolean' ? req.body.is_active : currentWebhook.is_active,
      updated_at: new Date()
    });

  const webhook = await db('webhooks')
    .where('id', id)
    .where('user_id', accountUserId)
    .first();

  const statsMap = await getWebhookStatsMap([Number(id)]);
  res.json({ webhook: normalizeWebhook(webhook, statsMap.get(Number(id))) });
}));

router.delete('/:id', requirePermission('webhook:write'), validateRequest({ params: idParamSchema }), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const accountUserId = getAccountUserId(req);

  const deleted = await db('webhooks')
    .where('id', id)
    .where('user_id', accountUserId)
    .del();

  if (deleted === 0) {
    return res.status(404).json({ error: 'Webhook não encontrado' });
  }

  res.json({ message: 'Webhook deletado com sucesso' });
}));

router.get('/:id/logs', requirePermission('webhook:read'), validateRequest({ params: idParamSchema }), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { status = 'all', event_type = 'all' } = req.query;
  const accountUserId = getAccountUserId(req);

  const webhook = await db('webhooks')
    .where('id', id)
    .where('user_id', accountUserId)
    .first();

  if (!webhook) {
    return res.status(404).json({ error: 'Webhook não encontrado' });
  }

  let query = db('webhook_logs')
    .where('webhook_id', id)
    .orderBy('created_at', 'desc')
    .limit(100);

  if (status === 'success') {
    query = query.where('success', true);
  } else if (status === 'failed') {
    query = query.where('success', false);
  }

  if (typeof event_type === 'string' && event_type !== 'all') {
    query = query.where('event', event_type);
  }

  const logs = await query;
  res.json({ logs: logs.map(normalizeLog) });
}));

router.post('/:id/test', requirePermission('webhook:write'), validateRequest({ params: idParamSchema }), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const accountUserId = getAccountUserId(req);

  const webhook = await db('webhooks')
    .where('id', id)
    .where('user_id', accountUserId)
    .first();

  if (!webhook) {
    return res.status(404).json({ error: 'Webhook não encontrado' });
  }

  try {
    await assertSafeWebhookUrl(webhook.url);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Invalid webhook URL'
    });
  }

  const payload = {
    event: 'webhook.test',
    timestamp: new Date().toISOString(),
    data: {
      message: 'Teste de webhook do UltraZend',
      webhook_id: webhook.id,
      user_id: accountUserId
    }
  };

  void webhookService.sendWebhook('webhook.test', payload.data, accountUserId, Number(webhook.id));

  return res.status(202).json({
    success: true,
    message: 'Entrega assíncrona do webhook de teste iniciada',
    webhook_id: webhook.id
  });
}));

export default router;
