import { Link, useLocation } from 'react-router-dom'
import { BookOpen, X } from 'lucide-react'
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

export function Sidebar({ className }: SidebarProps) {
  const location = useLocation()
  const { isOpen, close } = useSidebarStore()

  const closeOnMobile = () => {
    if (window.innerWidth < 1024) {
      close()
    }
  }

  const linkClassName = (active: boolean) => cn(
    'flex items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:px-2 2xl:justify-start 2xl:space-x-3 2xl:px-3',
    active
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
  )

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-64 border-r bg-background transition-[width,transform] duration-200 ease-in-out lg:w-20 lg:translate-x-0 2xl:w-64',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          className
        )}
        aria-label="Menu lateral"
      >
        <div className="flex h-full flex-col bg-card">
          <header className="flex h-[72px] items-center justify-between border-b px-5 lg:justify-center lg:px-2 2xl:justify-between 2xl:px-5">
            <div className="flex items-center space-x-2">
              <img className="hidden h-auto w-[116px] 2xl:block" src="/landing/logo-color.png" alt="VeloMail" />
              <img className="h-9 w-9 rounded-lg 2xl:hidden" src="/favicon.png" alt="VeloMail" />
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={close}
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </header>

          <nav className="flex-1 space-y-1 p-3 lg:p-2 2xl:p-3" aria-label="Menu principal">
            {appNavigation.map((item) => {
              const active = isRouteActive(location.pathname, item.href)
              const Icon = item.icon

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={closeOnMobile}
                  aria-label={item.name}
                  title={item.name}
                  className={linkClassName(active)}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span className="hidden 2xl:inline">{item.name}</span>
                </Link>
              )
            })}
          </nav>

          <footer className="space-y-2 border-t p-3 lg:p-2 2xl:p-3">
            <Link
              to="/app/developers"
              onClick={closeOnMobile}
              title="Documentação"
              aria-label="Documentação"
              className={linkClassName(isRouteActive(location.pathname, '/app/developers'))}
            >
              <BookOpen className="h-5 w-5" aria-hidden="true" />
              <span className="hidden 2xl:inline">Documentação</span>
            </Link>
            <div className="hidden 2xl:block">
              <PlanSummary />
            </div>
          </footer>
        </div>
      </aside>
    </>
  )
}
