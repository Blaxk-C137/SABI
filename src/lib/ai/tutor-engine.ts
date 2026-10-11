import type { IntegrityMode } from '../course/types'
import type { SpeechPlan } from '../voice/types'
import { evaluateAnswer, get206Questions } from '../assessment/engine'
import type { Evaluation } from '../assessment/types'

export interface ChatTurn {
  id: string
  role: 'tutor' | 'student' | 'system'
  text: string
  speech?: SpeechPlan
  evaluation?: Evaluation
  stage?: string
}

export interface TutorReply {
  turns: ChatTurn[]
  speech: SpeechPlan
  mode: IntegrityMode
  thinkingStages: string[]
}

const OPENING: SpeechPlan = {
  text: 'Good afternoon, Adaeze. I have your GET206 notes open — Dr. Okafor’s convention, delta U equals Q minus W. Last session you could state the first law. You were less sure applying it to a closed system. Let us start there. Explain the first law in your own words, then tell me what happens to the energy of a closed system when heat is added.',
  emotion: 'calm',
  speed: 0.94,
  pauseAfter: ['there'],
  emphasis: ['your own words'],
}

export function openingTurn(): ChatTurn {
  return {
    id: 'open',
    role: 'tutor',
    text: OPENING.text,
    speech: OPENING,
  }
}

export function thinkStages(mode: IntegrityMode, hasMaterial: boolean): string[] {
  if (mode === 'assessment') {
    return [
      'Reading your answer',
      'Checking the explanation, not the wording',
      hasMaterial ? 'Comparing with the course material' : 'Checking the system boundary',
    ]
  }
  return [
    'Reading your answer',
    hasMaterial ? 'Checking against your GET206 notes' : 'Checking the reasoning',
    'Deciding the next question',
  ]
}

export function replyToStudent(
  text: string,
  mode: IntegrityMode,
  questionIndex: number,
): TutorReply {
  const q = get206Questions[questionIndex] ?? get206Questions[0]!
  const evaluation = evaluateAnswer(q, text)
  const stages = thinkStages(mode, true)

  if (mode === 'assessment') {
    const speech: SpeechPlan = {
      text: evaluation.needs_followup
        ? `${evaluation.summary} I will not complete the answer for you yet. ${evaluation.tryThis}`
        : `${evaluation.summary} Sit with that, then we will move to the next question.`,
      emotion: 'challenging',
      speed: 0.92,
      emphasis: ['not complete the answer'],
    }
    return {
      mode,
      thinkingStages: stages,
      speech,
      turns: [
        {
          id: `eval-${q.id}`,
          role: 'tutor',
          text: speech.text,
          speech,
          evaluation,
        },
      ],
    }
  }

  const next = get206Questions[questionIndex + 1]
  const teachExtra =
    mode === 'teach'
      ? ' In these notes, a closed system exchanges heat and work but not mass. Isolated means no energy exchange either. Heat added to a closed system with no work raises internal energy, so delta U is positive.'
      : ''

  const speech: SpeechPlan = {
    text: `${evaluation.summary}${teachExtra} ${evaluation.whyItMatters} ${
      next ? next.prompt : evaluation.tryThis
    }`,
    emotion: evaluation.correctness > 0.7 ? 'encouraging' : 'corrective',
    speed: 0.93,
    pauseAfter: ['matters'],
    emphasis: ['closed system', 'isolated'],
  }

  return {
    mode,
    thinkingStages: stages,
    speech,
    turns: [
      {
        id: `eval-${q.id}`,
        role: 'tutor',
        text: speech.text,
        speech,
        evaluation,
      },
    ],
  }
}

export function nextQuestionIndex(current: number, evaluation?: Evaluation) {
  if (!evaluation) return current
  if (evaluation.needs_followup && current < get206Questions.length - 1) {
    return Math.min(current + 1, get206Questions.length - 1)
  }
  return Math.min(current + 1, get206Questions.length - 1)
}

