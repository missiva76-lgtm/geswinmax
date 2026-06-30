import { useState, useEffect, useRef } from 'react'
import { Search, RefreshCw, Download } from 'lucide-react'
import { getArtigos, triggerSync } from '../services/api'
import ServerWakingBanner from '../components/ServerWakingBanner'
import { Artigo } from '../types'
import * as XLSX from 'xlsx'

const API = import.meta.env.VITE_API_URL || '/api'

interface Movimento {
  data: string
  numero_doc: string
  tipo_doc?: string
  cliente_codigo?: string
  cliente_nome?: string
  fornecedor_codigo?: string
  fornecedor_nome?: string
  artigo_codigo?: string
  artigo_descricao?: string
  familia?: string
  quantidade?: number
  preco_unitario?: number
  total: number
  total_sem_iva?: number
  pago?: boolean
  vendedor?: string
}

interface ArticlePurchaseSale {
  artigo_codigo: string
  artigo_descricao: string
  familia?: string
  total_vendas?: number
  total_vendas_sem_iva?: number
  total_compras?: number
  total_compras_sem_iva?: number
  qtd_vendas?: number
  qtd_compras?: number
}

type Tab = 'artigos' | 'vendas' | 'compras' | 'resumo'

function exportarExcel(dados: Record<string, unknown>[], nomeTab: string) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(dados)
  XLSX.utils.book_append_sheet(wb, ws, nomeTab)
  XLSX.writeFile(wb, `geswinmax_${nomeTab}_${new Date().toISOString().slice(0,10)}.xlsx`)
}

const fmt = (n: number) => (n || 0).toFixed(2).replace('.', ',') + ' €'

export default function Dados() {
  const [tab, setTab]           = useState<Tab>('artigos')
  const [artigos, setArtigos]   = useState<Artigo[]>([])
  const [vendas, setVendas]     = useState<Movimento[]>([])
  const [compras, setCompras]   = useState<Movimento[]>([])
  const [resumo, setResumo]     = useState<ArticlePurchaseSale[]>([])
  const [q, setQ]               = useState('')
  const [familiaFiltro, setFamilia] = useState('')
  const [dataInicio, setDI]     = useState('')
  const [dataFim, setDF]        = useState('')
  const [loading, setLoading]   = useState(false)
  const [syncing, setSyncing]   = useState(false)
  const [serverError, setServerError] = useState<Error | null>(null)
  const searchRef               = useRef<ReturnType<typeof setTimeout>>()

  const pesquisarArtigos = async (query: string) => {
    setLoading(true)
    try {
      const res = await getArtigos(query)
      setArtigos(res)
      setServerError(null)
    } catch(e: any) { setServerError(e) }
    setLoading(false)
  }

  const carregarMovimentos = async (tipo: 'vendas' | 'compras') => {
    setLoading(true)
    const colecao = tipo === 'vendas' ? 'movimentos_venda' : 'movimentos_compra'
    try {
      const res = await fetch(`${API}/dados/${colecao}`).then(r => r.json())
      tipo === 'vendas' ? setVendas(res) : setCompras(res)
      setServerError(null)
    } catch(e: any) { setServerError(e) }
    setLoading(false)
  }

  const carregarResumo = async () => {
    setLoading(true)
    try {
      const [v, c] = await Promise.all([
        fetch(`${API}/dados/movimentos_venda`).then(r => r.json()),
        fetch(`${API}/dados/movimentos_compra`).then(r => r.json()),
      ])
      setVendas(v)
      setCompras(c)
      setServerError(null)
    } catch(e: any) { setServerError(e) }
    setLoading(false)
  }

  useEffect(() => {
    if (tab === 'artigos') pesquisarArtigos(q)
    else if (tab === 'vendas' && vendas.length === 0) carregarMovimentos('vendas')
    else if (tab === 'compras' && compras.length === 0) carregarMovimentos('compras')
    else if (tab === 'resumo' && vendas.length === 0 && compras.length === 0) carregarResumo()
  }, [tab])

  const handleSync = async () => {
    setSyncing(true)
    await triggerSync().catch(() => {})
    setTimeout(() => { setSyncing(false); pesquisarArtigos('') }, 4000)
  }

  // Filtrar movimentos por data
  const filtrarPorData = (movs: Movimento[]) => movs.filter(m => {
    if (!dataInicio && !dataFim) return true
    const d = m.data?.split('T')[0] || m.data
    if (dataInicio && d < dataInicio) return false
    if (dataFim   && d > dataFim)    return false
    return true
  })

  // Famílias únicas para filtro (de artigos + vendas + compras)
  const familias = Array.from(new Set([
    ...artigos.map(a => (a as any).familia),
    ...vendas.map(v => v.familia),
    ...compras.map(c => c.familia),
  ].filter(Boolean))).sort()

  // Artigos filtrados
  const artigosFiltrados = artigos.filter(a => {
    if (familiaFiltro && (a as any).familia !== familiaFiltro) return false
    return true
  })

  const vendasFiltradas  = filtrarPorData(vendas).filter(v => !familiaFiltro || v.familia === familiaFiltro)
  const comprasFiltradas = filtrarPorData(compras).filter(c => !familiaFiltro || c.familia === familiaFiltro)

  // Resumo calculado a partir de vendas+compras filtradas por data e família
  const resumoCalculado: ArticlePurchaseSale[] = (() => {
    const mapa: Record<string, ArticlePurchaseSale> = {}
    for (const venda of vendasFiltradas) {
      if (!venda.artigo_codigo) continue
      const k = venda.artigo_codigo
      if (!mapa[k]) mapa[k] = { artigo_codigo: k, artigo_descricao: venda.artigo_descricao || '', familia: venda.familia || '', total_vendas: 0, total_vendas_sem_iva: 0, total_compras: 0, total_compras_sem_iva: 0, qtd_vendas: 0, qtd_compras: 0 }
      mapa[k].total_vendas! += venda.total || 0
      mapa[k].total_vendas_sem_iva! += venda.total_sem_iva || venda.total || 0
      mapa[k].qtd_vendas! += venda.quantidade || 1
    }
    for (const compra of comprasFiltradas) {
      if (!compra.artigo_codigo) continue
      const k = compra.artigo_codigo
      if (!mapa[k]) mapa[k] = { artigo_codigo: k, artigo_descricao: compra.artigo_descricao || '', familia: compra.familia || '', total_vendas: 0, total_vendas_sem_iva: 0, total_compras: 0, total_compras_sem_iva: 0, qtd_vendas: 0, qtd_compras: 0 }
      mapa[k].total_compras! += compra.total || 0
      mapa[k].total_compras_sem_iva! += compra.total_sem_iva || compra.total || 0
      mapa[k].qtd_compras! += compra.quantidade || 1
    }
    return Object.values(mapa).sort((a, b) => (b.total_vendas || 0) - (a.total_vendas || 0))
  })()

  const handleExport = () => {
    if (tab === 'artigos') {
      exportarExcel(artigosFiltrados.map(a => ({
        'Família':    (a as any).familia || '',
        'Código':     a.codigo,
        'Descrição':  a.descricao,
        'IVA (%)':    a.taxa_iva,
        'Compra S/IVA (€)': (a as any).preco_custo || 0,
        'S/ IVA (€)': (a as any).preco_sem_iva || a.preco_venda,
        'C/ IVA (€)': (a as any).preco_com_iva || a.preco_venda,
        'Stock':      (a as any).stock ?? a.existencias,
      })), 'artigos')
    } else if (tab === 'vendas') {
      exportarExcel(vendasFiltradas.map(v => ({
        'Data':         v.data,
        'Nº Doc.':      v.numero_doc,
        'Família':      v.familia || '',
        'Artigo':       v.artigo_descricao || v.artigo_codigo || '',
        'Cliente':      v.cliente_nome || v.cliente_codigo || '',
        'Qtd.':         v.quantidade || '',
        'S/ IVA (€)':   v.total_sem_iva || 0,
        'Total (€)':    v.total,
      })), 'movimentos_venda')
    } else if (tab === 'compras') {
      exportarExcel(comprasFiltradas.map(c => ({
        'Data':           c.data,
        'Nº Doc.':        c.numero_doc,
        'Família':        c.familia || '',
        'Fornecedor':     c.fornecedor_nome || c.fornecedor_codigo || '',
        'Artigo':         c.artigo_descricao || c.artigo_codigo || '',
        'Qtd.':           c.quantidade || '',
        'S/ IVA (€)':     c.total_sem_iva || 0,
        'C/ IVA (€)':     c.total,
      })), 'movimentos_compra')
    } else if (tab === 'resumo') {
      exportarExcel(resumoCalculado.map(r => ({
        'Artigo':              r.artigo_codigo,
        'Descrição':           r.artigo_descricao,
        'Família':             r.familia || '',
        'Qtd. Vendas':         r.qtd_vendas || 0,
        'Total Vendas S/IVA':  r.total_vendas_sem_iva || 0,
        'Total Vendas C/IVA':  r.total_vendas || 0,
        'Qtd. Compras':        r.qtd_compras || 0,
        'Total Compras S/IVA': r.total_compras_sem_iva || 0,
        'Total Compras C/IVA': r.total_compras || 0,
      })), 'resumo_compras_vendas')
    }
  }

  const temDados = tab === 'artigos' ? artigosFiltrados.length > 0
    : tab === 'vendas' ? vendasFiltradas.length > 0
    : tab === 'compras' ? comprasFiltradas.length > 0
    : resumoCalculado.length > 0

  return (
    <div className="flex-1 overflow-auto p-6">
      <ServerWakingBanner error={serverError} onRetry={() => pesquisarArtigos(q)} />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dados WinMax4</h2>
          <p className="text-sm text-gray-400">Artigos, existências e movimentos sincronizados</p>
          <p className="text-xs text-gray-300 mt-0.5">💡 Em "Artigos" os valores são <strong>unitários</strong>. Em "Movimentos" e "Resumo" os valores são <strong>totais por linha/documento</strong>.</p>
        </div>
        <div className="flex gap-2">
          {temDados && (
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
              <Download size={13}/> Exportar Excel
            </button>
          )}
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>
            {syncing ? 'A sincronizar...' : 'Sync agora'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {([
          { id: 'artigos',  label: 'Artigos' },
          { id: 'vendas',   label: 'Movimentos de venda' },
          { id: 'compras',  label: 'Movimentos de compra' },
          { id: 'resumo',   label: 'Resumo Compras/Vendas' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
              ${tab === t.id ? 'bg-teal-50 text-teal-700 border-teal-200' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={q}
            onChange={e => {
              setQ(e.target.value)
              clearTimeout(searchRef.current)
              searchRef.current = setTimeout(() => pesquisarArtigos(e.target.value), 400)
            }}
            placeholder={tab === 'artigos' ? 'Pesquisar por código ou descrição...' : 'Pesquisar...'}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-300"/>
        </div>
        {familias.length > 0 && (
          <select value={familiaFiltro} onChange={e => setFamilia(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-300">
            <option value="">Todas as famílias</option>
            {familias.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {(tab === 'vendas' || tab === 'compras' || tab === 'resumo') && (
          <>
            <input type="date" value={dataInicio} onChange={e => setDI(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-300"
              title="Data início"/>
            <input type="date" value={dataFim} onChange={e => setDF(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-300"
              title="Data fim"/>
            {(dataInicio || dataFim || familiaFiltro) && (
              <button onClick={() => { setDI(''); setDF(''); setFamilia('') }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2">Limpar</button>
            )}
          </>
        )}
      </div>

      {/* Tabela Artigos */}
      {tab === 'artigos' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Família</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Código</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Descrição</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">IVA</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Compra (unit. S/IVA)</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Venda S/IVA (unit.)</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Venda C/IVA (unit.)</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Stock</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && artigosFiltrados.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Sem artigos. Faz uma sync primeiro.</td></tr>
              )}
              {artigosFiltrados.map(a => (
                <tr key={a.codigo} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500">{(a as any).familia || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{a.codigo}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-800">{a.descricao}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full">{a.taxa_iva}%</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-amber-700 text-xs">{fmt((a as any).preco_custo || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500 text-xs">{fmt((a as any).preco_sem_iva || a.preco_venda)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-800 text-xs font-medium">{fmt((a as any).preco_com_iva || a.preco_venda)}</td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    {((a as any).stock ?? a.existencias ?? 0) > 0
                      ? <span className="text-teal-700 font-medium">{(a as any).stock ?? a.existencias}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabela Movimentos de Venda */}
      {tab === 'vendas' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Data</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Nº Doc.</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Família</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Artigo</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Cliente</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Qtd.</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total S/IVA</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total C/IVA</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && vendasFiltradas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Sem movimentos. Faz uma sync primeiro.</td></tr>
              )}
              {vendasFiltradas.filter(v => v.numero_doc).map((v, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-600">{v.data}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{v.numero_doc}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{v.familia || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{v.artigo_descricao || v.artigo_codigo || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{v.cliente_nome || v.cliente_codigo || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-600">{v.quantidade || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500">{fmt(v.total_sem_iva || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-800">{fmt(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabela Movimentos de Compra */}
      {tab === 'compras' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Data</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Nº Doc.</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Família</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Fornecedor</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Artigo</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Qtd.</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total S/IVA</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total C/IVA</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && comprasFiltradas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Sem movimentos. Faz uma sync primeiro.</td></tr>
              )}
              {comprasFiltradas.filter(c => c.numero_doc).map((c, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-600">{c.data}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{c.numero_doc}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{c.familia || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{c.fornecedor_nome || c.fornecedor_codigo || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{c.artigo_descricao || c.artigo_codigo || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-600">{c.quantidade || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500">{fmt(c.total_sem_iva || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-800">{fmt(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabela Resumo Compras/Vendas por Artigo */}
      {tab === 'resumo' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Família</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Código</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Descrição</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Qtd. Vendas</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Vendas S/IVA</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Vendas C/IVA</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Qtd. Compras</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Compras S/IVA</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Compras C/IVA</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && resumoCalculado.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">Sem dados. Faz uma sync primeiro.</td></tr>
              )}
              {resumoCalculado.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500">{r.familia || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{r.artigo_codigo}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-800">{r.artigo_descricao}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-600">{r.qtd_vendas || 0}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-blue-500">{fmt(r.total_vendas_sem_iva || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium text-blue-700">{fmt(r.total_vendas || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-600">{r.qtd_compras || 0}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-amber-500">{fmt(r.total_compras_sem_iva || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium text-amber-700">{fmt(r.total_compras || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
