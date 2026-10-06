import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { superAdminApi } from '@/lib/api'
import type { PlanRow } from '../types'
import { formatNumber } from '../utils'

const LIMIT_FIELDS = [
  { key: 'emails_per_minute', label: 'Emails por minuto' },
  { key: 'emails_per_hour', label: 'Emails por hora' },
  { key: 'emails_per_day', label: 'Emails por dia' },
  { key: 'emails_per_month', label: 'Emails por mês' },
  { key: 'domains_limit', label: 'Domínios' },
  { key: 'webhooks_limit', label: 'Webhooks ativos' }
] as const

type LimitField = typeof LIMIT_FIELDS[number]['key']

interface PlanForm extends Record<LimitField, string> {
  slug: string
  name: string
  description: string
  price: string
  sort_order: string
  is_active: boolean
  is_default: boolean
}

const emptyForm: PlanForm = {
  slug: '',
  name: '',
  description: '',
  price: '0',
  sort_order: '0',
  is_active: true,
  is_default: false,
  emails_per_minute: '10',
  emails_per_hour: '100',
  emails_per_day: '1000',
  emails_per_month: '25000',
  domains_limit: '5',
  webhooks_limit: '10'
}

const toForm = (plan: PlanRow): PlanForm => ({
  slug: plan.slug,
  name: plan.name,
  description: plan.description || '',
  price: (plan.monthly_price_cents / 100).toFixed(2),
  sort_order: String(plan.sort_order),
  is_active: plan.is_active,
  is_default: plan.is_default,
  emails_per_minute: String(plan.emails_per_minute),
  emails_per_hour: String(plan.emails_per_hour),
  emails_per_day: String(plan.emails_per_day),
  emails_per_month: String(plan.emails_per_month),
  domains_limit: String(plan.domains_limit),
  webhooks_limit: String(plan.webhooks_limit)
})

const formatPrice = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function SuperAdminPlansPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<PlanRow | 'new' | null>(null)
  const [form, setForm] = useState<PlanForm>(emptyForm)

  const plansQuery = useQuery({
    queryKey: ['super-admin', 'plans'],
    queryFn: async () => ((await superAdminApi.getPlans()).data.data.plans || []) as PlanRow[]
  })

  const openEditor = (target: PlanRow | 'new') => {
    setForm(target === 'new' ? emptyForm : toForm(target))
    setEditing(target)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const numbers = Object.fromEntries(
        LIMIT_FIELDS.map(({ key, label }) => {
          const value = Number(form[key])
          if (form[key].trim() === '' || !Number.isInteger(value) || value < 0) {
            throw new Error(`${label}: informe um número inteiro maior ou igual a zero`)
          }
          return [key, value]
        })
      )
      const price = Number(form.price.replace(',', '.'))
      if (!Number.isFinite(price) || price < 0) {
        throw new Error('Preço inválido')
      }

      const payload = {
        ...numbers,
        name: form.name.trim(),
        description: form.description.trim() || null,
        monthly_price_cents: Math.round(price * 100),
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        is_default: form.is_default
      }

      if (editing === 'new') {
        await superAdminApi.createPlan({ ...payload, slug: form.slug.trim().toLowerCase() })
      } else if (editing) {
        await superAdminApi.updatePlan(editing.id, payload)
      }
    },
    onSuccess: async () => {
      toast.success('Plano salvo')
      setEditing(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'plans'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'audit'] })
      ])
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Falha ao salvar plano')
    }
  })

  const plans = plansQuery.data || []
  const setField = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Planos</CardTitle>
            <CardDescription>
              Catálogo de planos e limites. Alterações valem para todas as contas do plano em até 15 segundos;
              limites personalizados de uma conta são definidos em Contas.
            </CardDescription>
          </div>
          <Button onClick={() => openEditor('new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo plano
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Plano</th>
                <th className="px-2 py-2">Preço/mês</th>
                <th className="px-2 py-2">Emails (min / hora / dia / mês)</th>
                <th className="px-2 py-2">Domínios</th>
                <th className="px-2 py-2">Webhooks</th>
                <th className="px-2 py-2">Contas</th>
                <th className="px-2 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {plansQuery.isLoading && (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">Carregando planos...</td>
                </tr>
              )}
              {plansQuery.isError && (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-destructive">Não foi possível carregar os planos.</td>
                </tr>
              )}
              {plans.map((plan) => (
                <tr key={plan.id} className="border-t">
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {plan.name}
                      {plan.is_default && <Badge variant="outline">Padrão</Badge>}
                      {!plan.is_active && <Badge variant="secondary">Inativo</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{plan.slug}</div>
                  </td>
                  <td className="px-2 py-3">{formatPrice(plan.monthly_price_cents)}</td>
                  <td className="px-2 py-3 tabular-nums">
                    {[plan.emails_per_minute, plan.emails_per_hour, plan.emails_per_day, plan.emails_per_month]
                      .map(formatNumber)
                      .join(' / ')}
                  </td>
                  <td className="px-2 py-3 tabular-nums">{formatNumber(plan.domains_limit)}</td>
                  <td className="px-2 py-3 tabular-nums">{formatNumber(plan.webhooks_limit)}</td>
                  <td className="px-2 py-3 tabular-nums">{formatNumber(plan.accounts)}</td>
                  <td className="px-2 py-3">
                    <Button size="sm" variant="outline" onClick={() => openEditor(plan)}>Editar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          Contas sem plano atribuído usam o plano padrão. "Contas" mostra apenas as com plano atribuído manualmente.
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Novo plano' : `Editar plano ${form.name}`}</DialogTitle>
            <DialogDescription>
              Os limites são aplicados no envio de emails e na criação de domínios e webhooks.
            </DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              saveMutation.mutate()
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan-name">Nome</Label>
                <Input id="plan-name" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setField('name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-slug">Identificador</Label>
                <Input
                  id="plan-slug"
                  required
                  disabled={editing !== 'new'}
                  pattern="[a-z0-9][a-z0-9\-]{1,78}"
                  title="Letras minúsculas, números e hífen"
                  placeholder="ex.: starter"
                  value={form.slug}
                  onChange={(e) => setField('slug', e.target.value.toLowerCase())}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="plan-description">Descrição</Label>
                <Input id="plan-description" maxLength={1000} value={form.description} onChange={(e) => setField('description', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-price">Preço mensal (R$)</Label>
                <Input id="plan-price" inputMode="decimal" value={form.price} onChange={(e) => setField('price', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-order">Ordem de exibição</Label>
                <Input id="plan-order" type="number" min={0} value={form.sort_order} onChange={(e) => setField('sort_order', e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {LIMIT_FIELDS.map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`plan-${key}`}>{label}</Label>
                  <Input
                    id={`plan-${key}`}
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2 text-sm">
                <Switch aria-label="Ativo" checked={form.is_active} onCheckedChange={(checked) => setField('is_active', checked)} />
                Ativo
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Switch aria-label="Plano padrão" checked={form.is_default} onCheckedChange={(checked) => setField('is_default', checked)} />
                Plano padrão para contas sem plano
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar plano
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
