const STEPS = [
  { id: 'OPEN', label: 'Open' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'AWAITING_APPROVAL', label: 'Awaiting approval' },
  { id: 'RESOLVED', label: 'Resolved' },
  { id: 'CLOSED', label: 'Closed' },
] as const;

const STEP_HELP: Record<string, string> = {
  OPEN: 'Unowned — claim it, or a Lead can assign someone.',
  IN_PROGRESS: 'Owner is working it; next is resolve or submit for approval.',
  AWAITING_APPROVAL: 'Needs a Lead decision (not the assignee).',
  RESOLVED: 'Ready to close when the team is done.',
  CLOSED: 'Complete — history kept, fields locked.',
};

type Props = {
  current?: string;
  compact?: boolean;
  /** When false, only the status path is shown (no caption under it). */
  showHelp?: boolean;
};

/** Status path for the current item (or the shared lifecycle on the queue). */
export function WorkflowStrip({ current, compact, showHelp = true }: Props) {
  return (
    <div className={`workflow-strip${compact ? ' compact' : ''}`}>
      <ol>
        {STEPS.map((s, i) => {
          const active = current === s.id;
          const past =
            current != null &&
            STEPS.findIndex((x) => x.id === current) > i;
          return (
            <li
              key={s.id}
              className={active ? 'active' : past ? 'past' : undefined}
            >
              <span className="wf-dot">{i + 1}</span>
              <span className="wf-label">{s.label}</span>
            </li>
          );
        })}
      </ol>
      {showHelp && current && STEP_HELP[current] ? (
        <p className="wf-help">{STEP_HELP[current]}</p>
      ) : null}
      {showHelp && !current && !compact ? (
        <p className="wf-help">
          Payments and compliance go through approval. Other types can resolve
          directly from in progress.
        </p>
      ) : null}
    </div>
  );
}
