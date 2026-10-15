import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/lib/api'

export interface AccountUsage {
  plan: {
    slug: string
    name: string
    monthly_price_cents: number
    limits: {
      emailsPerMinute: number
      emailsPerHour: number
      emailsPerDay: number
      emailsPerMonth: number
      domainsLimit: number
      webhooksLimit: number
    }
    sending_blocked: boolean
  }
  usage: {
    emailsToday: number
    emailsThisMonth: number
    domains: number
    activeWebhooks: number
  }
  onboarding: {
    domain_added: boolean
    domain_verified: boolean
    api_key_created: boolean
    first_email_sent: boolean
  }
}

export function useAccountUsage() {
  return useQuery({
    queryKey: ['account-usage'],
    queryFn: async () => (await settingsApi.getUsage()).data as AccountUsage,
    staleTime: 60_000,
  })
}
