// services/firebase.ts — Firebase Admin SDK (sem Storage — PDFs servidos pelo Render)
import * as admin from 'firebase-admin'

let initialized = false

export function initFirebase() {
  if (initialized) return
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
  initialized = true
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
