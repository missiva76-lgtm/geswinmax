import { Router, Request, Response } from 'express'
import { db } from '../services/firebase'

const router = Router()

// GET /api/dados/movimentos_venda
router.get('/movimentos_venda', async (_req: Request, res: Response) => {
  try {
    const snap = await db().collection('movimentos_venda')
      .orderBy('data', 'desc').limit(2000).get()
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

// GET /api/dados/movimentos_compra
router.get('/movimentos_compra', async (_req: Request, res: Response) => {
  try {
    const snap = await db().collection('movimentos_compra')
      .orderBy('data', 'desc').limit(2000).get()
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

export default router
