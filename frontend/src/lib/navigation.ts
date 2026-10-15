import { FileText, Globe, Home, Key, Mail, Settings, Webhook, type LucideIcon } from 'lucide-react'

export interface NavItem {
  name: string
  href: string
  icon: LucideIcon
}

/**
 * Menu unico do painel, compartilhado pela sidebar e pela navegacao mobile.
 * Metricas, documentacao e integracao com IA sao acessadas a partir do Inicio,
 * para manter o menu curto.
 */
export const appNavigation: NavItem[] = [
  { name: 'Início', href: '/app', icon: Home },
  { name: 'Envios', href: '/app/emails', icon: Mail },
  { name: 'Domínios', href: '/app/domains', icon: Globe },
  { name: 'Templates', href: '/app/templates', icon: FileText },
  { name: 'Webhooks', href: '/app/webhooks', icon: Webhook },
  { name: 'Chaves de API', href: '/app/api-keys', icon: Key },
  { name: 'Configurações', href: '/app/settings', icon: Settings },
]

export const isRouteActive = (pathname: string, href: string) => {
  if (href === '/app') {
    return pathname === '/app'
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}
