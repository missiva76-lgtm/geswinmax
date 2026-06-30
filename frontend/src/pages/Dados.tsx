import { useState, useEffect, useRef } from 'react'
import { Search, RefreshCw, Download, ChevronUp, ChevronDown } from 'lucide-react'
import { getArtigos, triggerSync } from '../services/api'
import ServerWakingBanner from '../components/ServerWakingBanner'
import { Artigo } from '../types'
import * as XLSX from 'xlsx'

const API = import.meta.env.VITE_API_URL || '/api'
const PAGE_SIZE = 100

interface Movimento {
  id?: string
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
type SortDir = 'asc' | 'desc'

function exportarExcel(dados: Record<string, unknown>[], nomeTab: string) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(dados)
  XLSX.utils.book_append_sheet(wb, ws, nomeTab)
  XLSX.writeFile(wb, `geswinmax_${nomeTab}_${new Date().toISOString().slice(0,10)}.xlsx`)
}

const fmt = (n: number) => (n || 0).toFixed(2).replace('.', ',') + ' €'

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: SortDir }) {
  if (sortField !== field) return <span className="text-gray-300 ml-1">↕</span>
  return sortDir === 'asc' ? <ChevronUp size={12} className="inline ml-1 text-teal-600"/> : <ChevronDown size={12} className="inline ml-1 text-teal-600"/>
}

function SortTh({ label, field, sortField, sortDir, onSort, className = '' }: any) {
  return (
    <th onClick={() => onSort(field)}
      className={`px-4 py-2.5 text-xs font-medium text-gray-500 cursor-pointer hover:text-teal-600 select-none ${className}`}>
      {label}<SortIcon field={field} sortField={sortField} sortDir={sortDir}/>
    </th>
  )
}

export default function Dados() {
  const [tab, setTab]           = useState<Tab>('artigos')
  const [artigos, setArtigos]   = useState<Artigo[]>([])
  const [vendas, setVendas]     = useState<Movimento[]>([])
  const [compras, setCompras]   = useState<Movimento[]>([])
  const [q, setQ]               = useState('')
  const [familiaFiltro, setFamilia] = useState('')
  const [dataInicio, setDI]     = useState('')
  const [dataFim, setDF]        = useState('')
  const [loading, setLoading]   = useState(false)
  const [syncing, setSyncing]   = useState(false)
  const [serverError, setServerError] = useState<Error | null>(null)
  const [page, setPage]         = useState(1)
  const [sortField, setSortField] = useState('data')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const searchRef               = useRef<ReturnType<typeof setTimeout>>()

  const pesquisarArtigos = async (query: string) => {
    setLoading(true)
    try {
      const res = await getArtigos(query)
      setArtigos(res)
      setServerError(null)
    } catch(e: any) { setServerError(e) }
    setLoading(false)
    setPage(1)
  }

  const carregarMovimentos = async (tipo: 'vendas' | 'compras') => {
    setLoading(true)
    const col = tipo === 'vendas' ? 'movimentos_venda' : 'movimentos_compra'
    try {
      const res = await fetch(`${API}/dados/${col}`).then(r => r.json())
      tipo === 'vendas' ? setVendas(res) : setCompras(res)
      setServerError(null)
    } catch(e: any) { setServerError(e) }
    setLoading(false)
    setPage(1)
  }

  useEffect(() => {
    if (tab === 'artigos') pesquisarArtigos(q)
    else if (tab === 'vendas' && vendas.length === 0) carregarMovimentos('vendas')
    else if (tab === 'compras' && compras.length === 0) carregarMovimentos('compras')
    else if (tab === 'resumo') {
      if (vendas.length === 0) carregarMovimentos('vendas')
      if (compras.length === 0) carregarMovimentos('compras')
    }
  }, [tab])

  const handleSync = async () => {
    setSyncing(true)
    await triggerSync().catch(() => {})
    setTimeout(() => { setSyncing(false); pesquisarArtigos('') }, 4000)
  }

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(1)
  }

  // Filtro por data — aceita formato DD/MM/YYYY ou YYYY/MM/DD
  const parseDateStr = (d: string) => {
    if (!d) return null
    const clean = d.split(' ')[0]
    // YYYY/MM/DD ou YYYY-MM-DD
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(clean)) return clean.replace(/\//g, '-').substring(0, 10)
    // DD/MM/YYYY
    const p = clean.split('/')
    if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1]}-${p[0]}`
    return clean.substring(0, 10)
  }

  const filtrarPorData = (movs: Movimento[]) => movs.filter(m => {
    if (!dataInicio && !dataFim) return true
    const d = parseDateStr(m.data)
    if (!d) return true
    if (dataInicio && d < dataInicio) return false
    if (dataFim   && d > dataFim)    return false
    return true
  })

  const filtrarPorFamilia = (movs: Movimento[]) =>
    !familiaFiltro ? movs : movs.filter(m => m.familia === familiaFiltro)

  // Ordenação genérica
  const sortMovs = (movs: Movimento[]) => [...movs].sort((a, b) => {
    const va = (a as any)[sortField] ?? ''
    const vb = (b as any)[sortField] ?? ''
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt')
    return sortDir === 'asc' ? cmp : -cmp
  })

  const sortArtigos = (arts: Artigo[]) => [...arts].sort((a, b) => {
    const va = (a as any)[sortField] ?? ''
    const vb = (b as any)[sortField] ?? ''
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt')
    return sortDir === 'asc' ? cmp : -cmp
  })

  const familias = Array.from(new Set([
    ...artigos.map(a => (a as any).familia),
    ...vendas.map(v => v.familia),
    ...compras.map(c => c.familia),
  ].filter(Boolean))).sort()

  const artigosFiltrados = sortArtigos(artigos.filter(a => {
    if (familiaFiltro && (a as any).familia !== familiaFiltro) return false
    if (q) {
      const qu = q.toUpperCase()
      return a.codigo?.toUpperCase().includes(qu) || a.descricao?.toUpperCase().includes(qu)
    }
    return true
  }))

  const vendasFiltradas  = sortMovs(filtrarPorFamilia(filtrarPorData(vendas)).filter(v => v.numero_doc && v.artigo_codigo))
  const comprasFiltradas = sortMovs(filtrarPorFamilia(filtrarPorData(compras)).filter(c => c.numero_doc && c.artigo_codigo))

  const resumoCalculado: ArticlePurchaseSale[] = (() => {
    const mapa: Record<string, ArticlePurchaseSale> = {}
    for (const venda of filtrarPorFamilia(filtrarPorData(vendas))) {
      if (!venda.artigo_codigo) continue
      const k = venda.artigo_codigo
      if (!mapa[k]) mapa[k] = { artigo_codigo: k, artigo_descricao: venda.artigo_descricao || '', familia: venda.familia || '', total_vendas: 0, total_vendas_sem_iva: 0, total_compras: 0, total_compras_sem_iva: 0, qtd_vendas: 0, qtd_compras: 0 }
      mapa[k].total_vendas! += venda.total || 0
      mapa[k].total_vendas_sem_iva! += venda.total_sem_iva || 0
      mapa[k].qtd_vendas! += venda.quantidade || 1
    }
    for (const compra of filtrarPorFamilia(filtrarPorData(compras))) {
      if (!compra.artigo_codigo) continue
      const k = compra.artigo_codigo
      if (!mapa[k]) mapa[k] = { artigo_codigo: k, artigo_descricao: compra.artigo_descricao || '', familia: compra.familia || '', total_vendas: 0, total_vendas_sem_iva: 0, total_compras: 0, total_compras_sem_iva: 0, qtd_vendas: 0, qtd_compras: 0 }
      mapa[k].total_compras! += compra.total || 0
      mapa[k].total_compras_sem_iva! += compra.total_sem_iva || 0
      mapa[k].qtd_compras! += compra.quantidade || 1
    }
    return Object.values(mapa).sort((a, b) => (b.total_vendas || 0) - (a.total_vendas || 0))
  })()

  // Paginação
  const paginate = <T,>(arr: T[]) => arr.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = (total: number) => Math.ceil(total / PAGE_SIZE)

  const handleExport = () => {
    if (tab === 'artigos') exportarExcel(artigosFiltrados.map(a => ({
      'Família': (a as any).familia || '', 'Código': a.codigo, 'Descrição': a.descricao,
      'IVA (%)': a.taxa_iva, 'Compra S/IVA (€)': (a as any).preco_custo || 0,
      'Venda S/IVA (€)': (a as any).preco_sem_iva || 0, 'Venda C/IVA (€)': (a as any).preco_com_iva || 0,
      'Stock': (a as any).stock ?? a.existencias,
    })), 'artigos')
    else if (tab === 'vendas') exportarExcel(vendasFiltradas.map(v => ({
      'Data': v.data, 'Nº Doc.': v.numero_doc, 'Família': v.familia || '',
      'Artigo': v.artigo_descricao || v.artigo_codigo || '', 'Cliente': v.cliente_nome || '',
      'Qtd.': v.quantidade || '', 'Total S/IVA (€)': v.total_sem_iva || 0, 'Total C/IVA (€)': v.total,
    })), 'movimentos_venda')
    else if (tab === 'compras') exportarExcel(comprasFiltradas.map(c => ({
      'Data': c.data, 'Nº Doc.': c.numero_doc, 'Família': c.familia || '',
      'Fornecedor': c.fornecedor_nome || '', 'Artigo': c.artigo_descricao || c.artigo_codigo || '',
      'Qtd.': c.quantidade || '', 'Total S/IVA (€)': c.total_sem_iva || 0, 'Total C/IVA (€)': c.total,
    })), 'movimentos_compra')
    else exportarExcel(resumoCalculado.map(r => ({
      'Família': r.familia || '', 'Código': r.artigo_codigo, 'Descrição': r.artigo_descricao,
      'Qtd. Vendas': r.qtd_vendas || 0, 'Vendas S/IVA (€)': r.total_vendas_sem_iva || 0,
      'Vendas C/IVA (€)': r.total_vendas || 0, 'Qtd. Compras': r.qtd_compras || 0,
      'Compras S/IVA (€)': r.total_compras_sem_iva || 0, 'Compras C/IVA (€)': r.total_compras || 0,
    })), 'resumo')
  }

  const Pager = ({ total }: { total: number }) => {
    const tp = totalPages(total)
    if (tp <= 1) return null
    return (
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-50 bg-gray-50">
        <span className="text-xs text-gray-400">{total} registos — pág. {page} de {tp}</span>
        <div className="flex gap-1">
          <button onClick={() => setPage(1)} disabled={page===1} className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40">«</button>
          <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40">‹</button>
          <button onClick={() => setPage(p => Math.min(tp,p+1))} disabled={page===tp} className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40">›</button>
          <button onClick={() => setPage(tp)} disabled={page===tp} className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40">»</button>
        </div>
      </div>
    )
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
          {temDados && <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"><Download size={13}/> Exportar Excel</button>}
          <button onClick={handleSync} disabled={syncing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>{syncing ? 'A sincronizar...' : 'Sync agora'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {([['artigos','Artigos'],['vendas','Movimentos de venda'],['compras','Movimentos de compra'],['resumo','Resumo Compras/Vendas']] as [Tab,string][]).map(([id,label]) => (
          <button key={id} onClick={() => { setTab(id); setPage(1) }}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${tab===id ? 'bg-teal-50 text-teal-700 border-teal-200' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={q} onChange={e => {
              setQ(e.target.value); clearTimeout(searchRef.current)
              if (tab === 'artigos') searchRef.current = setTimeout(() => pesquisarArtigos(e.target.value), 400)
              setPage(1)
            }}
            placeholder="Pesquisar..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-300"/>
        </div>
        {familias.length > 0 && (
          <select value={familiaFiltro} onChange={e => { setFamilia(e.target.value); setPage(1) }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2">
            <option value="">Todas as famílias</option>
            {familias.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {tab !== 'artigos' && (<>
          <input type="date" value={dataInicio} onChange={e => { setDI(e.target.value); setPage(1) }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2" title="Data início"/>
          <input type="date" value={dataFim} onChange={e => { setDF(e.target.value); setPage(1) }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2" title="Data fim"/>
          {(dataInicio || dataFim || familiaFiltro) && (
            <button onClick={() => { setDI(''); setDF(''); setFamilia(''); setPage(1) }}
              className="text-xs text-gray-400 hover:text-gray-600 px-2">Limpar</button>
          )}
        </>)}
      </div>

      {/* Tabela Artigos */}
      {tab === 'artigos' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <SortTh label="Família" field="familia" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Código" field="codigo" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Descrição" field="descricao" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="IVA" field="taxa_iva" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Compra S/IVA (unit.)" field="preco_custo" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Venda S/IVA (unit.)" field="preco_sem_iva" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Venda C/IVA (unit.)" field="preco_com_iva" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Stock" field="stock" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && artigosFiltrados.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Sem artigos.</td></tr>}
              {paginate(artigosFiltrados).map(a => (
                <tr key={a.codigo} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500">{(a as any).familia || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{a.codigo}</td>
                  <td className="px-4 py-2 text-xs text-gray-800">{a.descricao}</td>
                  <td className="px-4 py-2 text-right"><span className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full">{a.taxa_iva}%</span></td>
                  <td className="px-4 py-2 text-right text-amber-700 text-xs">{fmt((a as any).preco_custo || 0)}</td>
                  <td className="px-4 py-2 text-right text-gray-500 text-xs">{fmt((a as any).preco_sem_iva || 0)}</td>
                  <td className="px-4 py-2 text-right text-gray-800 text-xs font-medium">{fmt((a as any).preco_com_iva || 0)}</td>
                  <td className="px-4 py-2 text-right text-xs">
                    {((a as any).stock ?? a.existencias ?? 0) > 0
                      ? <span className="text-teal-700 font-medium">{(a as any).stock ?? a.existencias}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={artigosFiltrados.length}/>
        </div>
      )}

      {/* Tabela Vendas */}
      {tab === 'vendas' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <SortTh label="Data" field="data" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Nº Doc." field="numero_doc" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Família" field="familia" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Artigo" field="artigo_descricao" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Cliente" field="cliente_nome" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Qtd." field="quantidade" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Total S/IVA" field="total_sem_iva" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Total C/IVA" field="total" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && vendasFiltradas.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Sem movimentos.</td></tr>}
              {paginate(vendasFiltradas).map((v, i) => (
                <tr key={v.id || i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-600">{v.data}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{v.numero_doc}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{v.familia || '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-700">{v.artigo_descricao || v.artigo_codigo}</td>
                  <td className="px-4 py-2 text-xs text-gray-700">{v.cliente_nome || v.cliente_codigo || '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600">{v.quantidade || '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-500">{fmt(v.total_sem_iva || 0)}</td>
                  <td className="px-4 py-2 text-right text-xs font-medium text-gray-800">{fmt(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={vendasFiltradas.length}/>
        </div>
      )}

      {/* Tabela Compras */}
      {tab === 'compras' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <SortTh label="Data" field="data" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Nº Doc." field="numero_doc" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Família" field="familia" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Fornecedor" field="fornecedor_nome" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Artigo" field="artigo_descricao" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Qtd." field="quantidade" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Total S/IVA" field="total_sem_iva" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Total C/IVA" field="total" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && comprasFiltradas.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Sem movimentos.</td></tr>}
              {paginate(comprasFiltradas).map((c, i) => (
                <tr key={c.id || i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-600">{c.data}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{c.numero_doc}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{c.familia || '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-700">{c.fornecedor_nome || c.fornecedor_codigo || '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-700">{c.artigo_descricao || c.artigo_codigo}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600">{c.quantidade || '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-500">{fmt(c.total_sem_iva || 0)}</td>
                  <td className="px-4 py-2 text-right text-xs font-medium text-gray-800">{fmt(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={comprasFiltradas.length}/>
        </div>
      )}

      {/* Resumo */}
      {tab === 'resumo' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <SortTh label="Família" field="familia" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Código" field="artigo_codigo" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Descrição" field="artigo_descricao" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left"/>
                <SortTh label="Qtd. Vendas" field="qtd_vendas" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Vendas S/IVA" field="total_vendas_sem_iva" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Vendas C/IVA" field="total_vendas" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Qtd. Compras" field="qtd_compras" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Compras S/IVA" field="total_compras_sem_iva" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
                <SortTh label="Compras C/IVA" field="total_compras" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right"/>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && resumoCalculado.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">Sem dados. Faz uma sync primeiro.</td></tr>}
              {paginate(resumoCalculado).map((r, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500">{r.familia || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{r.artigo_codigo}</td>
                  <td className="px-4 py-2 text-xs text-gray-800">{r.artigo_descricao}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600">{r.qtd_vendas || 0}</td>
                  <td className="px-4 py-2 text-right text-xs text-blue-500">{fmt(r.total_vendas_sem_iva || 0)}</td>
                  <td className="px-4 py-2 text-right text-xs font-medium text-blue-700">{fmt(r.total_vendas || 0)}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600">{r.qtd_compras || 0}</td>
                  <td className="px-4 py-2 text-right text-xs text-amber-500">{fmt(r.total_compras_sem_iva || 0)}</td>
                  <td className="px-4 py-2 text-right text-xs font-medium text-amber-700">{fmt(r.total_compras || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={resumoCalculado.length}/>
        </div>
      )}
    </div>
  )
}
