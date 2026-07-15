import {
  BanIcon,
  Building2Icon,
  EyeIcon,
  FoldersIcon,
  KeyRoundIcon,
  LayersIcon,
  ListIcon,
  LogInIcon,
  LogOutIcon,
  PenLineIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserRoundCogIcon,
  UserRoundMinusIcon,
  UserRoundPlusIcon,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { AuditEntry } from '@echo/shared';
import { CHART_COLORS, CHART_OTHER_COLOR, solidTileStyle } from './chart-colors';

/**
 * Presentation metadata for audit actions ("memory.recall", "org.member_add",
 * …), shared by the audit feed, the activity chart, and the home dashboard.
 * Actions are grouped into categories by their prefix; each category carries
 * the icon and the single color used everywhere that category appears (icon
 * tile, chart bar, legend swatch), so they always line up. Its prefix doubles
 * as the server-side action filter.
 */
export interface AuditCategory {
  key: string;
  /** Action prefix, e.g. "memory." — also sent as the ILIKE action filter. */
  prefix: string;
  label: string;
  icon: LucideIcon;
  /**
   * The category's one color, drawn from the shared CHART_COLORS palette. Icon
   * tiles fill with it via `auditTileStyle` and chart series pass it straight
   * to recharts, so a category reads the same everywhere.
   */
  color: string;
}

/**
 * Category order is fixed: it is the chart stack order and the legend order,
 * and colors are bound to categories (never to rank or count). Colors come
 * from CHART_COLORS in order — that palette's ordering was chosen so adjacent
 * stacked pairs clear CVD separation, and it puts the most legible hue on the
 * dominant "memory" series and the least legible on the rare "org" series.
 */
export const AUDIT_CATEGORIES: AuditCategory[] = [
  {
    key: 'memory',
    prefix: 'memory.',
    label: 'Memories',
    icon: LayersIcon,
    color: CHART_COLORS[0],
  },
  {
    key: 'apikey',
    prefix: 'apikey.',
    label: 'API keys',
    icon: KeyRoundIcon,
    color: CHART_COLORS[1],
  },
  {
    key: 'auth',
    prefix: 'auth.',
    label: 'Auth',
    icon: ShieldCheckIcon,
    color: CHART_COLORS[2],
  },
  {
    key: 'org',
    prefix: 'org.',
    label: 'Orgs',
    icon: Building2Icon,
    color: CHART_COLORS[3],
  },
  {
    key: 'scope',
    prefix: 'scope.',
    label: 'Scopes',
    icon: FoldersIcon,
    color: CHART_COLORS[4],
  },
];

export const OTHER_CATEGORY: AuditCategory = {
  key: 'other',
  prefix: '',
  label: 'Other',
  icon: ScrollTextIcon,
  color: CHART_OTHER_COLOR,
};

/**
 * Inline style for a category's icon tile: a solid fill of the category color
 * with a contrast-picked ink for the icon (white on most, dark on light hues
 * like yellow), so one `color` field drives the whole tile.
 */
export function auditTileStyle(category: AuditCategory): CSSProperties {
  return solidTileStyle(category.color);
}

export function auditCategory(action: string): AuditCategory {
  return AUDIT_CATEGORIES.find((c) => action.startsWith(c.prefix)) ?? OTHER_CATEGORY;
}

/** Human-readable labels for audit actions. */
export const ACTION_LABELS: Record<string, string> = {
  'memory.create': 'Memory created',
  'memory.update': 'Memory updated',
  'memory.delete': 'Memory deleted',
  'memory.get': 'Memory viewed',
  'memory.list': 'Memories listed',
  'memory.recall': 'Memory recalled',
  'memory.merge': 'Memories merged',
  'memory.similar': 'Similarity check',
  'apikey.create': 'API key created',
  'apikey.revoke': 'API key revoked',
  'auth.login': 'Login',
  'auth.signup': 'Signup',
  'org.create': 'Org created',
  'org.update': 'Org updated',
  'org.member_add': 'Org member added',
  'org.member_update': 'Org member updated',
  'org.member_remove': 'Org member removed',
  'org.member_leave': 'Left organization',
  'scope.create': 'Scope created',
  'scope.delete': 'Scope deleted',
  'scope.member_add': 'Scope member added',
  'scope.member_remove': 'Scope member removed',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

/** Verb-specific icons (keyed by the part after the dot); category icon otherwise. */
const VERB_ICONS: Record<string, LucideIcon> = {
  create: PlusIcon,
  update: PenLineIcon,
  delete: Trash2Icon,
  revoke: BanIcon,
  recall: SearchIcon,
  get: EyeIcon,
  list: ListIcon,
  login: LogInIcon,
  signup: UserRoundPlusIcon,
  member_add: UserRoundPlusIcon,
  member_update: UserRoundCogIcon,
  member_remove: UserRoundMinusIcon,
  member_leave: LogOutIcon,
};

export function actionIcon(action: string): LucideIcon {
  const verb = action.split('.')[1] ?? '';
  return VERB_ICONS[verb] ?? auditCategory(action).icon;
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const asNumber = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const counted = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
const joinParts = (parts: Array<string | null>): string | null => {
  const kept = parts.filter((p): p is string => p !== null);
  return kept.length ? kept.join(' · ') : null;
};

/**
 * One-line human summary of an entry's details, for the collapsed feed row.
 * Known actions get a hand-written sentence; anything else falls back to the
 * first few scalar detail values. Returns null when there is nothing useful.
 */
export function detailSummary(entry: AuditEntry): string | null {
  const d = entry.details;
  switch (entry.action) {
    case 'memory.create': {
      const scopeType = asString(d.scopeType);
      return joinParts([asString(d.kind), scopeType && `${scopeType} scope`]);
    }
    case 'memory.update': {
      if (d.movedOut === true) return 'Moved out of this organization';
      const fields = Array.isArray(d.fields) ? d.fields.filter((f) => typeof f === 'string') : [];
      return fields.length ? `Changed ${fields.join(', ')}` : null;
    }
    case 'memory.recall': {
      const query = asString(d.query);
      const count = asNumber(d.count);
      return joinParts([
        query && `“${query}”`,
        count !== null ? counted(count, 'result') : null,
        asString(d.mode),
      ]);
    }
    case 'memory.list': {
      const count = asNumber(d.count);
      const filters =
        d.filters && typeof d.filters === 'object'
          ? Object.values(d.filters).filter((v) => v != null).length
          : 0;
      return joinParts([count !== null ? counted(count, 'result') : null, filters > 0 ? 'filtered' : null]);
    }
    case 'apikey.create': {
      const prefix = asString(d.keyPrefix);
      return joinParts([asString(d.keyName), prefix && `${prefix}…`]);
    }
    case 'auth.login':
    case 'auth.signup':
      return asString(d.email);
    case 'org.create': {
      const slug = asString(d.slug);
      return joinParts([asString(d.name), slug && `/${slug}`]);
    }
    case 'org.update': {
      const name = asString(d.name);
      return name ? `Renamed to “${name}”` : null;
    }
    case 'org.member_add': {
      const role = asString(d.role);
      return joinParts([asString(d.memberEmail), role && `as ${role}`]);
    }
    case 'org.member_update': {
      const role = asString(d.role);
      return role ? `Role changed to ${role}` : null;
    }
    case 'scope.create':
    case 'scope.delete': {
      const type = asString(d.type);
      return joinParts([asString(d.name), type && `${type} scope`]);
    }
    default: {
      const parts = Object.entries(d)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${String(v)}`);
      return parts.length ? parts.join(' · ') : null;
    }
  }
}
