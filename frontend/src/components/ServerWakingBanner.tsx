import { useState, useEffect } from 'react'

interface Props {
  error: Error | null
  onRetry: () => void
}

export default function ServerWakingBanner({ error, onRetry }: Props) {
  const [secs, setSecs] = useState(60)

  useEffect(() => {
    if (!error) return
    setSecs(60)
    const t = setInterval(() => setSecs(s => {
      if (s <= 1) { clearInterval(t); onRetry(); return 60 }
      return s - 1
    }), 1000)
    return () => clearInterval(t)
  }, [error])

  if (!error) return null

  return (
    <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <svg className="h-4 w-4 animate-spin text-amber-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      <span>
        Servidor a acordar (plano gratuito Render) — a tentar novamente em <strong>{secs}s</strong>…
      </span>
      <button onClick={onRetry} className="ml-auto text-amber-600 underline hover:text-amber-800">
        Tentar agora
      </button>
    </div>
  )
}
