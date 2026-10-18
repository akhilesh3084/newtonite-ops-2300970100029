export type Membership = {
  teamId: string;
  teamName: string;
  role: 'VIEWER' | 'MEMBER' | 'LEAD';
};

export type User = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  memberships?: Membership[];
};

export type WorkItem = {
  id: string;
  teamId: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  assigneeId: string | null;
  createdById: string;
  dueDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  assignee?: { id: string; name: string; email?: string } | null;
  createdBy?: { id: string; name: string; email?: string };
  team?: { id: string; name: string };
  allowedActions?: string[];
  allowedTransitions?: string[];
  nextStep?: string;
};

export type ListResponse = {
  items: WorkItem[];
  nextCursor: string | null;
};

export type Summary = {
  byStatus: Record<string, number>;
  byPriorityOpen: Record<string, number>;
  overdue: number;
  unassignedUrgent: number;
  awaitingMyApproval: number;
};

export type ActivityEvent = {
  id: string;
  kind: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  actor: { id: string; name: string };
};

export type Notification = {
  id: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  item: { id: string; title: string; status: string };
};
