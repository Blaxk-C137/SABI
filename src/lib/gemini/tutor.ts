import type { StoredFile } from '@/lib/storage'
import { geminiFetch, readSseText } from './client'
import { fallbackChatModels } from './models'
import { tutorSystem } from './prompt'
import type { IntegrityMode } from '@/lib/course/types'

export interface GeminiTurn {
  role: 'user' | 'model'
  text: string
}

export async function* streamTutorReply(opts: {
  apiKey: string
  model: string
  tutorName: string
  student: string
  course: string
  notation: string
  mode: IntegrityMode
  history: GeminiTurn[]
  userText: string
  files: StoredFile[]
}) {
  const system = tutorSystem({
    name: opts.tutorName,
    student: opts.student,
    course: opts.course,
    notation: opts.notation,
    mode: opts.mode,
    fileNames: opts.files.map((f) => f.name),
  })

  const contents = [
    ...opts.history.map((h) => ({
      role: h.role,
      parts: [{ text: h.text }],
    })),
    {
      role: 'user' as const,
      parts: [
        ...fileParts(opts.files),
        {
          text: opts.files.length
            ? `Answer from the attached course files only.\n${opts.userText}`
            : opts.userText,
        },
      ],
    },
  ]

  const models = fallbackChatModels(opts.model)
  let lastErr: unknown
  for (const model of models) {
    try {
      const res = await geminiFetch(
        `/v1beta/models/${model}:streamGenerateContent`,
        opts.apiKey,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
        },
        true,
      )
      for await (const chunk of readSseText(res)) yield chunk
      return
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

function fileParts(files: StoredFile[]) {
  return files.slice(0, 4).flatMap((f) => {
    if (f.mime.startsWith('text/')) {
      try {
        return [{ text: `FILE ${f.name}:\n${atob(f.base64)}` }]
      } catch {
        return []
      }
    }
    return [
      { text: `Course file: ${f.name}` },
      { inlineData: { mimeType: f.mime, data: f.base64 } },
    ]
  })
}



