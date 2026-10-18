import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Notification } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { IconBell, IconChevron, IconPlus } from './Icons';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

export function Layout() {
  const { user, memberships, logout } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const openingRef = useRef(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const notif = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api<{ items: Notification[]; unread: number }>('/api/v1/notifications'),
    refetchInterval: 15_000,
  });

  const primaryLabel = memberships[0]
    ? `${memberships[0].teamName} · ${memberships[0].role}`
    : user?.isAdmin
      ? 'Admin · all teams'
      : 'Signed in';

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (accountRef.current && !accountRef.current.contains(t)) {
        setAccountOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(t)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function openNotification(n: Notification) {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpeningId(n.id);

    try {
      if (!n.readAt) {
        try {
          await api(`/api/v1/notifications/${n.id}/read`, { method: 'POST' });
        } catch {
          // continue
        }
        await qc.invalidateQueries({ queryKey: ['notifications'] });
      }

      setNotifOpen(false);
      const path = `/items/${n.item.id}`;
      if (location.pathname === path) return;
      navigate(path, { replace: true });
    } finally {
      openingRef.current = false;
      setOpeningId(null);
    }
  }

  function signOut() {
    logout();
    qc.clear();
    window.location.href = '/login';
  }

  async function markAllRead() {
    try {
      await api('/api/v1/notifications/read-all', { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      // ignore
    }
  }

  const unread = notif.data?.unread ?? 0;

  function notifLabel(n: Notification) {
    const waiting = n.item.status === 'AWAITING_APPROVAL';
    if (n.message === 'A work item needs your approval' && !waiting) {
      return 'Approval request (already handled)';
    }
    return n.message;
  }

  return (
    <div className="app-frame">
      <div className="org-rail">
        <div className="org-rail-inner">
          <span className="org-name">Newtonite</span>
          <span className="org-sep" aria-hidden="true">
            /
          </span>
          <span>Operations platform</span>
        </div>
      </div>

      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand-block">
            <span className="brand-mark" aria-hidden="true">
              N
            </span>
            <span className="brand-text">
              <span className="brand">Operations Under Pressure</span>
              <span className="brand-tag">Live work queue across teams</span>
            </span>
          </Link>

          <div className="header-actions">
            <Link className="btn-new-item" to="/items/new">
              <IconPlus className="icon" />
              New item
            </Link>

            <div className="header-menu" ref={notifRef}>
              <button
                type="button"
                className={`icon-btn${notifOpen ? ' open' : ''}`}
                aria-expanded={notifOpen}
                aria-haspopup="true"
                aria-label={
                  unread > 0
                    ? `Notifications, ${unread} unread`
                    : 'Notifications'
                }
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setAccountOpen(false);
                }}
              >
                <IconBell size={18} />
                {unread > 0 ? (
                  <span className="icon-btn-badge">{unread > 9 ? '9+' : unread}</span>
                ) : null}
              </button>
              {notifOpen && (
                <div className="menu-panel notif-menu" role="menu">
                  <div className="menu-panel-head">
                    <strong>Notifications</strong>
                    {unread > 0 ? (
                      <span className="menu-meta">{unread} unread</span>
                    ) : (
                      <span className="menu-meta">Up to date</span>
                    )}
                    {unread > 0 ? (
                      <button
                        type="button"
                        className="linkish mark-all-read"
                        onClick={() => void markAllRead()}
                      >
                        Mark all read
                      </button>
                    ) : null}
                  </div>
                  {notif.data && notif.data.items.length > 0 ? (
                    <ul className="notif-list">
                      {notif.data.items.slice(0, 8).map((n) => (
                        <li key={n.id} className={n.readAt ? undefined : 'unread'}>
                          <button
                            type="button"
                            className="notif-row"
                            disabled={openingId === n.id}
                            onClick={() => void openNotification(n)}
                          >
                            <span className="notif-msg">{notifLabel(n)}</span>
                            <span className="notif-item">
                              {n.item.title}
                              <span className="mono"> · {n.item.status.replaceAll('_', ' ')}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="menu-empty">No notifications yet.</p>
                  )}
                </div>
              )}
            </div>

            <div className="header-menu" ref={accountRef}>
              <button
                type="button"
                className={`account-btn${accountOpen ? ' open' : ''}`}
                aria-expanded={accountOpen}
                aria-haspopup="true"
                onClick={() => {
                  setAccountOpen((v) => !v);
                  setNotifOpen(false);
                }}
              >
                <span className="avatar" aria-hidden="true">
                  {initials(user?.name ?? '')}
                </span>
                <span className="account-copy">
                  <span className="account-name">{user?.name}</span>
                  <span className="account-role">{primaryLabel}</span>
                </span>
                <IconChevron className="account-chevron" size={14} />
              </button>
              {accountOpen && (
                <div className="menu-panel account-menu" role="menu">
                  <div className="menu-panel-head">
                    <strong>{user?.name}</strong>
                    <span className="menu-meta mono">{user?.email}</span>
                  </div>
                  {memberships.length > 0 ? (
                    <ul className="membership-list">
                      {memberships.map((m) => (
                        <li key={`${m.teamId}-${m.role}`}>
                          <span>{m.teamName}</span>
                          <span className="mono">{m.role}</span>
                        </li>
                      ))}
                    </ul>
                  ) : user?.isAdmin ? (
                    <p className="menu-empty">Admin access to all teams</p>
                  ) : null}
                  <button
                    type="button"
                    className="menu-signout"
                    onClick={signOut}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="shell">
        <Outlet />
      </div>
    </div>
  );
}
