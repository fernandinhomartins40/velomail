import { Link, useLocation } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  CreditCard,
  Link2,
  Search,
  ShieldCheck,
  UserCircle2,
  Users,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SuperAdminSidebarProps {
  isOpen: boolean
  onClose: () => void
}

const navigation = [
  { label: 'Visao Geral', to: '/super-admin/overview', icon: BarChart3 },
  { label: 'Contas', to: '/super-admin/accounts', icon: ShieldCheck },
  { label: 'Planos', to: '/super-admin/plans', icon: CreditCard },
  { label: 'Usuarios', to: '/super-admin/users', icon: Users },
  { label: 'Entregabilidade', to: '/super-admin/deliverability', icon: Activity },
  { label: 'Integracoes', to: '/super-admin/integrations', icon: Link2 },
  { label: 'Auditoria', to: '/super-admin/audit', icon: Search },
  { label: 'Meu Perfil', to: '/super-admin/profile', icon: UserCircle2 }
]

export function SuperAdminSidebar({ isOpen, onClose }: SuperAdminSidebarProps) {
  const location = useLocation()

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-72 border-r bg-card transition-transform duration-200 lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          <header className="flex h-[72px] items-center justify-between border-b px-5">
            <div className="flex items-center gap-2">
              <img className="h-auto w-[116px]" src="/landing/logo-color.png" alt="VeloMail" />
              <div>
                <div className="text-xs font-semibold tracking-wide text-primary">SUPER ADMIN</div>
              </div>
            </div>

            <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </header>

          <nav className="flex-1 space-y-1 p-3">
            {navigation.map((item) => {
              const Icon = item.icon
              const active = isActive(item.to)

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => {
                    if (window.innerWidth < 1024) onClose()
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>

          <footer className="border-t p-4">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
              Sessao: <span className="font-semibold">super_admin</span>
            </div>
          </footer>
        </div>
      </aside>
    </>
  )
}
