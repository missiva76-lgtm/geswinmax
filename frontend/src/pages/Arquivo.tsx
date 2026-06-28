import { useState, useEffect, useRef } from 'react'
import { Search, FileText, RefreshCw, Download } from 'lucide-react'
import { getArquivo, triggerSyncArquivo, ServerWakingError } from '../services/api'
import ServerWakingBanner from '../components/ServerWakingBanner'

interface DocArquivo {
  id: string
  numero_documento: string
  tipo_documento: string
  data: string
  ficheiro: string
  informacao?: string
  pdf_url?: string | null
  importado_em?: { seconds: number }
}

const TIPOS = ['FAA','FR','FS','FTB','FRB','NCC','GT','FO','FFF']

const TIPO_COR: Record<string, string> = {
  FAA: 'bg-blue-100 text-blue-700',
  FRB: 'bg-purple-100 text-purple-700',
  FR:  'bg-green-100 text-green-700',
  FS:  'bg-teal-100 text-teal-700',
  FTB: 'bg-orange-100 text-orange-700',
  NCC: 'bg-red-100 text-red-700',
  GT:  'bg-yellow-100 text-yellow-700',
  FO:  'bg-pink-100 text-pink-700',
  FFF: 'bg-gray-100 text-gray-700',
}

export default function Arquivo() {
  const [docs, setDocs]         = useState<DocArquivo[]>([])
  const [q, setQ]               = useState('')
  const [tipoFiltro, setTipo]   = useState('')
  const [dataInicio, setDI]     = useState('')
  const [dataFim, setDF]        = useState('')
  const [loading, setLoading]   = useState(true)
  const [syncing, setSyncing]   = useState(false)
  const [serverError, setServerError] = useState<Error | null>(null)
  const searchRef               = useRef<ReturnType<typeof setTimeout>>()

  const pesquisar = async (query: string) => {
    setLoading(true)
    try {
      const res = await getArquivo(query || undefined)
      setDocs(res)
      setServerError(null)
    } catch(e: any) {
      setServerError(e)
      setDocs([])
    }
    setLoading(false)
  }

  useEffect(() => { pesquisar('') }, [])

  const handleQ = (val: string) => {
    setQ(val)
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => pesquisar(val), 400)
  }

  const handleSync = async () => {
    setSyncing(true)
    await triggerSyncArquivo().catch(() => {})
    setTimeout(() => { setSyncing(false); pesquisar(q) }, 10000)
  }

  // Filtragem local por tipo e datas
  const filtrados = docs.filter(d => {
    if (tipoFiltro && d.tipo_documento !== tipoFiltro) return false
    if (dataInicio || dataFim) {
      // data formato: "31/12/2025 21:03:52" → parse pt-PT
      const partes = d.data?.split(' ')[0]?.split('/')
      if (partes?.length === 3) {
        const dataDoc = new Date(`${partes[2]}-${partes[1]}-${partes[0]}`)
        if (dataInicio && dataDoc < new Date(dataInicio)) return false
        if (dataFim   && dataDoc > new Date(dataFim))    return false
      }
    }
    return true
  })

  // PDF disponível apenas no WinMax4 (requer sessão autenticada)
  const pdfDownloadUrl = (_ficheiro: string) => null

  return (
    <div className="flex-1 overflow-auto p-6">
      <ServerWakingBanner error={serverError} onRetry={() => pesquisar(q)} />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Arquivo digital</h2>
          <p className="text-sm text-gray-400">
            Todos os documentos do WinMax4 — histórico completo
            {docs.length > 0 && <span className="ml-2 text-gray-300">({filtrados.length} de {docs.length} documentos)</span>}
          </p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>
          {syncing ? 'A importar...' : 'Importar do WinMax4'}
        </button>
      </div>

      {syncing && (
        <div className="mb-3 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
          A importar o Arquivo Digital. Este processo pode demorar alguns minutos.
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={q} onChange={e => handleQ(e.target.value)}
            placeholder="Pesquisar por nº documento, ficheiro..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"/>
        </div>
        <select value={tipoFiltro} onChange={e => setTipo(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300">
          <option value="">Todos os tipos</option>
          {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" value={dataInicio} onChange={e => setDI(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
          title="Data início"/>
        <input type="date" value={dataFim} onChange={e => setDF(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
          title="Data fim"/>
        {(tipoFiltro || dataInicio || dataFim) && (
          <button onClick={() => { setTipo(''); setDI(''); setDF('') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2">
            Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-50 bg-gray-50">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Nº Documento</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Tipo</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Data</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Ficheiro</th>
              <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">A carregar...</td></tr>
            )}
            {!loading && filtrados.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                {q || tipoFiltro || dataInicio || dataFim
                  ? 'Sem resultados para os filtros aplicados.'
                  : 'Sem documentos importados. Clica em "Importar do WinMax4" para começar.'}
              </td></tr>
            )}
            {filtrados.map((doc) => {
              const urlPDF = doc.pdf_url || pdfDownloadUrl(doc.ficheiro)
              return (
                <tr key={doc.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-800">
                    {doc.numero_documento || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIPO_COR[doc.tipo_documento] || 'bg-gray-100 text-gray-600'}`}>
                      {doc.tipo_documento || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{doc.data}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 truncate max-w-[200px]" title={doc.ficheiro}>
                    {doc.ficheiro || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {urlPDF ? (
                      <a href={urlPDF} download={doc.ficheiro}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                        <Download size={13}/>
                      </a>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
