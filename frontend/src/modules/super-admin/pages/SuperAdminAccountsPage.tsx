import { startTransition, useDeferredValue, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { superAdminApi } from '@/lib/api'
import { AccountPlanDialog } from '../AccountPlanDialog'
import type { AccountRow } from '../types'
import { boolBadge, toPagination } from '../utils'

export function SuperAdminAccountsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [planAccount, setPlanAccount] = useState<AccountRow | null>(null)

  const deferredSearch = useDeferredValue(search.trim())
  const params = useMemo(() => ({
    page,
    limit: 20,
    search: deferredSearch || undefined
  }), [page, deferredSearch])

  const accountsQuery = useQuery({
    queryKey: ['super-admin', 'accounts', params],
    queryFn: async () => {
      const payload = (await superAdminApi.getAccounts(params)).data.data
      return {
        rows: (payload.accounts || []) as AccountRow[],
        pagination: toPagination(payload.pagination)
      }
    }
  })

  const securityMutation = useMutation({
    mutationFn: async (payload: { accountId: number; is_suspended?: boolean; email_sending_blocked?: boolean; reason: string }) =>
      superAdminApi.updateAccountSecurity(payload.accountId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'audit'] })
      ])
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || error?.message || 'Falha ao atualizar segurança')
    }
  })

  const rows = accountsQuery.data?.rows || []
  const pagination = accountsQuery.data?.pagination

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Contas</CardTitle>
          <CardDescription>Gestão de contas do SaaS, planos e bloqueios operacionais.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por email ou nome"
              value={search}
              onChange={(event) => startTransition(() => {
                setSearch(event.target.value)
                setPage(1)
              })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Conta</th>
                <th className="px-2 py-2">Plano</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Envio</th>
                <th className="px-2 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {accountsQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">Carregando contas...</td>
                </tr>
              )}
              {!accountsQuery.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">Nenhuma conta encontrada.</td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-2 py-3">
                    <div className="font-medium">{row.name || 'Sem nome'}</div>
                    <div className="text-xs text-muted-foreground">#{row.id} - {row.email}</div>
                  </td>
                  <td className="px-2 py-3">
                    {row.plan_name && row.plan_status !== 'canceled'
                      ? <Badge variant="outline">{row.plan_name}</Badge>
                      : <span className="text-xs text-muted-foreground">Plano padrão</span>}
                  </td>
                  <td className="px-2 py-3">
                    {row.is_suspended
                      ? <Badge variant="destructive">Suspensa</Badge>
                      : row.is_active
                        ? <Badge variant="success">Ativa</Badge>
                        : <Badge variant="secondary">Inativa</Badge>}
                  </td>
                  <td className="px-2 py-3">{boolBadge(!Boolean(row.email_sending_blocked), 'Liberado', 'Bloqueado')}</td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setPlanAccount(row)}>
                        Plano e limites
                      </Button>
                      <Button
                        size="sm"
                        variant={row.is_suspended ? 'default' : 'destructive'}
                        onClick={() => securityMutation.mutate({
                          accountId: row.id,
                          is_suspended: !Boolean(row.is_suspended),
                          reason: 'Atualização de suspensão de conta'
                        })}
                      >
                        {row.is_suspended ? 'Reativar' : 'Suspender'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => securityMutation.mutate({
                          accountId: row.id,
                          email_sending_blocked: !Boolean(row.email_sending_blocked),
                          reason: 'Atualização de bloqueio de envio'
                        })}
                      >
                        {row.email_sending_blocked ? 'Liberar envio' : 'Bloquear envio'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
        <CardContent className="flex items-center justify-between pt-0">
          <span className="text-xs text-muted-foreground">
            Total: {pagination?.total || 0}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={(pagination?.page || 1) <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              {pagination?.page || 1}/{pagination?.total_pages || 1}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={(pagination?.page || 1) >= (pagination?.total_pages || 1)}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
        </CardContent>
      </Card>

      <AccountPlanDialog account={planAccount} onClose={() => setPlanAccount(null)} />
    </div>
  )
}
