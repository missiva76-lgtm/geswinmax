import { useState, useEffect } from 'react'
import { TrendingUp, Users, Package, Euro, RefreshCw, Calendar } from 'lucide-react'
import { triggerSyncArquivo } from '../services/api'
import ServerWakingBanner from '../components/ServerWakingBanner'

const API = import.meta.env.VITE_API_URL || '/api'

interface VendaMes {
  mes: string
  total_liquido: number
  total_iva: number
  num_documentos: number
}

interface TopItem {
  codigo: string
  nome?: string
  descricao?: string
  total: number
}

interface SaftResumo {
  periodo: string
  total_vendas: number
  total_iva_vendas: number
  num_clientes: number
  num_artigos: number
  top_clientes: TopItem[]
  top_artigos: TopItem[]
  periodo_inicio: string
  periodo_fim: string
}

function triggerSyncSAFT(di?: string, df?: string): Promise<any> {
  return fetch(`${API}/saft/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataInicio: di, dataFim: df }),
  }).then(r => r.json())
}

function BarChart({ dados }: { dados: VendaMes[] }) {
  const max = Math.max(...dados.map(d => d.total_liquido), 1)
  const fmt = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1)}k€` : `${n.toFixed(0)}€`
  return (
    <div className="flex items-end gap-1 h-32 mt-2">
      {dados.map(d => (
        <div key={d.mes} className="flex-1 flex flex-col items-center gap-1">
          <span className="text-xs text-gray-400">{fmt(d.total_liquido)}</span>
          <div
            className="w-full bg-blue-500 rounded-t-sm transition-all hover:bg-blue-600"
            style={{ height: `${Math.max((d.total_liquido / max) * 80, 2)}px` }}
            title={`${d.mes}: ${d.total_liquido.toFixed(2)}€`}/>
          <span className="text-xs text-gray-400" style={{ fontSize: '9px' }}>
            {d.mes.slice(5)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function SAFTDashboard() {
  const [resumos, setResumos]   = useState<SaftResumo[]>([])
  const [mensal, setMensal]     = useState<VendaMes[]>([])
  const [syncing, setSyncing]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [diInput, setDiInput]   = useState('')
  const [dfInput, setDfInput]   = useState('')
  const [tab, setTab]           = useState<'vendas' | 'clientes' | 'artigos'>('vendas')
  const [serverError, setServerError] = useState<Error | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/saft`).then(r => r.json()).catch((e) => { setServerError(e); return [] }),
      fetch(`${API}/saft/mensal`).then(r => r.json()).catch(() => []),
    ]).then(([r, m]) => {
      setResumos(r)
      setMensal(m)
      setLoading(false)
    })
  }, [])

  const recarregar = () => { setServerError(null); setLoading(true) }

  const handleSync = async () => {
    setSyncing(true)
    const r = await triggerSyncSAFT(diInput || undefined, dfInput || undefined).catch(() => null)
    const jobId = r?.jobId
    if (!jobId) {
      setSyncing(false)
      return
    }
    // Faz polling do job até concluir (em vez de esperar tempo fixo)
    const poll = async (tentativas = 0): Promise<void> => {
      if (tentativas > 40) { setSyncing(false); return } // máx ~2min
      const job = await fetch(`${API}/jobs/${jobId}`).then(r => r.json()).catch(() => null)
      if (job?.estado === 'concluido' || job?.estado === 'erro') {
        setSyncing(false)
        window.location.reload()
        return
      }
      setTimeout(() => poll(tentativas + 1), 3000)
    }
    poll()
  }

  const ultimo = resumos[0]
  const fmt    = (n: number) => n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const pct    = (n: number, t: number) => t > 0 ? ` (${((n/t)*100).toFixed(1)}%)` : ''

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">SAF-T</h2>
          <p className="text-sm text-gray-400">Indicadores fiscais e de vendas</p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="text" placeholder="01/01/2026" value={diInput}
            onChange={e => setDiInput(e.target.value)}
            className="w-24 px-2 py-1.5 text-xs border border-gray-200 rounded-lg"/>
          <input type="text" placeholder="hoje" value={dfInput}
            onChange={e => setDfInput(e.target.value)}
            className="w-24 px-2 py-1.5 text-xs border border-gray-200 rounded-lg"/>
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>
            {syncing ? 'A importar...' : 'Importar SAF-T'}
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400 text-center py-12">A carregar...</p>}

      {!loading && resumos.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
          <Calendar size={32} className="mx-auto mb-3 text-gray-300"/>
          <p className="text-sm text-gray-500 mb-1">Sem dados SAF-T importados</p>
          <p className="text-xs text-gray-400">Clica em "Importar SAF-T" para importar o ano actual</p>
        </div>
      )}

      {!loading && ultimo && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { icon: Euro,      label: 'Vendas líquidas',  value: fmt(ultimo.total_vendas),                 cor: 'text-teal-700' },
              { icon: Euro,      label: 'IVA liquidado',    value: fmt(ultimo.total_iva_vendas),              cor: 'text-purple-700' },
              { icon: Users,     label: 'Clientes activos', value: ultimo.num_clientes.toString(),            cor: 'text-blue-700' },
              { icon: Package,   label: 'Artigos vendidos', value: ultimo.num_artigos.toString(),             cor: 'text-amber-700' },
            ].map(({ icon: Icon, label, value, cor }) => (
              <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className={cor}/>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
                <p className={`text-xl font-semibold ${cor}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Período */}
          <p className="text-xs text-gray-400 mb-4">
            Período: {ultimo.periodo_inicio} → {ultimo.periodo_fim}
          </p>

          {/* Evolução mensal */}
          {mensal.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl p-5 mb-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <TrendingUp size={14} className="text-blue-500"/> Evolução de vendas mensal
                </p>
                <span className="text-xs text-gray-400">{mensal.length} meses</span>
              </div>
              <BarChart dados={mensal.slice(-12)}/>
            </div>
          )}

          {/* Tabs: Detalhes */}
          <div className="flex gap-1.5 mb-3">
            {([
              { id: 'vendas',    label: 'Vendas por mês' },
              { id: 'clientes',  label: 'Top clientes' },
              { id: 'artigos',   label: 'Top artigos' },
            ] as { id: typeof tab; label: string }[]).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
                  ${tab === t.id
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {/* Vendas por mês */}
            {tab === 'vendas' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Mês</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Docs.</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total líquido</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">IVA</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total c/IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {mensal.slice().reverse().map(m => (
                    <tr key={m.mes} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-800 text-xs">{m.mes}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-600">{m.num_documentos}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-800">{fmt(m.total_liquido)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-purple-600">{fmt(m.total_iva)}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-teal-700">{fmt(m.total_liquido + m.total_iva)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-medium">
                    <td className="px-4 py-2.5 text-xs text-gray-700">Total</td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-700">{mensal.reduce((s,m) => s + m.num_documentos, 0)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-800">{fmt(mensal.reduce((s,m) => s + m.total_liquido, 0))}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-purple-700">{fmt(mensal.reduce((s,m) => s + m.total_iva, 0))}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-teal-700">{fmt(mensal.reduce((s,m) => s + m.total_liquido + m.total_iva, 0))}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Top clientes */}
            {tab === 'clientes' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">#</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Cliente</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">% vendas</th>
                  </tr>
                </thead>
                <tbody>
                  {(ultimo.top_clientes || []).map((c, i) => (
                    <tr key={c.codigo} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-xs text-gray-400">{i+1}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-medium text-gray-800">{c.nome || c.codigo}</div>
                        {c.nome && <div className="text-xs text-gray-400">{c.codigo}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-800">{fmt(c.total)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-500">{pct(c.total, ultimo.total_vendas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Top artigos */}
            {tab === 'artigos' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">#</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Artigo</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total vendido</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">% vendas</th>
                  </tr>
                </thead>
                <tbody>
                  {(ultimo.top_artigos || []).map((a, i) => (
                    <tr key={a.codigo} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-xs text-gray-400">{i+1}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-medium text-gray-800">{a.codigo}</div>
                        {a.descricao && <div className="text-xs text-gray-400">{a.descricao}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-800">{fmt(a.total)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-500">{pct(a.total, ultimo.total_vendas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
