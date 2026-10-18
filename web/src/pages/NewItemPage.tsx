import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ApiError } from '../api/client';
import { api } from '../api/client';
import type { WorkItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { IconArrowLeft, IconPlus } from '../components/Icons';
import { WorkflowStrip } from '../components/WorkflowGuide';

export function NewItemPage() {
  const { memberships } = useAuth();
  const navigate = useNavigate();
  const idemKey = useMemo(() => crypto.randomUUID(), []);
  const creatable = memberships.filter((m) => m.role !== 'VIEWER');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('PAYMENT');
  const [priority, setPriority] = useState('URGENT');
  const [teamId, setTeamId] = useState(creatable[0]?.teamId ?? '');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const item = await api<WorkItem>('/api/v1/work-items', {
        method: 'POST',
        idempotencyKey: idemKey,
        body: JSON.stringify({
          title,
          description,
          type,
          priority,
          teamId,
          dueDate: dueDate.trim() ? dueDate : null,
        }),
      });
      navigate(`/items/${item.id}`);
    } catch (err) {
      setError((err as ApiError).message);
      setPending(false);
    }
  }

  if (creatable.length === 0) {
    return (
      <div>
        <header className="page-head">
          <div className="eyebrow">Create</div>
          <h1>New work item</h1>
        </header>
        <div className="error-box">
          Viewers cannot create items. Sign in as a Member, Lead, or Admin.
        </div>
        <Link to="/">Back to queue</Link>
      </div>
    );
  }

  const needsApproval = type === 'PAYMENT' || type === 'COMPLIANCE';

  return (
    <div>
      <Link className="back-link" to="/">
        <IconArrowLeft className="icon" /> Back to queue
      </Link>
      <header className="page-head">
        <div className="eyebrow">Create</div>
        <h1>New work item</h1>
        <p>
          Add a request to the queue. It starts open and unassigned
          {needsApproval
            ? ` — ${type} items need Lead approval before they can close.`
            : ` — ${type} items can be resolved by the owner without a Lead gate.`}
        </p>
      </header>

      <WorkflowStrip current="OPEN" compact />

      {error && <div className="error-box">{error}</div>}

      <form className="panel" onSubmit={onSubmit} style={{ maxWidth: 560 }}>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={3}
          maxLength={200}
          placeholder="Short name, e.g. Refund above threshold"
        />

        <label htmlFor="description">What happened and why does this need action?</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          minLength={10}
          maxLength={5000}
          placeholder="Enough context that another teammate can act without asking you."
        />

        <label htmlFor="team">Team</label>
        <select
          id="team"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          required
        >
          {creatable.map((m) => (
            <option key={m.teamId} value={m.teamId}>
              {m.teamName} ({m.role})
            </option>
          ))}
        </select>
        <p className="field-hint">Only teams where you are Member or Lead.</p>

        <label htmlFor="type">Type</label>
        <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="TASK">TASK</option>
          <option value="INCIDENT">INCIDENT</option>
          <option value="CUSTOMER_ISSUE">CUSTOMER_ISSUE</option>
          <option value="PAYMENT">PAYMENT</option>
          <option value="COMPLIANCE">COMPLIANCE</option>
        </select>
        <p className="field-hint">
          {needsApproval
            ? 'PAYMENT and COMPLIANCE require Lead approval before close.'
            : 'This type can be resolved by the owner without Lead approval.'}
        </p>

        <label htmlFor="priority">Priority</label>
        <select
          id="priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
          <option value="URGENT">URGENT</option>
        </select>

        <label htmlFor="dueDate">Due date</label>
        <input
          id="dueDate"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <p className="field-hint">Optional. Past due open items appear in Overdue.</p>

        <button type="submit" disabled={pending}>
          <IconPlus className="icon" />
          {pending ? 'Creating...' : 'Create item and continue'}
        </button>
      </form>
    </div>
  );
}
