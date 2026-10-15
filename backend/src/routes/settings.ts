import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, authenticateJWT, requirePermission } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { settingsService } from '../services/SettingsService';
import { workspaceService } from '../services/WorkspaceService';
import { planLimitsService } from '../services/PlanLimitsService';
import { getAccountUserId } from '../utils/accountContext';
import db from '../config/database';

const router = Router();

router.use(authenticateJWT);

const settingsSchema = z.object({
  notification_preferences: z.record(z.boolean()).optional(),
  system_preferences: z.object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    date_format: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
    time_format: z.enum(['12h', '24h']).optional(),
    items_per_page: z.number().int().min(5).max(100).optional(),
    auto_refresh: z.boolean().optional(),
    auto_refresh_interval: z.number().int().min(5000).max(300000).optional()
  }).optional(),
  security_settings: z.object({
    session_timeout: z.number().int().min(300).max(86400).optional(),
    require_password_confirmation: z.boolean().optional(),
    ip_whitelist: z.array(z.string()).max(50).optional(),
    two_factor_enabled: z.boolean().optional(),
    api_rate_limit: z.number().int().min(10).max(100000).optional()
  }).optional(),
  branding_settings: z.object({
    company_name: z.string().max(150).optional(),
    company_logo_url: z.string().max(500).optional(),
    custom_domain: z.string().max(255).optional(),
    footer_text: z.string().max(300).optional(),
    primary_color: z.string().max(20).optional(),
    secondary_color: z.string().max(20).optional()
  }).optional(),
  analytics_settings: z.object({
    default_time_range: z.enum(['24h', '7d', '30d', '90d']).optional(),
    track_opens: z.boolean().optional(),
    track_clicks: z.boolean().optional(),
    track_downloads: z.boolean().optional(),
    pixel_tracking: z.boolean().optional(),
    utm_tracking: z.boolean().optional()
  }).optional(),
  smtp_settings: z.object({
    use_custom: z.boolean().optional(),
    host: z.string().max(255).optional(),
    port: z.number().int().min(1).max(65535).nullable().optional(),
    username: z.string().max(255).optional(),
    password: z.string().max(500).optional(),
    use_tls: z.boolean().optional()
  }).optional(),
  sending_settings: z.object({
    timezone: z.string().optional(),
    default_from_email: z.string().email().optional(),
    default_from_name: z.string().max(150).optional(),
    bounce_handling: z.boolean().optional(),
    open_tracking: z.boolean().optional(),
    click_tracking: z.boolean().optional(),
    unsubscribe_tracking: z.boolean().optional(),
    suppression_list_enabled: z.boolean().optional()
  }).optional(),
  webhook_settings: z.object({
    enabled: z.boolean().optional(),
    webhook_url: z.union([z.string().url(), z.literal('')]).optional(),
    webhook_secret: z.string().max(255).optional(),
    custom_headers: z.record(z.string()).optional()
  }).optional()
});

router.get('/', requirePermission('settings:read'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const workspace = await workspaceService.getContext(req.user!.id, req.user?.organization_id);
  const settings = await settingsService.getEffectiveSettings(req.user!.id, workspace);
  res.json({ settings });
}));

router.put('/',
  requirePermission('settings:write'),
  validateRequest({ body: settingsSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspace = await workspaceService.getContext(req.user!.id, req.user?.organization_id);

    try {
      const settings = await settingsService.updateEffectiveSettings(req.user!.id, workspace, req.body);
      res.json({ settings });
    } catch (error) {
      throw createError(error instanceof Error ? error.message : 'Failed to update settings', 403);
    }
  })
);

/**
 * Plano, consumo e progresso do onboarding da conta, em uma unica chamada.
 * Alimenta o checklist da tela inicial e o resumo do plano na sidebar.
 */
router.get('/usage', requirePermission('settings:read'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const accountUserId = getAccountUserId(req);

  const [planState, usage, verifiedDomains, apiKeys, sentEmails] = await Promise.all([
    planLimitsService.getAccountPlanState(accountUserId),
    planLimitsService.getUsage(accountUserId),
    db('domains').where('user_id', accountUserId).where('is_verified', true).count('* as count').first(),
    db('api_keys').where('user_id', accountUserId).where('is_active', true).count('* as count').first(),
    db('emails').where('user_id', accountUserId).count('* as count').first()
  ]);

  const toNumber = (row: any) => Number(row?.count || 0);

  res.json({
    plan: {
      slug: planState.plan.slug,
      name: planState.plan.name,
      monthly_price_cents: planState.plan.monthly_price_cents,
      limits: planState.limits,
      sending_blocked: planState.sendingBlocked || planState.isSuspended
    },
    usage,
    onboarding: {
      domain_added: usage.domains > 0,
      domain_verified: toNumber(verifiedDomains) > 0,
      api_key_created: toNumber(apiKeys) > 0,
      first_email_sent: toNumber(sentEmails) > 0
    }
  });
}));

export default router;
