import type { Evaluation, Question } from './types'

export const get206Questions: Question[] = [
  {
    id: 'q1',
    courseId: 'get206',
    topicId: 'closed-systems',
    kind: 'explain',
    prompt:
      'Explain the first law in your own words, then use it to say what happens to the energy of a closed system when heat is added.',
    expected: [
      'conservation',
      'internal energy',
      'heat',
      'work',
      'closed',
    ],
    traps: [
      {
        match: 'isolated',
        misconception: 'Confuses closed and isolated systems',
      },
      {
        match: 'created',
        misconception: 'Implies energy can be created rather than transferred',
      },
    ],
  },
  {
    id: 'q2',
    courseId: 'get206',
    topicId: 'closed-systems',
    kind: 'followup',
    prompt: 'What assumption did you make about mass crossing the boundary?',
    expected: ['no mass', 'closed', 'boundary'],
    traps: [
      {
        match: 'open',
        misconception: 'Allows mass transfer in a closed system',
      },
    ],
  },
  {
    id: 'q3',
    courseId: 'get206',
    topicId: 'open-systems',
    kind: 'apply',
    prompt:
      'Would your answer change for an open system? Why, using Dr. Okafor’s notation ΔU = Q − W?',
    expected: ['mass', 'enthalpy', 'flow', 'open'],
    traps: [
      {
        match: 'same',
        misconception: 'Treats open and closed energy balances as identical',
      },
    ],
  },
  {
    id: 'q4',
    courseId: 'get206',
    topicId: 'entropy',
    kind: 'discuss',
    prompt:
      'A classmate says entropy is “the energy that is lost.” Correct them, then give one exam-style sentence of your own.',
    expected: ['disorder', 'irreversible', 'second law', 'unavailable', 'quality'],
    traps: [
      {
        match: 'lost energy',
        misconception: 'Treats entropy as a kind of energy',
      },
    ],
  },
]

export function evaluateAnswer(question: Question, answer: string): Evaluation {
  const text = answer.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean)
  const hits = question.expected.filter((e) => text.includes(e.toLowerCase()))
  const traps = question.traps.filter((t) => text.includes(t.match.toLowerCase()))
  const coverage = question.expected.length
    ? hits.length / question.expected.length
    : 0
  const lengthBonus = clamp((words.length - 12) / 80, 0, 0.15)
  const trapPenalty = traps.length * 0.12

  const recall = clamp(coverage + 0.15, 0.2, 0.98)
  const explanation = clamp(coverage * 0.85 + lengthBonus, 0.18, 0.95)
  const application = clamp(
    (text.includes('closed') || text.includes('open') || text.includes('heat')
      ? 0.55
      : 0.3) +
      coverage * 0.3 -
      trapPenalty,
    0.15,
    0.92,
  )
  const reasoning = clamp(
    explanation * 0.6 + application * 0.4 - trapPenalty,
    0.15,
    0.95,
  )
  const conceptual = clamp(
    (explanation + application + reasoning) / 3,
    0.15,
    0.96,
  )
  const correctness = clamp(coverage * 0.7 + reasoning * 0.3 - trapPenalty, 0.12, 0.96)

  const gotRight: string[] = []
  if (text.includes('conservation') || text.includes('conserved')) {
    gotRight.push('Identified conservation of energy')
  }
  if (text.includes('internal energy') || text.includes('Δu') || text.includes('delta u')) {
    gotRight.push('Spoke in terms of internal energy')
  }
  if (text.includes('heat') && text.includes('work')) {
    gotRight.push('Kept both heat and work in the balance')
  }
  if (gotRight.length === 0 && hits.length) {
    gotRight.push(`Touched ${hits.join(', ')}`)
  }
  if (gotRight.length === 0) gotRight.push('Attempted a free-form explanation')

  const missing: string[] = []
  if (!text.includes('closed') && question.topicId.includes('closed')) {
    missing.push('You did not state the closed-system condition')
  }
  if (traps.length) {
    traps.forEach((t) => missing.push(t.misconception))
  }
  if (!text.includes('work') && question.id === 'q1') {
    missing.push('Work is missing from the energy balance')
  }
  if (missing.length === 0) missing.push('Push the same idea onto a new system')

  const why =
    traps.find((t) => t.match === 'isolated') != null
      ? 'An isolated system does not exchange energy with its surroundings. A closed system can still exchange heat and work, just not mass.'
      : 'The first law is a bookkeeping statement. If the system definition changes, the terms in ΔU = Q − W change with it.'

  const tryThis =
    question.id === 'q1'
      ? 'Explain the difference between a closed system and an isolated system in your own words.'
      : 'Repeat the balance once, naming every term in ΔU = Q − W.'

  const summary =
    correctness > 0.75
      ? 'You are close. The definition is largely right; tighten the system boundary.'
      : correctness > 0.45
        ? 'Parts of this are correct, but the explanation is not yet something you could defend in an oral exam.'
        : 'This still reads as recall. Rebuild the argument from the system boundary outward.'

  return {
    correctness,
    conceptual_understanding: conceptual,
    reasoning,
    recall,
    explanation,
    application,
    confidence: clamp(words.length / 90, 0.25, 0.9),
    misconceptions: traps.map((t) => t.misconception),
    needs_followup: conceptual < 0.8 || traps.length > 0,
    gotRight,
    missing,
    whyItMatters: why,
    tryThis,
    summary,
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

