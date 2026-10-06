import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import db from '../../config/database';
import { planLimitsService } from '../../services/PlanLimitsService';
import { superAdminService } from '../../services/SuperAdminService';
import { TenantContextService } from '../../services/TenantContextService';

/**
 * O que o super admin define no painel precisa valer no envio:
 * plano do catálogo, overrides por conta, bloqueio de envio e suspensão.
 */
describe('Planos e limites gerenciados pelo super admin', () => {
  const DOMAIN = 'plan-limits.example.com';
  const tenantService = TenantContextService.getInstance();
  let adminId: number;
  let accountId: number;

  const createUser = async (email: string, extra: Record<string, unknown> = {}) => {
    await db('users').insert({
      name: email,
      email,
      password_hash: 'not-used',
      is_verified: true,
      created_at: new Date(),
      updated_at: new Date(),
      ...extra
    });
    return Number((await db('users').where('email', email).first('id')).id);
  };

  const insertEmails = async (count: number) => {
    for (let index = 0; index < count; index += 1) {
      await db('emails').insert({
        user_id: accountId,
        from_email: `noreply@${DOMAIN}`,
        to_email: 'dest@example.org',
        subject: 'Teste',
        status: 'sent',
        message_id: `plan-limits-${Date.now()}-${index}-${Math.random()}`,
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  };

  const canSend = (metadata?: Record<string, unknown>) => tenantService.validateTenantOperation(accountId, {
    operation: 'send_email',
    resource: DOMAIN,
    metadata
  });

  beforeAll(async () => {
    adminId = await createUser('plan-admin@example.com', { is_admin: true, is_superadmin: true, is_active: true });
    accountId = await createUser('plan-account@example.com', { is_active: true });
    await db('domains').insert({
      user_id: accountId,
      domain_name: DOMAIN,
      is_verified: true,
      verification_token: 'plan-limits-token',
      created_at: new Date(),
      updated_at: new Date()
    });
  });

  beforeEach(async () => {
    await db('emails').where('user_id', accountId).del();
    await db('account_subscriptions').where('account_user_id', accountId).del();
    await db('account_security_flags').where('account_user_id', accountId).del();
    await db('users').where('id', accountId).update({ is_active: true });
    planLimitsService.invalidate();
    await tenantService.invalidateCache();
  });

  it('usa o plano padrão quando a conta não tem plano atribuído', async () => {
    const state = await planLimitsService.getAccountPlanState(accountId, { fresh: true });

    expect(state.source).toBe('default');
    expect(state.plan.slug).toBe('free');
    expect(state.limits.emailsPerHour).toBe(10);
    expect((await canSend()).allowed).toBe(true);
  });

  it('aplica o plano atribuído pelo super admin e bloqueia ao atingir o limite', async () => {
    await superAdminService.updateAccountPlan(adminId, accountId, { plan_name: 'professional' });

    const state = await planLimitsService.getAccountPlanState(accountId);
    expect(state.source).toBe('subscription');
    expect(state.limits.emailsPerMinute).toBe(10);

    await insertEmails(9);
    expect((await canSend()).allowed).toBe(true);

    await insertEmails(1);
    const blocked = await canSend();
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('por minuto');
  });

  it('respeita limite personalizado da conta e não bloqueia email já aceito na entrega', async () => {
    await superAdminService.updateAccountPlan(adminId, accountId, {
      plan_name: 'professional',
      overrides: { emailsPerMinute: 1000, emailsPerHour: 1000, emailsPerDay: 3 }
    });
    await insertEmails(3);

    const blocked = await canSend();
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('diário de 3');
    expect((await canSend({ stage: 'delivery' })).allowed).toBe(true);

    await superAdminService.updateAccountPlan(adminId, accountId, {
      plan_name: 'professional',
      overrides: { emailsPerDay: null }
    });
    expect((await canSend()).allowed).toBe(true);
  });

  it('volta ao plano padrão quando a assinatura expira ou é cancelada', async () => {
    await superAdminService.updateAccountPlan(adminId, accountId, { plan_name: 'enterprise' });
    // Gravado como texto: neste ambiente (Jest + SQLite) um Date vira "[object Object]".
    await db('account_subscriptions')
      .where('account_user_id', accountId)
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() });
    planLimitsService.invalidate(accountId);
    expect((await planLimitsService.getAccountPlanState(accountId)).plan.slug).toBe('free');

    await superAdminService.updateAccountPlan(adminId, accountId, {
      plan_name: 'enterprise',
      expires_at: null,
      status: 'canceled'
    });
    expect((await planLimitsService.getAccountPlanState(accountId)).plan.slug).toBe('free');

    await superAdminService.updateAccountPlan(adminId, accountId, { plan_name: 'enterprise', status: 'active' });
    expect((await planLimitsService.getAccountPlanState(accountId)).plan.slug).toBe('enterprise');
  });

  it('bloqueia o envio quando o super admin bloqueia ou suspende a conta', async () => {
    await superAdminService.updateAccountSecurity(adminId, accountId, { email_sending_blocked: true });
    const blocked = await canSend();
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('bloqueado');
    expect((await canSend({ stage: 'delivery' })).allowed).toBe(false);

    await superAdminService.updateAccountSecurity(adminId, accountId, { email_sending_blocked: false });
    expect((await canSend()).allowed).toBe(true);

    await superAdminService.updateAccountSecurity(adminId, accountId, { is_suspended: true });
    expect((await canSend()).allowed).toBe(false);

    await superAdminService.updateAccountSecurity(adminId, accountId, { is_suspended: false });
    expect((await canSend()).allowed).toBe(true);
  });

  it('permite criar e editar planos do catálogo, refletindo nas contas', async () => {
    const created = await superAdminService.createPlan(adminId, {
      slug: 'starter',
      name: 'Starter',
      monthly_price_cents: 4900,
      emails_per_minute: 5,
      emails_per_hour: 50,
      emails_per_day: 500,
      emails_per_month: 10000,
      domains_limit: 2,
      webhooks_limit: 3
    });
    await expect(superAdminService.createPlan(adminId, { ...created, slug: 'starter' })).rejects.toThrow('Já existe');

    await superAdminService.updateAccountPlan(adminId, accountId, { plan_name: 'starter' });
    expect((await planLimitsService.getAccountPlanState(accountId)).limits.emailsPerDay).toBe(500);

    await superAdminService.updatePlan(adminId, created.id, { emails_per_day: 750 });
    expect((await planLimitsService.getAccountPlanState(accountId)).limits.emailsPerDay).toBe(750);

    const { plans } = await superAdminService.listPlans(adminId);
    expect(plans.find((plan) => plan.slug === 'starter')?.accounts).toBe(1);
    expect(plans.filter((plan) => plan.is_default)).toHaveLength(1);

    await expect(superAdminService.updateAccountPlan(adminId, accountId, { plan_name: 'inexistente' }))
      .rejects.toThrow('não existe no catálogo');
  });

  it('impede novos domínios acima do limite do plano', async () => {
    // Plano padrão (free) permite 1 domínio e a conta já tem 1.
    await expect(planLimitsService.assertResourceLimit(accountId, 'domains')).rejects.toMatchObject({
      statusCode: 403,
      code: 'PLAN_LIMIT_REACHED'
    });

    await superAdminService.updateAccountPlan(adminId, accountId, {
      plan_name: 'free',
      overrides: { domainsLimit: 2 }
    });
    await expect(planLimitsService.assertResourceLimit(accountId, 'domains')).resolves.toBeUndefined();
  });
});
