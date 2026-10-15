import { Link, useLocation } from 'react-router-dom'
import { BookOpen, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSidebarStore } from '@/lib/store'
import { appNavigation, isRouteActive } from '@/lib/navigation'
import { useAccountUsage } from '@/hooks/useAccountUsage'
import { cn, formatNumber } from '@/lib/utils'

interface SidebarProps {
  className?: string
}

function PlanSummary() {
  const { data } = useAccountUsage()

  if (!data) {
    return null
  }

  const limit = data.plan.limits.emailsPerMonth
  const used = data.usage.emailsThisMonth
  const percentage = limit > 0 ? Math.min(100, (used / limit) * 100) : 0

  return (
    <Link
      to="/app/settings"
      className="block rounded-xl bg-primary/5 p-3 transition-colors hover:bg-primary/10"
      aria-label="Ver plano"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Plano {data.plan.name}</span>
        <span className="text-xs text-muted-foreground">{percentage.toFixed(0)}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', percentage >= 90 ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {formatNumber(used)} de {formatNumber(limit)} emails no mês
      </div>
    </Link>
  )
}

/**
 * Mobile: drawer com nomes sempre visiveis.
 * Desktop: fixa a esquerda, completa ou recolhida (so icones) conforme o usuario.
 */
export function Sidebar({ className }: SidebarProps) {
  const location = useLocation()
  const { isOpen, close, collapsed, toggleCollapsed } = useSidebarStore()

  const closeOnMobile = () => {
    if (window.innerWidth < 1024) {
      close()
    }
  }

  // Nomes somem apenas no desktop com o menu recolhido.
  const labelClassName = cn('truncate', collapsed && 'lg:hidden')

  const linkClassName = (active: boolean) => cn(
    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
    collapsed && 'lg:justify-center lg:px-0',
    active
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  )

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-64 border-r bg-card transition-[width,transform] duration-200 ease-in-out lg:translate-x-0',
          collapsed ? 'lg:w-[72px]' : 'lg:w-64',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          className
        )}
        aria-label="Menu lateral"
      >
        <div className="flex h-full flex-col">
          <header className={cn('flex h-14 items-center justify-between border-b px-4 md:h-[72px]', collapsed && 'lg:justify-center lg:px-2')}>
            <img
              className={cn('h-auto w-[116px]', collapsed && 'lg:hidden')}
              src="/landing/logo-color.png"
              alt="VeloMail"
            />
            <img
              className={cn('hidden h-9 w-9 rounded-lg', collapsed && 'lg:block')}
              src="/favicon.png"
              alt="VeloMail"
            />

            <Button variant="ghost" size="icon" className="lg:hidden" onClick={close} aria-label="Fechar menu">
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </header>

          <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Menu principal">
            {appNavigation.map((item) => {
              const active = isRouteActive(location.pathname, item.href)
              const Icon = item.icon

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={closeOnMobile}
                  title={collapsed ? item.name : undefined}
                  className={linkClassName(active)}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className={labelClassName}>{item.name}</span>
                </Link>
              )
            })}
          </nav>

          <footer className="space-y-2 border-t p-3">
            <div className={cn(collapsed && 'lg:hidden')}>
              <PlanSummary />
            </div>

            <Link
              to="/app/developers"
              onClick={closeOnMobile}
              title={collapsed ? 'Documentação' : undefined}
              className={linkClassName(isRouteActive(location.pathname, '/app/developers'))}
            >
              <BookOpen className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className={labelClassName}>Documentação</span>
            </Link>

            <button
              type="button"
              onClick={toggleCollapsed}
              title={collapsed ? 'Expandir menu' : undefined}
              className={cn(linkClassName(false), 'hidden w-full lg:flex')}
              aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            >
              {collapsed
                ? <PanelLeftOpen className="h-5 w-5 shrink-0" aria-hidden="true" />
                : <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden="true" />}
              <span className={labelClassName}>Recolher menu</span>
            </button>
          </footer>
        </div>
      </aside>
    </>
  )
}
