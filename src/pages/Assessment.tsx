import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { MathText } from '@/components/md/math-text'
import { useAppState } from '@/lib/store'
import { streamTutorReply } from '@/lib/gemini/tutor'

export function AssessmentPage() {
  const { settings, files, mode, setMode } = useAppState()
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)

  async function nextQuestion() {
    if (!settings.geminiKey) return
    setBusy(true)
    setFeedback('')
    setAnswer('')
    setMode('assessment')
    let text = ''
    try {
      for await (const c of streamTutorReply({
        apiKey: settings.geminiKey,
        model: settings.model,
        tutorName: 'Amina',
        student: settings.studentName,
        course: settings.courseName,
        notation: settings.notation,
        mode: 'assessment',
        history: [],
        userText:
          'Give ONE theory question from the uploaded notes. No multiple choice. No answer. Just the question, using LaTeX where needed.',
        files,
      })) {
        text += c
        setPrompt(text)
      }
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!answer.trim()) return
    setBusy(true)
    let text = ''
    try {
      for await (const c of streamTutorReply({
        apiKey: settings.geminiKey,
        model: settings.model,
        tutorName: 'Amina',
        student: settings.studentName,
        course: settings.courseName,
        notation: settings.notation,
        mode: 'review',
        history: [{ role: 'model', text: prompt }],
        userText: `Question was: ${prompt}\n\nStudent answer:\n${answer}\n\nMark it. Breakdown: recall, explanation, application, reasoning. Use LaTeX. Name misconceptions. Then give a follow-up.`,
        files,
      })) {
        text += c
        setFeedback(text)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-background px-5 py-8 md:px-10 max-w-3xl mx-auto grid gap-8">
      <header className="flex justify-between items-end">
        <div>
          <Link to="/" className="serif text-xl">
            Sabi
          </Link>
          <h1 className="serif text-4xl mt-2">Assessment</h1>
        </div>
        <Link to="/" className="text-sm text-muted hover:text-foreground">
          Back to tutor
        </Link>
      </header>
      {!prompt ? (
        <Button type="button" onClick={() => void nextQuestion()} disabled={busy || !settings.geminiKey}>
          {busy ? 'Writing a question…' : 'Draw a theory question'}
        </Button>
      ) : (
        <MathText text={prompt} className="serif text-2xl leading-snug" />
      )}
      {prompt ? (
        <>
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write the explanation. Use $...$ for formulas."
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button type="button" onClick={() => void submit()} disabled={busy || answer.trim().length < 8}>
              Submit
            </Button>
            <Button type="button" variant="outline" onClick={() => void nextQuestion()} disabled={busy}>
              Another
            </Button>
          </div>
        </>
      ) : null}
      {feedback ? <MathText text={feedback} /> : null}
      <p className="text-sm text-muted">Mode is {mode}. Minimal help until you submit.</p>
    </div>
  )
}

