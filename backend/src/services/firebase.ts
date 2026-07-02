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
      // Garante que private_key tem newlines reais (não literais \n)
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.split('\\n').join('\n')
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'geswinmax.firebasestorage.app',
      })
      firestoreInstance = admin.firestore()
      if (process.env.FIRESTORE_USE_REST === 'true') {
        firestoreInstance.settings({ preferRest: true })
        console.info('[Firebase] Firestore em modo REST')
      }
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
  // Converte \n literais em newlines reais (independentemente do formato)
  const privateKey  = rawKey.includes('\\n') 
    ? rawKey.split('\\n').join('\n')
    : rawKey  // já tem newlines reais
  
  console.info(`[Firebase] key starts: ${privateKey.substring(0,30)} newlines: ${(privateKey.match(/\n/g)||[]).length}`)

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(`[Firebase] Credenciais em falta`)
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'geswinmax.firebasestorage.app',
  })
  firestoreInstance = admin.firestore()
  if (process.env.FIRESTORE_USE_REST === 'true') {
    firestoreInstance.settings({ preferRest: true })
  }
  initialized = true
  console.info(`[Firebase] Inicializado (project=${projectId})`)
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

export async function uploadPDFToStorage(buffer: Buffer, nomeFicheiro: string, jobId: string): Promise<string> {
  const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || 'geswinmax.firebasestorage.app')
  const destPath = `pdfs/${jobId}/${nomeFicheiro}`
  const file = bucket.file(destPath)
  await file.save(buffer, { contentType: 'application/pdf', metadata: { cacheControl: 'public, max-age=31536000' } })
  await file.makePublic()
  return `https://storage.googleapis.com/${bucket.name}/${destPath}`
}

export async function getConfig(): Promise<Record<string, string>> {
  const doc = await db().collection('config').doc('winmax').get()
  return doc.exists ? (doc.data() as Record<string, string>) : {}
}
