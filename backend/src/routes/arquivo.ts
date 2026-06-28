import { Router, Request, Response } from 'express'
import * as admin from 'firebase-admin'
import { db } from '../services/firebase'
import { syncArquivoDigital } from '../sync/syncArquivoDigital'

const router = Router()

// GET /api/arquivo — lista documentos do arquivo (com filtros)
router.get('/', async (req: Request, res: Response) => {
  try {
    let q = db().collection('arquivo').orderBy('data', 'desc')

    if (req.query.cliente) {
      q = q.where('cliente_codigo', '==', req.query.cliente) as any
    }
    if (req.query.tipo) {
      q = q.where('tipo_documento', '==', req.query.tipo) as any
    }

    const snap = await q.limit(2000).get()
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

// GET /api/arquivo/pesquisar?q=texto — pesquisa por número ou cliente
router.get('/pesquisar', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').toUpperCase().trim()
    const snap = await db().collection('arquivo').orderBy('data', 'desc').limit(2000).get()

    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() as any }))
    const filtrados = q
      ? todos.filter(d =>
          d.numero_documento?.toUpperCase().includes(q) ||
          d.cliente_nome?.toUpperCase().includes(q) ||
          d.cliente_codigo?.includes(q) ||
          d.tipo_documento?.toUpperCase().includes(q)
        )
      : todos

    res.json(filtrados.slice(0, 100))
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

// POST /api/arquivo/sync — importa/actualiza arquivo do WinMax4
router.post('/sync', async (_req: Request, res: Response) => {
  const jobRef = db().collection('jobs').doc()
  await jobRef.set({
    id: jobRef.id, tipo: 'arquivo', estado: 'ativo',
    progresso: 0, log: [],
    criado_em: admin.firestore.FieldValue.serverTimestamp(),
  })

  syncArquivoDigital(jobRef.id)
    .then(() => jobRef.update({ estado: 'concluido', progresso: 100 }))
    .catch(async (e) => jobRef.update({ estado: 'erro', erro_geral: String(e) }))

  res.json({ jobId: jobRef.id, mensagem: 'Importação do arquivo iniciada' })
})

export default router
