// services/firebase.ts — Firebase Admin SDK (sem Storage — PDFs servidos pelo Render)
import * as admin from 'firebase-admin'

let initialized = false

export function initFirebase() {
  if (initialized) return

  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const rawKey      = process.env.FIREBASE_PRIVATE_KEY || ''
  // Converte \n literais em quebras de linha reais
  const privateKey  = rawKey.includes('\\n') ? rawKey.split('\\n').join('\n') : rawKey

  console.info(`[Firebase] project=${projectId} email=${clientEmail?.substring(0,30)}... keyLen=${privateKey.length} hasNewlines=${privateKey.includes('\n')}`)

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(`[Firebase] Credenciais em falta: project=${projectId} email=${clientEmail} key=${!!privateKey}`)
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  })
  initialized = true
  console.info('[Firebase] Inicializado com sucesso')
}

export const db = () => admin.firestore()

export async function updateJob(jobId: string, data: Record<string, unknown>) {
  await db().collection('jobs').doc(jobId).update({
    ...data,
    atualizado_em: admin.firestore.FieldValue.serverTimestamp(),
  })
}

export async function appendJobLog(jobId: string, msg: string) {
  await db().collection('jobs').doc(jobId).update({
    log: admin.firestore.FieldValue.arrayUnion(`[${new Date().toISOString()}] ${msg}`),
    atualizado_em: admin.firestore.FieldValue.serverTimestamp(),
  })
}

export async function getConfig(): Promise<Record<string, string>> {
  const doc = await db().collection('config').doc('winmax').get()
  return doc.exists ? (doc.data() as Record<string, string>) : {}
}
