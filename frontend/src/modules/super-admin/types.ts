export interface OverviewData {
  accounts: { total: number; active: number }
  users: { total: number; active: number }
  deliverability: {
    total_domains: number
    verified_domains: number
    emails_last_24h: number
    failed_last_24h: number
    success_rate_24h: number
  }
  alerts: { active: number }
  generated_at: string
}

export interface SuperAdminProfile {
  id: number
  name: string
  email: string
  is_active: boolean
  is_verified: boolean
  is_superadmin: boolean
  role: string
  mfa_required: boolean
  profile_is_active: boolean
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export interface AccountRow {
  id: number
  name: string
  email: string
  is_active: boolean
  is_suspended?: boolean
  email_sending_blocked?: boolean
  is_under_review?: boolean
  plan_name?: string
  plan_status?: string
  created_at: string
}

export interface PlanLimits {
  emailsPerMinute: number
  emailsPerHour: number
  emailsPerDay: number
  emailsPerMonth: number
  domainsLimit: number
  webhooksLimit: number
}

export type PlanLimitKey = keyof PlanLimits

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled'

export interface PlanRow {
  id: number
  slug: string
  name: string
  description: string | null
  monthly_price_cents: number
  emails_per_minute: number
  emails_per_hour: number
  emails_per_day: number
  emails_per_month: number
  domains_limit: number
  webhooks_limit: number
  is_active: boolean
  is_default: boolean
  sort_order: number
  accounts: number
}

export type PlanInput = Omit<PlanRow, 'id' | 'accounts'>

export interface AccountPlanDetails {
  account: {
    id: number
    name: string
    email: string
    plan_notes?: string | null
  }
  plan: {
    slug: string
    name: string
    source: 'subscription' | 'legacy' | 'default'
    status: string | null
    expires_at: string | null
    limits: PlanLimits
    plan_limits: PlanLimits
    overridden_limits: PlanLimitKey[]
    is_suspended: boolean
    sending_blocked: boolean
  }
  usage: {
    emailsLastMinute: number
    emailsLastHour: number
    emailsToday: number
    emailsThisMonth: number
    domains: number
    activeWebhooks: number
  }
}

export interface UserRow {
  id: number
  name: string
  email: string
  is_active: boolean
  is_admin: boolean
  is_verified: boolean
  created_at: string
}

export interface DeliverabilityRow {
  domain: string
  total: number
  failed: number
  successful: number
  delivery_rate: number
  failure_rate: number
}

export interface IntegrationOverview {
  webhooks_total: number
  webhook_failures_24h: number
  active_api_keys: number
}

export interface AuditLogRow {
  id: number
  action: string
  target_type: string
  target_id: string | null
  reason: string | null
  ip_address: string | null
  created_at: string
}

export interface Pagination {
  page: number
  total_pages: number
  total: number
}

export interface Paginated<T> {
  data: T[]
  pagination: Pagination
}
