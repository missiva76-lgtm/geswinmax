import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../services/firebase'
import { Job } from '../types'

export function useJob(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null)

  useEffect(() => {
    if (!jobId) return
    const unsub = onSnapshot(doc(db, 'jobs', jobId), snap => {
      if (snap.exists()) setJob({ id: snap.id, ...snap.data() } as Job)
    })
    return unsub
  }, [jobId])

  return job
}
