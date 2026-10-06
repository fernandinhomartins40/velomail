import db from '../config/database';
import { logger } from '../config/logger';

/**
 * Fonte unica dos limites de uma conta.
 *
 * Ordem de resolucao do plano:
 * 1. account_subscriptions (gerenciada pelo super admin), se ativa e nao expirada
 * 2. user_plans ativo (legado)
 * 3. plano padrao do catalogo (platform_plans.is_default)
 *
 * Os limites vem do plano em platform_plans; colunas override_* da assinatura
 * substituem limites individuais. Sem catalogo no banco, usa DEFAULT_PLANS.
 */

export interface PlanDefinition {
  id: number | null;
  slug: string;
  name: string;
  description: string | null;
  monthly_price_cents: number;
  emails_per_minute: number;
  emails_per_hour: number;
  emails_per_day: number;
  emails_per_month: number;
  domains_limit: number;
  webhooks_limit: number;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
}

export interface EffectiveLimits {
  emailsPerMinute: number;
  emailsPerHour: number;
  emailsPerDay: number;
  emailsPerMonth: number;
  domainsLimit: number;
  webhooksLimit: number;
}

export type LimitKey = keyof EffectiveLimits;

export interface AccountPlanState {
  userId: number;
  plan: PlanDefinition;
  source: 'subscription' | 'legacy' | 'default';
  subscriptionStatus: string | null;
  expiresAt: Date | null;
  limits: EffectiveLimits;
  overriddenLimits: LimitKey[];
  isSuspended: boolean;
  sendingBlocked: boolean;
  suspensionReason: string | null;
}

export interface EmailUsage {
  emailsLastMinute: number;
  emailsLastHour: number;
  emailsToday: number;
  emailsThisMonth: number;
}

export interface AccountUsage extends EmailUsage {
  domains: number;
  activeWebhooks: number;
}

// Mesmos valores que eram fixos no TenantContextService, para o comportamento
// nao mudar ate o super admin editar o catalogo.
export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    id: null,
    slug: 'free',
    name: 'Gratuito',
    description: 'Plano de entrada',
    monthly_price_cents: 0,
    emails_per_minute: 2,
    emails_per_hour: 10,
    emails_per_day: 100,
    emails_per_month: 2000,
    domains_limit: 1,
    webhooks_limit: 2,
    is_active: true,
    is_default: true,
    sort_order: 0
  },
  {
    id: null,
    slug: 'professional',
    name: 'Profissional',
    description: null,
    monthly_price_cents: 0,
    emails_per_minute: 10,
    emails_per_hour: 100,
    emails_per_day: 1000,
    emails_per_month: 25000,
    domains_limit: 5,
    webhooks_limit: 10,
    is_active: true,
    is_default: false,
    sort_order: 10
  },
  {
    id: null,
    slug: 'enterprise',
    name: 'Empresarial',
    description: null,
    monthly_price_cents: 0,
    emails_per_minute: 50,
    emails_per_hour: 500,
    emails_per_day: 10000,
    emails_per_month: 300000,
    domains_limit: 20,
    webhooks_limit: 50,
    is_active: true,
    is_default: false,
    sort_order: 20
  }
];

// Nomes antigos que ainda podem estar gravados em user_plans/account_subscriptions.
const PLAN_ALIASES: Record<string, string> = {
  pro: 'professional',
  profissional: 'professional',
  gratuito: 'free',
  basic: 'free',
  empresarial: 'enterprise'
};

const OVERRIDE_COLUMNS: Record<LimitKey, string> = {
  emailsPerMinute: 'override_emails_per_minute',
  emailsPerHour: 'override_emails_per_hour',
  emailsPerDay: 'override_emails_per_day',
  emailsPerMonth: 'override_emails_per_month',
  domainsLimit: 'override_domains_limit',
  webhooksLimit: 'override_webhooks_limit'
};

// Status de assinatura em que o plano contratado deixa de valer.
const INACTIVE_SUBSCRIPTION_STATUSES = new Set(['canceled', 'cancelled', 'expired']);

// Curto de proposito: workers rodam em processos separados da API e nao
// recebem a invalidacao explicita feita quando o super admin altera algo.
const STATE_CACHE_TTL_MS = 15_000;

const toNumber = (value: unknown): number => Number(value || 0);

const toPlanDefinition = (row: any): PlanDefinition => ({
  id: row.id ?? null,
  slug: String(row.slug),
  name: String(row.name),
  description: row.description ?? null,
  monthly_price_cents: toNumber(row.monthly_price_cents),
  emails_per_minute: toNumber(row.emails_per_minute),
  emails_per_hour: toNumber(row.emails_per_hour),
  emails_per_day: toNumber(row.emails_per_day),
  emails_per_month: toNumber(row.emails_per_month),
  domains_limit: toNumber(row.domains_limit),
  webhooks_limit: toNumber(row.webhooks_limit),
  is_active: Boolean(row.is_active),
  is_default: Boolean(row.is_default),
  sort_order: toNumber(row.sort_order)
});

const planLimits = (plan: PlanDefinition): EffectiveLimits => ({
  emailsPerMinute: plan.emails_per_minute,
  emailsPerHour: plan.emails_per_hour,
  emailsPerDay: plan.emails_per_day,
  emailsPerMonth: plan.emails_per_month,
  domainsLimit: plan.domains_limit,
  webhooksLimit: plan.webhooks_limit
});

const countRows = async (query: any): Promise<number> => {
  const row = await query.count('* as count').first();
  return Number((row as any)?.count || 0);
};

class PlanLimitsService {
  private stateCache = new Map<number, { state: AccountPlanState; cachedAt: number }>();
  private catalogCache: { plans: PlanDefinition[]; cachedAt: number } | null = null;
  private tableCache = new Map<string, boolean>();

  private async hasTable(tableName: string): Promise<boolean> {
    if (this.tableCache.get(tableName)) {
      return true;
    }
    const exists = await db.schema.hasTable(tableName);
    if (exists) {
      this.tableCache.set(tableName, true);
    }
    return exists;
  }

  async listPlans(options: { includeInactive?: boolean } = {}): Promise<PlanDefinition[]> {
    const plans = await this.loadCatalog();
    return options.includeInactive ? plans : plans.filter((plan) => plan.is_active);
  }

  private async loadCatalog(): Promise<PlanDefinition[]> {
    if (this.catalogCache && Date.now() - this.catalogCache.cachedAt < STATE_CACHE_TTL_MS) {
      return this.catalogCache.plans;
    }

    let plans = DEFAULT_PLANS;
    if (await this.hasTable('platform_plans')) {
      const rows = await db('platform_plans').orderBy([{ column: 'sort_order' }, { column: 'id' }]);
      if (rows.length > 0) {
        plans = rows.map(toPlanDefinition);
      }
    }

    this.catalogCache = { plans, cachedAt: Date.now() };
    return plans;
  }

  /**
   * Grava DEFAULT_PLANS em platform_plans quando a tabela está vazia, para o
   * super admin editar planos reais em vez dos valores embutidos.
   */
  async ensureCatalogSeeded(): Promise<void> {
    if (!(await this.hasTable('platform_plans'))) {
      throw new Error('Tabela platform_plans ausente: rode as migrations antes de gerenciar planos');
    }

    const existing = await db('platform_plans').first('id');
    if (existing) return;

    const now = new Date();
    await db('platform_plans').insert(
      DEFAULT_PLANS.map(({ id: _id, ...plan }) => ({ ...plan, created_at: now, updated_at: now }))
    );
    this.invalidate();
  }

  async findPlan(slug: string | null | undefined): Promise<PlanDefinition | null> {
    if (!slug) return null;
    const normalized = String(slug).trim().toLowerCase();
    const plans = await this.listPlans({ includeInactive: true });
    return plans.find((plan) => plan.slug === normalized)
      || plans.find((plan) => plan.slug === PLAN_ALIASES[normalized])
      || null;
  }

  async getDefaultPlan(): Promise<PlanDefinition> {
    const plans = await this.listPlans({ includeInactive: true });
    const active = plans.filter((plan) => plan.is_active);
    return active.find((plan) => plan.is_default)
      || active.find((plan) => plan.slug === 'free')
      || active[0]
      || DEFAULT_PLANS[0];
  }

  async getAccountPlanState(userId: number, options: { fresh?: boolean } = {}): Promise<AccountPlanState> {
    const cached = this.stateCache.get(userId);
    if (!options.fresh && cached && Date.now() - cached.cachedAt < STATE_CACHE_TTL_MS) {
      return cached.state;
    }

    const state = await this.resolveState(userId);
    this.stateCache.set(userId, { state, cachedAt: Date.now() });
    return state;
  }

  invalidate(userId?: number): void {
    if (typeof userId === 'number') {
      this.stateCache.delete(userId);
    } else {
      this.stateCache.clear();
      this.catalogCache = null;
    }
  }

  async getEmailUsage(userId: number): Promise<EmailUsage> {
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfDay);
    startOfMonth.setDate(1);

    const emailsSince = (since: Date) => countRows(
      db('emails').where('user_id', userId).where('created_at', '>=', since)
    );

    const [lastMinute, lastHour, today, month] = await Promise.all([
      emailsSince(new Date(now - 60_000)),
      emailsSince(new Date(now - 3_600_000)),
      emailsSince(startOfDay),
      emailsSince(startOfMonth)
    ]);

    return {
      emailsLastMinute: lastMinute,
      emailsLastHour: lastHour,
      emailsToday: today,
      emailsThisMonth: month
    };
  }

  async getUsage(userId: number): Promise<AccountUsage> {
    const [emails, domains, webhooks] = await Promise.all([
      this.getEmailUsage(userId),
      countRows(db('domains').where('user_id', userId)),
      countRows(db('webhooks').where('user_id', userId).where('is_active', true))
    ]);

    return { ...emails, domains, activeWebhooks: webhooks };
  }

  /**
   * Lança erro 403 quando a conta já atingiu o limite do plano para o recurso.
   */
  async assertResourceLimit(userId: number, resource: 'domains' | 'webhooks'): Promise<void> {
    const state = await this.getAccountPlanState(userId, { fresh: true });
    const [limit, current, label] = resource === 'domains'
      ? [state.limits.domainsLimit, await countRows(db('domains').where('user_id', userId)), 'domínios']
      : [state.limits.webhooksLimit, await countRows(db('webhooks').where('user_id', userId).where('is_active', true)), 'webhooks'];

    if (current >= limit) {
      const error = new Error(
        `Limite de ${limit} ${label} do plano ${state.plan.name} atingido. Fale com o suporte para ampliar seu plano.`
      ) as Error & { statusCode: number; isOperational: boolean; code: string };
      error.statusCode = 403;
      error.isOperational = true;
      error.code = 'PLAN_LIMIT_REACHED';
      throw error;
    }
  }

  private async resolveState(userId: number): Promise<AccountPlanState> {
    const [subscription, flags] = await Promise.all([
      this.loadRow('account_subscriptions', userId),
      this.loadRow('account_security_flags', userId)
    ]);

    const expiresAt = subscription?.expires_at ? new Date(subscription.expires_at) : null;
    const status = subscription?.status ? String(subscription.status).toLowerCase() : null;
    const subscriptionValid = Boolean(subscription)
      && !INACTIVE_SUBSCRIPTION_STATUSES.has(status || '')
      && !(expiresAt && expiresAt.getTime() <= Date.now());

    let plan: PlanDefinition | null = null;
    let source: AccountPlanState['source'] = 'default';

    if (subscriptionValid) {
      plan = await this.findPlan(subscription.plan_name);
      if (plan) source = 'subscription';
    }

    if (!plan && !subscription && (await this.hasTable('user_plans'))) {
      const legacy = await db('user_plans').where('user_id', userId).where('is_active', true).first();
      plan = await this.findPlan(legacy?.plan_name);
      if (plan) source = 'legacy';
    }

    if (!plan) {
      plan = await this.getDefaultPlan();
      source = 'default';
    }

    const limits = planLimits(plan);
    const overriddenLimits: LimitKey[] = [];
    if (source === 'subscription') {
      for (const [key, column] of Object.entries(OVERRIDE_COLUMNS) as [LimitKey, string][]) {
        const value = subscription[column];
        if (value !== null && value !== undefined) {
          limits[key] = Number(value);
          overriddenLimits.push(key);
        }
      }
    }

    const suspensionEndsAt = flags?.suspension_ends_at ? new Date(flags.suspension_ends_at) : null;
    const suspensionExpired = Boolean(suspensionEndsAt && suspensionEndsAt.getTime() <= Date.now());

    return {
      userId,
      plan,
      source,
      subscriptionStatus: status,
      expiresAt,
      limits,
      overriddenLimits,
      isSuspended: Boolean(flags?.is_suspended) && !suspensionExpired,
      sendingBlocked: Boolean(flags?.email_sending_blocked),
      suspensionReason: flags?.suspension_reason ?? null
    };
  }

  private async loadRow(tableName: string, userId: number): Promise<any | null> {
    try {
      if (!(await this.hasTable(tableName))) return null;
      return (await db(tableName).where('account_user_id', userId).first()) || null;
    } catch (error) {
      logger.error(`PlanLimitsService: falha ao ler ${tableName}`, {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export const planLimitsService = new PlanLimitsService();
export { OVERRIDE_COLUMNS };
