import { Router, Request, Response } from 'express'
import * as admin from 'firebase-admin'
import { db } from '../services/firebase'
import { logger } from '../services/logger'

const router = Router()

// GET /api/faturas — lista faturas emitidas (com filtros)
router.get('/', async (req: Request, res: Response) => {
  let q = db().collection('faturas').orderBy('emitido_em', 'desc')
  if (req.query.cliente) {
    q = q.where('cliente_codigo', '==', req.query.cliente) as any
  }
  if (req.query.sucesso !== undefined) {
    q = q.where('sucesso', '==', req.query.sucesso === 'true') as any
  }
  const snap = await q.limit(100).get()
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })))
})

// DELETE /api/faturas — limpa o histórico de emissões
//
// ATENÇÃO: a coleção `faturas` não serve apenas para consulta — é também a base da
// DETEÇÃO DE DUPLICADOS na emissão (ver emissaoJob.ts, consulta por `chave_dedup`).
// Apagar os registos com sucesso significa que reenviar o mesmo Excel volta a emitir
// tudo de novo no WinMax4, sem aviso. Por isso existem dois modos:
//   ?modo=erros  (por omissão) — apaga só os registos falhados; mantém a proteção
//   ?modo=tudo                 — apaga tudo, incluindo o histórico de duplicados
router.delete('/', async (req: Request, res: Response) => {
  try {
    const modo = req.query.modo === 'tudo' ? 'tudo' : 'erros'
    const MAX_RONDAS = 200
    let apagados = 0
    let completo = false

    // Firestore aceita no máximo 500 operações por batch; itera até esvaziar.
    // O limite de rondas (~80 mil registos) existe como travão de segurança contra
    // um ciclo infinito em caso de erro inesperado. Se for atingido, reportamos que
    // a limpeza ficou incompleta em vez de dar a operação como concluída.
    for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
      let q = db().collection('faturas').limit(400)
      if (modo === 'erros') q = q.where('sucesso', '==', false) as any

      const snap = await q.get()
      if (snap.empty) { completo = true; break }

      const batch = db().batch()
      snap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
      apagados += snap.size
    }

    logger.info(`🗑️ Histórico de emissões limpo (modo=${modo}): ${apagados} registos apagados${completo ? '' : ' — INCOMPLETO, limite de rondas atingido'}`)
    res.json({ apagados, modo, completo })
  } catch (err) {
    logger.error(`❌ Falha ao limpar histórico: ${err}`)
    res.status(500).json({ erro: String(err) })
  }
})

// GET /api/faturas/pdf/:jobId/:ficheiro — serve o PDF a partir do Firebase Storage.
//
// CORRIGIDO 31/08/2026 — CAUSA DO DOWNLOAD NÃO FUNCIONAR:
// O frontend ia buscar o PDF diretamente ao Storage
// (https://storage.googleapis.com/...). O browser bloqueava com:
//   "blocked by CORS policy: No 'Access-Control-Allow-Origin' header"
// O ficheiro existe e está público, mas o bucket não autoriza pedidos vindos do
// domínio da aplicação — e sem CORS o `fetch` falha, logo não há download.
//
// Servir o ficheiro por aqui resolve sem depender de configurar CORS no bucket
// (que exigiria acesso à consola do Google Cloud e tornaria o bucket aberto a
// origens externas): o pedido passa pelo mesmo domínio da aplicação, através do
// redirecionamento /api/* do Netlify.
router.get('/pdf/:jobId/:ficheiro', async (req: Request, res: Response) => {
  try {
    const jobId    = req.params.jobId
    const ficheiro = decodeURIComponent(req.params.ficheiro)

    // Impede que se saia da pasta do job (ex: "../../outro")
    if (ficheiro.includes('/') || ficheiro.includes('\\') || ficheiro.includes('..')) {
      return res.status(400).json({ erro: 'nome de ficheiro inválido' })
    }

    const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || 'geswinmax.firebasestorage.app')
    const file = bucket.file(`pdfs/${jobId}/${ficheiro}`)

    const [existe] = await file.exists()
    if (!existe) return res.status(404).json({ erro: 'PDF não encontrado' })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${ficheiro.replace(/[^\w.\-]/g, '_')}"`)
    file.createReadStream()
      .on('error', (err) => {
        logger.error(`❌ Erro ao servir PDF ${ficheiro}: ${err}`)
        if (!res.headersSent) res.status(500).json({ erro: String(err) })
      })
      .pipe(res)
  } catch (err) {
    logger.error(`❌ GET /api/faturas/pdf: ${err}`)
    if (!res.headersSent) res.status(500).json({ erro: String(err) })
  }
})

export default router
