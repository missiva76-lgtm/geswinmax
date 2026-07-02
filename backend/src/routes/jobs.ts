// routes/jobs.ts — Endpoints da API
import { Router, Request, Response } from 'express'
import multer from 'multer'
import * as path from 'path'
import * as fs from 'fs'
import * as admin from 'firebase-admin'
import { v4 as uuidv4 } from 'uuid'
import { db, updateJob } from '../services/firebase'
import { processarEmissaoJob } from '../jobs/emissaoJob'
import { syncWinmax } from '../sync/syncArtigos'

const router = Router()
const upload = multer({ dest: path.join(process.cwd(), 'tmp', 'uploads') })

// POST /api/jobs/emissao — Upload Excel e inicia job
router.post('/emissao', upload.single('excel'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ erro: 'Ficheiro Excel em falta' })

  // Cancela jobs de emissão ativos anteriores
  const ativos = await db().collection('jobs')
    .where('tipo', '==', 'emissao')
    .where('estado', '==', 'ativo')
    .get()
  for (const doc of ativos.docs) {
    await doc.ref.update({ estado: 'cancelado', atualizado_em: admin.firestore.FieldValue.serverTimestamp() })
  }

  const jobId = uuidv4()

  // Cria job no Firestore
  await db().collection('jobs').doc(jobId).set({
    id:         jobId,
    tipo:       'emissao',
    estado:     'pendente',
    excel_path: req.file.path,
    progresso:  0,
    log:        [],
    criado_em:  admin.firestore.FieldValue.serverTimestamp(),
  })

  // Processa em background (não bloqueia o request)
  processarEmissaoJob(jobId, req.file.path).catch(() => {})

  res.json({ jobId, estado: 'pendente' })
})

// GET /api/jobs/:id — Estado do job
router.get('/:id', async (req: Request, res: Response) => {
  const doc = await db().collection('jobs').doc(req.params.id).get()
  if (!doc.exists) return res.status(404).json({ erro: 'Job não encontrado' })
  res.json(doc.data())
})

// GET /api/jobs — Lista jobs recentes
router.get('/', async (_req: Request, res: Response) => {
  const snap = await db().collection('jobs')
    .orderBy('criado_em', 'desc')
    .limit(20)
    .get()
  res.json(snap.docs.map(d => d.data()))
})

// POST /api/jobs/sync — Força sync manual (?force=true para sync completo desde data_inicio)
router.post('/sync', async (req: Request, res: Response) => {
  const forceCompleto = req.query.force === 'true' || req.body?.force === true
  const jobId = uuidv4()
  await db().collection('jobs').doc(jobId).set({
    id: jobId, tipo: 'sync', estado: 'ativo',
    progresso: 0, log: [],
    criado_em: admin.firestore.FieldValue.serverTimestamp(),
  })
  syncWinmax(jobId, { forceCompleto })
    .then(() => updateJob(jobId, { estado: 'concluido', progresso: 100 }))
    .catch(async (e) => updateJob(jobId, { estado: 'erro', erro_geral: String(e) }))
  res.json({ jobId, mensagem: forceCompleto ? 'Sync COMPLETO iniciada' : 'Sync iniciada' })
})

export default router
