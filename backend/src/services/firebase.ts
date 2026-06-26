// services/firebase.ts — Firebase Admin SDK
import * as admin from 'firebase-admin'

let initialized = false
let firestoreInstance: admin.firestore.Firestore | null = null

export function initFirebase() {
  if (initialized) return

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson)
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      })
      firestoreInstance = admin.firestore()
      initialized = true
      console.info(`[Firebase] Inicializado via FIREBASE_SERVICE_ACCOUNT (project=${serviceAccount.project_id})`)
      return
    } catch (e) {
      console.error('[Firebase] Erro ao parsear FIREBASE_SERVICE_ACCOUNT:', e)
    }
  }

  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const rawKey      = process.env.FIREBASE_PRIVATE_KEY || ''
  const privateKey  = rawKey.split('\\n').join('\n')

  console.info(`[Firebase] project=${projectId} keyLen=${privateKey.length}`)

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(`[Firebase] Credenciais em falta`)
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  })
  firestoreInstance = admin.firestore()
  initialized = true
  console.info('[Firebase] Inicializado via variáveis separadas')
}

export const db = () => {
  if (!firestoreInstance) throw new Error('[Firebase] Firestore não inicializado')
  return firestoreInstance
}

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
