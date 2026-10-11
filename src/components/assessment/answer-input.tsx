import { Textarea } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function AnswerInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled?: boolean
}) {
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <label className="text-[12px] uppercase tracking-[0.16em] text-muted" htmlFor="answer">
        Type your explanation
      </label>
      <Textarea
        id="answer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write as you would in an exam — not a list of keywords."
        disabled={disabled}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || value.trim().length < 8}>
          Submit answer
        </Button>
      </div>
    </form>
  )
}

