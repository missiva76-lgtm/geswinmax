import { Router, Request, Response } from 'express'
import * as admin from 'firebase-admin'
import { db } from '../services/firebase'
import { syncSAFT } from '../sync/syncSAFT'

const router = Router()

// GET /api/saft — lista resumos SAF-T importados
router.get('/', async (_req: Request, res: Response) => {
  try {
    const snap = await db().collection('saft').orderBy('periodo_inicio', 'desc').limit(24).get()
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (err) { res.status(500).json({ erro: String(err) }) }
})

// GET /api/saft/mensal — dados mensais para gráficos
router.get('/mensal', async (_req: Request, res: Response) => {
  try {
    const snap = await db().collection('saft_mensal').orderBy('mes', 'asc').get()
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (err) { res.status(500).json({ erro: String(err) }) }
})

// POST /api/saft/sync — importação manual
router.post('/sync', async (req: Request, res: Response) => {
  const { dataInicio, dataFim } = req.body || {}
  const jobRef = db().collection('jobs').doc()
  await jobRef.set({
    id: jobRef.id, tipo: 'saft', estado: 'ativo',
    progresso: 0, log: [],
    criado_em: admin.firestore.FieldValue.serverTimestamp(),
  })

  syncSAFT(dataInicio, dataFim, jobRef.id)
    .then(() => jobRef.update({ estado: 'concluido', progresso: 100 }))
    .catch(async (e) => jobRef.update({ estado: 'erro', erro_geral: String(e) }))

  res.json({ jobId: jobRef.id, mensagem: 'Importação SAF-T iniciada' })
})

export default router
