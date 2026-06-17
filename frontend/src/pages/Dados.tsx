import { useState, useEffect } from 'react'
import { Search, RefreshCw, Download } from 'lucide-react'
import { getArtigos, triggerSync } from '../services/api'
import { Artigo } from '../types'
import * as XLSX from 'xlsx'

const API = import.meta.env.VITE_API_URL || '/api'

interface Movimento {
  data: string
  numero_doc: string
  tipo_doc: string
  cliente_codigo?: string
  cliente_nome?: string
  fornecedor_codigo?: string
  fornecedor_nome?: string
  artigo_codigo: string
  artigo_descricao: string
  quantidade: number
  preco_unitario: number
  total: number
}

type Tab = 'artigos' | 'vendas' | 'compras'

function exportarExcel(dados: Record<string, unknown>[], nomeTab: string) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(dados)
  XLSX.utils.book_append_sheet(wb, ws, nomeTab)
  XLSX.writeFile(wb, `geswinmax_${nomeTab}_${new Date().toISOString().slice(0,10)}.xlsx`)
}

export default function Dados() {
  const [tab, setTab]           = useState<Tab>('artigos')
  const [artigos, setArtigos]   = useState<Artigo[]>([])
  const [vendas, setVendas]     = useState<Movimento[]>([])
  const [compras, setCompras]   = useState<Movimento[]>([])
  const [q, setQ]               = useState('')
  const [loading, setLoading]   = useState(false)
  const [syncing, setSyncing]   = useState(false)

  const pesquisarArtigos = async (query: string) => {
    setLoading(true)
    const res = await getArtigos(query).catch(() => [])
    setArtigos(res)
    setLoading(false)
  }

  const carregarMovimentos = async (tipo: 'vendas' | 'compras') => {
    setLoading(true)
    const colecao = tipo === 'vendas' ? 'movimentos_venda' : 'movimentos_compra'
    const res = await fetch(`${API}/dados/${colecao}`).then(r => r.json()).catch(() => [])
    tipo === 'vendas' ? setVendas(res) : setCompras(res)
    setLoading(false)
  }

  useEffect(() => {
    if (tab === 'artigos') pesquisarArtigos(q)
    else if (tab === 'vendas' && vendas.length === 0) carregarMovimentos('vendas')
    else if (tab === 'compras' && compras.length === 0) carregarMovimentos('compras')
  }, [tab])

  const handleSync = async () => {
    setSyncing(true)
    await triggerSync().catch(() => {})
    setTimeout(() => {
      setSyncing(false)
      pesquisarArtigos('')
    }, 4000)
  }

  const handleExport = () => {
    if (tab === 'artigos') {
      exportarExcel(artigos.map(a => ({
        'Código':       a.codigo,
        'Descrição':    a.descricao,
        'IVA (%)':      a.taxa_iva,
        'PVP (€)':      a.preco_venda,
        'Stock':        a.existencias,
      })), 'artigos')
    } else if (tab === 'vendas') {
      exportarExcel(vendas.map(v => ({
        'Data':           v.data,
        'Nº Documento':   v.numero_doc,
        'Tipo':           v.tipo_doc,
        'Cód. Cliente':   v.cliente_codigo || '',
        'Cliente':        v.cliente_nome || '',
        'Cód. Artigo':    v.artigo_codigo,
        'Artigo':         v.artigo_descricao,
        'Quantidade':     v.quantidade,
        'Preço Unit.':    v.preco_unitario,
        'Total (€)':      v.total,
      })), 'movimentos_venda')
    } else {
      exportarExcel(compras.map(c => ({
        'Data':             c.data,
        'Nº Documento':     c.numero_doc,
        'Tipo':             c.tipo_doc,
        'Cód. Fornecedor':  c.fornecedor_codigo || '',
        'Fornecedor':       c.fornecedor_nome || '',
        'Cód. Artigo':      c.artigo_codigo,
        'Artigo':           c.artigo_descricao,
        'Quantidade':       c.quantidade,
        'Preço Unit.':      c.preco_unitario,
        'Total (€)':        c.total,
      })), 'movimentos_compra')
    }
  }

  const fmt = (n: number) => n.toFixed(2).replace('.', ',') + ' €'

  const dadosActuais = tab === 'artigos' ? artigos.length
    : tab === 'vendas' ? vendas.length : compras.length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dados WinMax4</h2>
          <p className="text-sm text-gray-400">Artigos, existências e movimentos sincronizados</p>
        </div>
        <div className="flex gap-2">
          {dadosActuais > 0 && (
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              <Download size={13}/>
              Exportar Excel
            </button>
          )}
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>
            {syncing ? 'A sincronizar...' : 'Sync agora'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4">
        {([
          { id: 'artigos',  label: 'Artigos' },
          { id: 'vendas',   label: 'Movimentos de venda' },
          { id: 'compras',  label: 'Movimentos de compra' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
              ${tab === t.id
                ? 'bg-teal-50 text-teal-700 border-teal-200'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Pesquisa (só artigos) */}
      {tab === 'artigos' && (
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input
            className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-300"
            placeholder="Pesquisar artigo por código ou descrição..."
            value={q}
            onChange={e => { setQ(e.target.value); pesquisarArtigos(e.target.value) }}/>
        </div>
      )}

      {/* Tabela Artigos */}
      {tab === 'artigos' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Código</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Descrição</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">IVA</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">PVP</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Stock</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && artigos.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                  Sem artigos. Faz uma sync primeiro.
                </td></tr>
              )}
              {artigos.map(a => (
                <tr key={a.codigo} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{a.codigo}</td>
                  <td className="px-4 py-2.5 text-gray-800">{a.descricao}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full">{a.taxa_iva}%</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 text-xs">{fmt(a.preco_venda)}</td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    {a.existencias > 0
                      ? <span className="text-teal-700 font-medium">{a.existencias}</span>
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
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Cliente</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Artigo</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Qtd.</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && vendas.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  Sem movimentos. Faz uma sync primeiro.
                </td></tr>
              )}
              {vendas.map((v, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-gray-600">{v.data}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">
                    <span className="bg-blue-50 text-blue-700 text-xs px-1.5 py-0.5 rounded mr-1">{v.tipo_doc}</span>
                    {v.numero_doc}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{v.cliente_nome || v.cliente_codigo}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{v.artigo_descricao || v.artigo_codigo}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-600">{v.quantidade}</td>
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
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Fornecedor</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Artigo</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Qtd.</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>}
              {!loading && compras.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  Sem movimentos. Faz uma sync primeiro.
                </td></tr>
              )}
              {compras.map((c, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-gray-600">{c.data}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">
                    <span className="bg-amber-50 text-amber-700 text-xs px-1.5 py-0.5 rounded mr-1">{c.tipo_doc}</span>
                    {c.numero_doc}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{c.fornecedor_nome || c.fornecedor_codigo}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{c.artigo_descricao || c.artigo_codigo}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-600">{c.quantidade}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-800">{fmt(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
