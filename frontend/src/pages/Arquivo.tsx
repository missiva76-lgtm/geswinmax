import { useState, useEffect } from 'react'
import { Search, FileText, ExternalLink } from 'lucide-react'
import { getFaturas } from '../services/api'
import { FaturaResultado } from '../types'

export default function Arquivo() {
  const [faturas, setFaturas] = useState<FaturaResultado[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getFaturas({ sucesso: true }).then(setFaturas).catch(() => []).finally(() => setLoading(false))
  }, [])

  const filtradas = faturas.filter(f =>
    !q ||
    f.numero_documento?.toLowerCase().includes(q.toLowerCase()) ||
    f.cliente_nome?.toLowerCase().includes(q.toLowerCase()) ||
    f.cliente_codigo?.includes(q)
  )

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Arquivo digital</h2>
      <p className="text-sm text-gray-400 mb-6">Documentos emitidos — pesquisável e com visualização de PDF.</p>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input
          className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
          placeholder="Pesquisar por nº documento, cliente..."
          value={q} onChange={e => setQ(e.target.value)}/>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-50 bg-gray-50">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Nº Documento</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Cliente</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Tipo</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Linhas</th>
              <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>
            )}
            {!loading && filtradas.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                {q ? 'Sem resultados' : 'Sem documentos emitidos ainda.'}
              </td></tr>
            )}
            {filtradas.map((f, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800 font-mono text-xs">{f.numero_documento}</td>
                <td className="px-4 py-2.5 text-gray-700">
                  <div>{f.cliente_nome}</div>
                  <div className="text-xs text-gray-400">{f.cliente_codigo}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                    {f.tipo_documento}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-gray-600 text-xs">{f.total_linhas}</td>
                <td className="px-4 py-2.5 text-center">
                  {f.pdf_url
                    ? <a href={f.pdf_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                        <FileText size={12}/><ExternalLink size={10}/>
                      </a>
                    : <span className="text-xs text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
