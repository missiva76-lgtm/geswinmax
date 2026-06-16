import { useState, useEffect } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import { getArtigos, triggerSync } from '../services/api'
import { Artigo } from '../types'

export default function Dados() {
  const [artigos, setArtigos] = useState<Artigo[]>([])
  const [q, setQ]             = useState('')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const pesquisar = async (query: string) => {
    setLoading(true)
    const res = await getArtigos(query).catch(() => [])
    setArtigos(res)
    setLoading(false)
  }

  useEffect(() => { pesquisar('') }, [])

  const handleSync = async () => {
    setSyncing(true)
    await triggerSync().catch(() => {})
    setTimeout(() => { setSyncing(false); pesquisar(q) }, 4000)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dados WinMax4</h2>
          <p className="text-sm text-gray-400">Artigos, existências e movimentos sincronizados</p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>
          {syncing ? 'A sincronizar...' : 'Sync agora'}
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input
          className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
          placeholder="Pesquisar artigo por código ou descrição..."
          value={q}
          onChange={e => { setQ(e.target.value); pesquisar(e.target.value) }}/>
      </div>

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
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>
            )}
            {!loading && artigos.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                Sem artigos. Faz uma sync primeiro.
              </td></tr>
            )}
            {artigos.map((a) => (
              <tr key={a.codigo} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{a.codigo}</td>
                <td className="px-4 py-2.5 text-gray-800">{a.descricao}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{a.taxa_iva}%</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{a.preco_venda.toFixed(2)}€</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{a.existencias}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
