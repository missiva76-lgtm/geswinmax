import { useState, useEffect, useRef } from 'react'
import { Search, FileText, ExternalLink, RefreshCw, X, Download } from 'lucide-react'
import { getArquivo, triggerSyncArquivo, ServerWakingError } from '../services/api'
import ServerWakingBanner from '../components/ServerWakingBanner'

interface DocArquivo {
  id: string
  numero_documento: string
  tipo_documento: string
  serie: string
  data: string
  cliente_codigo: string
  cliente_nome: string
  total_iliquido: number
  iva: number
  total_liquido: number
  estado: string
  pdf_url?: string
  importado_em?: { seconds: number }
}

export default function Arquivo() {
  const [docs, setDocs]       = useState<DocArquivo[]>([])
  const [q, setQ]             = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [pdfUrl, setPdfUrl]   = useState<string | null>(null)
  const [serverError, setServerError] = useState<Error | null>(null)
  const searchRef             = useRef<ReturnType<typeof setTimeout>>()

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
    // Aguarda 10s e recarrega (a sync pode demorar minutos)
    setTimeout(() => { setSyncing(false); pesquisar(q) }, 10000)
  }

  const fmt = (n: number | undefined | null) => n != null ? n.toFixed(2).replace('.', ',') + ' €' : '—'

  return (
    <div>
      <ServerWakingBanner error={serverError} onRetry={() => pesquisar(q)} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Arquivo digital</h2>
          <p className="text-sm text-gray-400">
            Todos os documentos do WinMax4 — histórico completo
            {docs.length > 0 && <span className="ml-2 text-gray-300">({docs.length} documentos)</span>}
          </p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>
          {syncing ? 'A importar...' : 'Importar do WinMax4'}
        </button>
      </div>

      {syncing && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
          A importar o Arquivo Digital do WinMax4. Este processo pode demorar alguns minutos dependendo do volume de documentos.
        </div>
      )}

      {/* Pesquisa */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input
          className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
          placeholder="Pesquisar por nº documento, cliente, tipo..."
          value={q} onChange={e => handleQ(e.target.value)}/>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-50 bg-gray-50">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Nº Documento</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Tipo</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Data</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Cliente</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Total</th>
              <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                A carregar...
              </td></tr>
            )}
            {!loading && docs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                {q
                  ? 'Sem resultados para essa pesquisa.'
                  : 'Sem documentos importados. Clica em "Importar do WinMax4" para começar.'}
              </td></tr>
            )}
            {docs.map((doc) => (
              <tr key={doc.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-800">
                  {doc.numero_documento}
                </td>
                <td className="px-4 py-2.5">
                  <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                    {doc.tipo_documento}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-600">{doc.data}</td>
                <td className="px-4 py-2.5">
                  <div className="text-gray-800 text-xs">{doc.cliente_nome}</div>
                  {doc.cliente_codigo && (
                    <div className="text-gray-400 text-xs">{doc.cliente_codigo}</div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="text-xs font-medium text-gray-800">{fmt(doc.total_liquido)}</div>
                  {doc.iva > 0 && (
                    <div className="text-xs text-gray-400">IVA: {fmt(doc.iva)}</div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {doc.pdf_url ? (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => setPdfUrl(doc.pdf_url!)}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                        title="Ver PDF">
                        <FileText size={13}/>
                      </button>
                      <a href={doc.pdf_url} download
                        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                        title="Descarregar PDF">
                        <Download size={12}/>
                      </a>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal de visualização de PDF */}
      {pdfUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">Visualização do documento</p>
              <div className="flex items-center gap-2">
                <a href={pdfUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  Abrir noutra aba <ExternalLink size={11}/>
                </a>
                <a href={pdfUrl} download
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                  <Download size={13}/>
                </a>
                <button onClick={() => setPdfUrl(null)}
                  className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={16}/>
                </button>
              </div>
            </div>
            <iframe
              src={pdfUrl}
              className="flex-1 w-full rounded-b-xl"
              title="Documento PDF"/>
          </div>
        </div>
      )}
    </div>
  )
}
