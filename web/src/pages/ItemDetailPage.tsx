import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApiError } from '../api/client';
import { api } from '../api/client';
import type { ActivityEvent, WorkItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { IconArrowLeft, IconCheck } from '../components/Icons';
import { WorkflowStrip } from '../components/WorkflowGuide';

function transitionLabel(from: string, to: string): string {
  if (from === 'AWAITING_APPROVAL' && to === 'RESOLVED') return 'Approve';
  if (from === 'AWAITING_APPROVAL' && to === 'IN_PROGRESS') return 'Reject / send back';
  if (from === 'IN_PROGRESS' && to === 'AWAITING_APPROVAL') return 'Submit for approval';
  if (from === 'IN_PROGRESS' && to === 'RESOLVED') return 'Mark resolved';
  if (from === 'IN_PROGRESS' && to === 'OPEN') return 'Release';
  if (from === 'RESOLVED' && to === 'CLOSED') return 'Close';
  if (from === 'RESOLVED' && to === 'IN_PROGRESS') return 'Reopen';
  if (from === 'OPEN' && to === 'IN_PROGRESS') return 'Start';
  return `Move to ${to}`;
}

export function ItemDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<WorkItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [version, setVersion] = useState(1);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [assignTo, setAssignTo] = useState('');

  function toDateInput(value: string | null | undefined) {
    if (!value) return '';
    return value.slice(0, 10);
  }

  const itemQuery = useQuery({
    queryKey: ['item', id],
    queryFn: () => api<WorkItem>(`/api/v1/work-items/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  const activityQuery = useQuery({
    queryKey: ['activity', id],
    queryFn: () =>
      api<{ items: ActivityEvent[] }>(`/api/v1/work-items/${id}/activity`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  const canAssign = Boolean(itemQuery.data?.allowedActions?.includes('assign'));
  const assignable =
    itemQuery.data &&
    (itemQuery.data.status === 'OPEN' || itemQuery.data.status === 'IN_PROGRESS');

  const membersQuery = useQuery({
    queryKey: ['team-members', itemQuery.data?.teamId],
    queryFn: () =>
      api<
        { userId: string; name: string; email: string; role: string }[]
      >(`/api/v1/teams/${itemQuery.data!.teamId}/members`),
    enabled: Boolean(itemQuery.data?.teamId && canAssign && assignable),
  });

  useEffect(() => {
    setActionError(null);
    setConflict(null);
    setBusy(false);
  }, [id]);

  useEffect(() => {
    const item = itemQuery.data;
    if (!item) return;
    setTitle(item.title);
    setDescription(item.description);
    setPriority(item.priority);
    setDueDate(toDateInput(item.dueDate));
    setVersion(item.version);
    setAssignTo(item.assigneeId ?? '');
    setConflict(null);
    if (item.status === 'CLOSED') setActionError(null);
  }, [itemQuery.data]);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['item', id] });
    void qc.invalidateQueries({ queryKey: ['activity', id] });
    void qc.invalidateQueries({ queryKey: ['items'] });
    void qc.invalidateQueries({ queryKey: ['summary'] });
  }

  const claim = useMutation({
    mutationFn: () =>
      api<WorkItem>(`/api/v1/work-items/${id}/claim`, { method: 'POST' }),
    onMutate: async () => {
      setActionError(null);
      setBusy(true);
      await qc.cancelQueries({ queryKey: ['item', id] });
      const prev = qc.getQueryData<WorkItem>(['item', id]);
      if (prev && user) {
        qc.setQueryData<WorkItem>(['item', id], {
          ...prev,
          assigneeId: user.id,
          assignee: { id: user.id, name: user.name, email: user.email },
          status: 'IN_PROGRESS',
        });
      }
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['item', id], ctx.prev);
      const apiErr = err as unknown as ApiError;
      setActionError(apiErr.message ?? 'Claim failed');
      if (apiErr.code === 'ALREADY_CLAIMED' || apiErr.code === 'VERSION_CONFLICT') {
        const current = (apiErr.details as { current?: WorkItem } | undefined)?.current;
        if (current) setConflict(current);
      }
    },
    onSuccess: (data) => {
      qc.setQueryData(['item', id], data);
      setVersion(data.version);
      setAssignTo(data.assigneeId ?? '');
    },
    onSettled: () => {
      setBusy(false);
      invalidate();
    },
  });

  function currentVersion() {
    return itemQuery.data?.version ?? version;
  }

  async function runAction(fn: () => Promise<WorkItem>) {
    setBusy(true);
    setActionError(null);
    setConflict(null);
    try {
      const data = await fn();
      qc.setQueryData(['item', id], data);
      setVersion(data.version);
      setAssignTo(data.assigneeId ?? '');
      invalidate();
    } catch (err) {
      const apiErr = err as unknown as ApiError;
      setActionError(apiErr.message ?? 'Action failed');
      if (apiErr.code === 'VERSION_CONFLICT' || apiErr.code === 'ALREADY_CLAIMED') {
        const current = (apiErr.details as { current?: WorkItem } | undefined)?.current;
        if (current) setConflict(current);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await runAction(() =>
      api<WorkItem>(`/api/v1/work-items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: currentVersion(),
          title,
          description,
          priority,
          dueDate: dueDate.trim() ? dueDate : null,
        }),
      }),
    );
  }

  async function onTransition(to: string) {
    const key = crypto.randomUUID();
    await runAction(() =>
      api<WorkItem>(`/api/v1/work-items/${id}/transition`, {
        method: 'POST',
        idempotencyKey: key,
        body: JSON.stringify({
          version: currentVersion(),
          to,
          reason: reason.trim() || undefined,
        }),
      }),
    );
    setReason('');
  }

  async function onComment(e: FormEvent) {
    e.preventDefault();
    const key = crypto.randomUUID();
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/v1/work-items/${id}/comments`, {
        method: 'POST',
        idempotencyKey: key,
        body: JSON.stringify({ body: comment }),
      });
      setComment('');
      invalidate();
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function onAssign() {
    const key = crypto.randomUUID();
    const assigneeId = assignTo.trim() ? assignTo : null;
    await runAction(() =>
      api<WorkItem>(`/api/v1/work-items/${id}/assign`, {
        method: 'POST',
        idempotencyKey: key,
        body: JSON.stringify({ version: currentVersion(), assigneeId }),
      }),
    );
  }

  if (itemQuery.isLoading) return <div className="info-box">Loading item…</div>;
  if (itemQuery.isError) {
    return (
      <div>
        <div className="error-box">
          Item not found or you do not have access.
        </div>
        <Link to="/">Back to list</Link>
      </div>
    );
  }

  const item = itemQuery.data!;
  const actions = new Set(item.allowedActions ?? []);
  const transitions = item.allowedTransitions ?? [];

  return (
    <div>
      <Link className="back-link" to="/">
        <IconArrowLeft className="icon" /> Back to queue
      </Link>

      <div className="detail-header page-head">
        <div className="eyebrow">{item.team?.name ?? 'Work item'} · item detail</div>
        <h1>{item.title}</h1>
        <p>{item.description}</p>
        {item.nextStep && (
          <p className="next-step">
            <strong>Next</strong>
            {item.nextStep}
          </p>
        )}
      </div>

      <WorkflowStrip current={item.status} showHelp={false} />

      {conflict && (
        <div className="info-box warn">
          This item was changed by someone else. Reload to see the latest version
          and discard your draft.
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                qc.setQueryData(['item', id], conflict);
                setConflict(null);
                setActionError(null);
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )}

      {actionError && <div className="error-box">{actionError}</div>}

      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2>Status &amp; actions</h2>
            <p className="panel-lead">
              Available actions for your role on this item.
            </p>
            <dl className="kv">
              <dt>Status</dt>
              <dd className={`status ${item.status}`}>{item.status}</dd>
              <dt>Priority</dt>
              <dd className={`priority-${item.priority}`}>{item.priority}</dd>
              <dt>Type</dt>
              <dd>{item.type}</dd>
              <dt>Team</dt>
              <dd>{item.team?.name}</dd>
              <dt>Assignee</dt>
              <dd>{item.assignee?.name ?? 'Unassigned'}</dd>
              <dt>Due</dt>
              <dd>{item.dueDate ? toDateInput(item.dueDate) : '—'}</dd>
              <dt>Creator</dt>
              <dd>{item.createdBy?.name}</dd>
              <dt>Version</dt>
              <dd className="mono">{item.version}</dd>
            </dl>

            <h3 className="actions-heading">Your available actions</h3>
            <div className="actions">
              {actions.has('claim') && item.status === 'OPEN' && !item.assigneeId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => claim.mutate()}
                >
                  <IconCheck className="icon" /> Claim
                </button>
              )}
              {transitions.map((to) => (
                <button
                  key={to}
                  type="button"
                  className={
                    item.status === 'AWAITING_APPROVAL' && to === 'RESOLVED'
                      ? undefined
                      : 'secondary'
                  }
                  disabled={busy}
                  onClick={() => onTransition(to)}
                >
                  {transitionLabel(item.status, to)}
                </button>
              ))}
            </div>

            {canAssign && assignable && (
              <div className="assign-box">
                <div className="assign-head">
                  <label htmlFor="assignTo">Assign to</label>
                  <span className="assign-current">
                    Now: {item.assignee?.name ?? 'Unassigned'}
                  </span>
                </div>
                <div className="assign-row">
                  <div className="assign-select-wrap">
                    <select
                      id="assignTo"
                      value={assignTo}
                      onChange={(e) => setAssignTo(e.target.value)}
                      disabled={busy || membersQuery.isLoading}
                    >
                      <option value="">Unassigned</option>
                      {(membersQuery.data ?? [])
                        .filter((m) => m.role !== 'VIEWER')
                        .map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.name}
                            {user?.id === m.userId ? ' (you)' : ''} · {m.role}
                          </option>
                        ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      (assignTo || null) === (item.assigneeId || null)
                    }
                    onClick={() => void onAssign()}
                  >
                    Assign
                  </button>
                </div>
              </div>
            )}

            {!actions.has('claim') &&
              transitions.length === 0 &&
              item.status !== 'CLOSED' && (
                <p className="field-hint" style={{ marginTop: '0.75rem' }}>
                  No actions available for your role on this item right now.
                </p>
              )}

            {transitions.length === 0 &&
              item.status === 'AWAITING_APPROVAL' &&
              item.assigneeId === user?.id && (
                <p className="field-hint" style={{ marginTop: '0.75rem' }}>
                  You own this item, so another Lead must approve or reject it.
                </p>
              )}

            {item.status === 'CLOSED' && (
              <p className="field-hint" style={{ marginTop: '0.75rem' }}>
                Closed — comments still allowed; fields and status are locked.
              </p>
            )}

            {(transitions.includes('RESOLVED') ||
              transitions.includes('IN_PROGRESS') ||
              transitions.includes('CLOSED')) && (
              <>
                <label htmlFor="reason">Reason / resolution note</label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Required for resolve, reject, and reopen"
                />
              </>
            )}
          </section>

          {actions.has('edit') && (
            <form className="panel" onSubmit={onSave}>
              <h2>Edit fields</h2>
              <p className="panel-lead">
                Change title, description, priority, or due date. Saving bumps
                the version; concurrent edits with an old version are rejected.
              </p>
              <label htmlFor="title">Title</label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={busy}
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
                disabled={busy}
              />
              <button type="submit" disabled={busy}>
                Save changes
              </button>
            </form>
          )}

          {actions.has('comment') && (
            <form className="panel" onSubmit={onComment}>
              <h2>Comment</h2>
              <p className="panel-lead">
                Leave a note for teammates. Comments appear in Activity.
              </p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                required
                disabled={busy}
                placeholder="Optional context for the next person"
              />
              <button type="submit" disabled={busy}>
                Add comment
              </button>
            </form>
          )}
        </div>

        <aside>
          <section className="panel">
            <h2>Activity</h2>
            <p className="panel-lead">Newest first</p>
            <ActivityTimeline
              loading={activityQuery.isLoading}
              items={activityQuery.data?.items ?? []}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
