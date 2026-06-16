import { Router, Request, Response } from 'express'
import { db } from '../services/firebase'

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

export default router
