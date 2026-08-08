import { Router, Request, Response } from 'express'
import * as admin from 'firebase-admin'
import { db } from '../services/firebase'
import { syncDocumentos } from '../sync/syncDocumentos'
import { logger } from '../services/logger'

const router = Router()

// GET /api/documentos — lista os documentos emitidos com o estado de liquidação.
// Sem limite e sem orderBy: o frontend trata de filtrar, ordenar e paginar, tal
// como já acontece com os movimentos.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const snap = await db().collection('documentos_emitidos').get()
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (err) {
    logger.error(`❌ GET /api/documentos: ${err}`)
    res.status(500).json({ erro: String(err) })
  }
})

// POST /api/documentos/sync — importa a listagem do WinMax4.
//
// Reimporta sempre todo o histórico, de propósito: o estado de liquidação muda ao
// longo do tempo (uma fatura por pagar hoje pode estar paga amanhã), pelo que uma
// sincronização incremental deixaria estados desatualizados.
router.post('/sync', async (_req: Request, res: Response) => {
  const jobRef = db().collection('jobs').doc()
  await jobRef.set({
    id: jobRef.id, tipo: 'documentos', estado: 'ativo',
    progresso: 0, log: [],
    criado_em: admin.firestore.FieldValue.serverTimestamp(),
  })

  syncDocumentos(jobRef.id)
    .then(() => jobRef.update({
      estado: 'concluido', progresso: 100,
      concluido_em: admin.firestore.FieldValue.serverTimestamp(),
    }))
    .catch(async (e) => jobRef.update({
      estado: 'erro', erro_geral: String(e),
      concluido_em: admin.firestore.FieldValue.serverTimestamp(),
    }))

  res.json({ jobId: jobRef.id, mensagem: 'Importação de documentos emitidos iniciada' })
})

export default router
