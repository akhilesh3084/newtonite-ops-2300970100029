import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ListResponse, Summary, WorkItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { IconPlus } from '../components/Icons';
import { WorkflowStrip } from '../components/WorkflowGuide';

const VIEWS = [
  {
    id: '',
    label: 'All',
    help: 'All items visible to your teams.',
  },
  {
    id: 'mine',
    label: 'Assigned to me',
    help: 'Items you currently own.',
  },
  {
    id: 'unassigned_urgent',
    label: 'Unassigned urgent',
    help: 'Urgent items with no owner — open one to claim it.',
  },
  {
    id: 'awaiting_my_approval',
    label: 'Awaiting my approval',
    help: 'Waiting on a Lead decision for your team.',
  },
  {
    id: 'overdue',
    label: 'Overdue',
    help: 'Past due and still open.',
  },
  {
    id: 'stale',
    label: 'Stale',
    help: 'No recent updates — may need follow-up.',
  },
] as const;

function buildQuery(sp: URLSearchParams) {
  const q = new URLSearchParams();
  for (const key of ['view', 'status', 'priority', 'type', 'q', 'teamId']) {
    const v = sp.get(key);
    if (v) q.set(key, v);
  }
  q.set('limit', '20');
  return q.toString();
}

export function DashboardPage() {
  const { memberships, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(sp.get('q') ?? '');

  const teams = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of memberships) {
      if (!seen.has(m.teamId)) seen.set(m.teamId, m.teamName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [memberships]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(sp);
      if (searchDraft.trim()) next.set('q', searchDraft.trim());
      else next.delete('q');
      if (next.toString() !== sp.toString()) setSp(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft, sp, setSp]);

  const filtersKey = buildQuery(sp);

  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api<Summary>('/api/v1/work-items/summary'),
    refetchInterval: 15_000,
  });

  const list = useInfiniteQuery({
    queryKey: ['items', filtersKey],
    queryFn: ({ pageParam }) => {
      const q = buildQuery(sp);
      const suffix = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
      return api<ListResponse>(`/api/v1/work-items?${q}${suffix}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });

  const items = useMemo(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data],
  );

  function setView(view: string) {
    const next = new URLSearchParams(sp);
    if (view) next.set('view', view);
    else next.delete('view');
    setSp(next);
  }

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next);
  }

  const activeView = sp.get('view') ?? '';
  const viewMeta = VIEWS.find((v) => v.id === activeView) ?? VIEWS[0];
  const roleLine =
    memberships.length > 0
      ? memberships.map((m) => `${m.teamName} (${m.role})`).join(', ')
      : user?.isAdmin
        ? 'Admin — all teams'
        : 'No team membership';

  return (
    <div>
      <header className="page-head">
        <div className="eyebrow">Live queue</div>
        <h1>Work that needs attention</h1>
        <p>
          You are signed in as <strong>{user?.name}</strong> — {roleLine}. This
          list is only items your role can see. Open a row to claim, change
          status, comment, or read history.
        </p>
      </header>

      <WorkflowStrip />

      <div className="cta-banner">
        <div>
          <h2>Log a new request</h2>
          <p>
            Capture work for your team. Once it’s on the queue you can claim it,
            update status, and leave a short trail for whoever picks it up next.
          </p>
        </div>
        <Link className="btn-new-item" to="/items/new">
          <IconPlus className="icon" />
          New item
        </Link>
      </div>

      {summary.data && (
        <div className="summary-row">
          <button
            type="button"
            className={`summary-tile${activeView === 'unassigned_urgent' ? ' active' : ''}`}
            onClick={() => setView('unassigned_urgent')}
          >
            <strong>{summary.data.unassignedUrgent}</strong>
            <span>Unassigned urgent</span>
          </button>
          <button
            type="button"
            className={`summary-tile${activeView === 'awaiting_my_approval' ? ' active' : ''}`}
            onClick={() => setView('awaiting_my_approval')}
          >
            <strong>{summary.data.awaitingMyApproval}</strong>
            <span>Awaiting your approval</span>
          </button>
          <button
            type="button"
            className={`summary-tile${activeView === 'overdue' ? ' active' : ''}`}
            onClick={() => setView('overdue')}
          >
            <strong>{summary.data.overdue}</strong>
            <span>Overdue</span>
          </button>
          <button
            type="button"
            className={`summary-tile${activeView === '' ? ' active' : ''}`}
            onClick={() => setView('')}
          >
            <strong>{summary.data.byStatus.OPEN ?? 0}</strong>
            <span>Currently open</span>
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="view-tabs" aria-label="Queue views">
          {VIEWS.map((v) => (
            <button
              key={v.id || 'all'}
              type="button"
              className={activeView === v.id ? 'active' : undefined}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="view-help">{viewMeta.help}</p>

        <div className="filters">
          <div>
            <label htmlFor="q">Search title</label>
            <input
              id="q"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search by title"
            />
          </div>
          <div>
            <label htmlFor="status">Status</label>
            <select
              id="status"
              value={sp.get('status') ?? ''}
              onChange={(e) => setFilter('status', e.target.value)}
            >
              <option value="">Any</option>
              <option value="OPEN">OPEN</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="AWAITING_APPROVAL">AWAITING_APPROVAL</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </div>
          <div>
            <label htmlFor="priority">Priority</label>
            <select
              id="priority"
              value={sp.get('priority') ?? ''}
              onChange={(e) => setFilter('priority', e.target.value)}
            >
              <option value="">Any</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="URGENT">URGENT</option>
            </select>
          </div>
          <div>
            <label htmlFor="type">Type</label>
            <select
              id="type"
              value={sp.get('type') ?? ''}
              onChange={(e) => setFilter('type', e.target.value)}
            >
              <option value="">Any</option>
              <option value="INCIDENT">INCIDENT</option>
              <option value="CUSTOMER_ISSUE">CUSTOMER_ISSUE</option>
              <option value="PAYMENT">PAYMENT</option>
              <option value="COMPLIANCE">COMPLIANCE</option>
              <option value="TASK">TASK</option>
            </select>
          </div>
          {teams.length > 0 && (
            <div>
              <label htmlFor="teamId">Team</label>
              <select
                id="teamId"
                value={sp.get('teamId') ?? ''}
                onChange={(e) => setFilter('teamId', e.target.value)}
              >
                <option value="">Any</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="list-caption">
        <span>Showing: {viewMeta.label}</span>
        <span>{items.length} loaded · click a row to open</span>
      </div>

      {list.isLoading && <div className="info-box">Loading items...</div>}
      {list.isError && (
        <div className="error-box">Could not load items. Check the API is running.</div>
      )}
      {!list.isLoading && items.length === 0 && (
        <div className="empty">
          <strong>No items match this filter.</strong>
          <p>Try All, clear search, or log a new request.</p>
          <Link className="btn-new-item" to="/items/new">
            <IconPlus className="icon" />
            New item
          </Link>
        </div>
      )}

      {items.length > 0 && (
        <div className="item-list">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {list.hasNextPage && (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: WorkItem }) {
  const due = item.dueDate ? item.dueDate.slice(0, 10) : null;
  return (
    <Link className="item-row" to={`/items/${item.id}`}>
      <div>
        <h3>{item.title}</h3>
        <div className="item-meta">
          <span className={`tag priority-${item.priority}`}>{item.priority}</span>
          <span className="tag">{item.type}</span>
          <span className="tag">{item.team?.name ?? 'Team'}</span>
          <span className="tag">{item.assignee?.name ?? 'Unassigned'}</span>
          {due ? <span className="tag">Due {due}</span> : null}
        </div>
        {item.nextStep ? (
          <div className="row-next">Next: {item.nextStep}</div>
        ) : null}
      </div>
      <div className={`status ${item.status}`}>{item.status.replaceAll('_', ' ')}</div>
    </Link>
  );
}
