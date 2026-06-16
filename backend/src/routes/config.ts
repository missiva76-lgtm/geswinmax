import { Router, Request, Response } from 'express'
import { db } from '../services/firebase'

const router = Router()

// GET /api/config — lê configurações
router.get('/', async (_req: Request, res: Response) => {
  const doc = await db().collection('config').doc('winmax').get()
  const data = doc.exists ? doc.data() : {}
  // Remove password da resposta
  const { password: _, ...safe } = (data as any)
  res.json(safe)
})

// PUT /api/config — actualiza configurações
router.put('/', async (req: Request, res: Response) => {
  await db().collection('config').doc('winmax').set(req.body, { merge: true })
  res.json({ ok: true })
})

export default router
