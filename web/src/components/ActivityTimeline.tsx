import type { ActivityEvent } from '../api/types';

function statusLabel(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function fieldLabel(field: string | null) {
  if (!field) return 'field';
  return field.replaceAll('_', ' ');
}

function relativeWhen(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type Presented = {
  verb: string;
  detail: string | null;
  tone: 'status' | 'people' | 'field' | 'comment' | 'create';
};

function present(ev: ActivityEvent): Presented {
  switch (ev.kind) {
    case 'CREATED':
      return { verb: 'created this item', detail: null, tone: 'create' };
    case 'STATUS_CHANGED':
      return {
        verb: 'moved status',
        detail:
          ev.fromValue && ev.toValue
            ? `${statusLabel(ev.fromValue)} → ${statusLabel(ev.toValue)}`
            : ev.toValue
              ? `to ${statusLabel(ev.toValue)}`
              : null,
        tone: 'status',
      };
    case 'ASSIGNEE_CHANGED':
      if (!ev.fromValue && ev.toValue) {
        const selfClaim = ev.toValue === ev.actor.name;
        return {
          verb: selfClaim ? 'claimed this item' : 'assigned an owner',
          detail: selfClaim ? null : ev.toValue,
          tone: 'people',
        };
      }
      if (ev.fromValue && !ev.toValue) {
        return {
          verb: 'released ownership',
          detail: null,
          tone: 'people',
        };
      }
      return {
        verb: 'reassigned',
        detail:
          ev.fromValue && ev.toValue
            ? `${ev.fromValue} → ${ev.toValue}`
            : ev.toValue,
        tone: 'people',
      };
    case 'PRIORITY_CHANGED':
      return {
        verb: 'changed priority',
        detail:
          ev.fromValue && ev.toValue
            ? `${ev.fromValue} → ${ev.toValue}`
            : ev.toValue,
        tone: 'field',
      };
    case 'FIELD_CHANGED':
      return {
        verb: `updated ${fieldLabel(ev.field)}`,
        detail:
          ev.fromValue || ev.toValue
            ? `${ev.fromValue ?? '—'} → ${ev.toValue ?? '—'}`
            : null,
        tone: 'field',
      };
    case 'COMMENTED':
      return {
        verb: 'commented',
        detail: ev.toValue,
        tone: 'comment',
      };
    default:
      return {
        verb: ev.kind.replaceAll('_', ' ').toLowerCase(),
        detail:
          ev.fromValue || ev.toValue
            ? `${ev.fromValue ?? '—'} → ${ev.toValue ?? '—'}`
            : null,
        tone: 'field',
      };
  }
}

export function ActivityTimeline({
  items,
  loading,
}: {
  items: ActivityEvent[];
  loading?: boolean;
}) {
  if (loading) {
    return <p className="panel-lead">Loading activity…</p>;
  }

  if (items.length === 0) {
    return (
      <p className="panel-lead" style={{ marginBottom: 0 }}>
        No activity yet. Claims, status moves, and comments show up here.
      </p>
    );
  }

  return (
    <ul className="timeline">
      {items.map((ev) => {
        const p = present(ev);
        return (
          <li key={ev.id} className={`timeline-item tone-${p.tone}`}>
            <span className="timeline-dot" aria-hidden="true" />
            <div className="timeline-body">
              <div className="timeline-head">
                <strong>{ev.actor.name}</strong>
                <span className="timeline-verb">{p.verb}</span>
                <time
                  className="when"
                  dateTime={ev.createdAt}
                  title={new Date(ev.createdAt).toLocaleString()}
                >
                  {relativeWhen(ev.createdAt)}
                </time>
              </div>
              {p.detail ? <p className="timeline-detail">{p.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
