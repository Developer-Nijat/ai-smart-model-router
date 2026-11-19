import { useState } from 'react';
import { Card, Select, Table, Notice, PageHeader, StatusBadge, Badge, Button } from '../components/ui.jsx';
import { useLoad } from '../useLoad.js';
import { usd, shortModel, label, time, int } from '../format.js';

const STATUSES = [['', 'Any status'], 'applied', 'recommended', 'skipped', 'unsupported', 'failed'];
const PERIODS = [['all', 'All time'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']];
const LIMITS = ['50', '100', '250', '500'];

export function History({ api, onSignedOut }) {
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState('all');
  const [limit, setLimit] = useState('100');
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useLoad(() => api.history({ status, period, limit: Number(limit) }), [status, period, limit], onSignedOut);

  const columns = [
    { key: 'time', title: 'Time', render: (e) => <span className="whitespace-nowrap font-mono text-xs">{time(e.createdAt)}</span> },
    { key: 'who', title: 'Who', render: (e) => (e.subagentId ? <Badge>subagent</Badge> : <Badge>main</Badge>) },
    { key: 'mode', title: 'Mode', render: (e) => e.mode },
    { key: 'status', title: 'Status', render: (e) => <StatusBadge status={e.status} /> },
    {
      key: 'picked',
      title: 'Picked',
      render: (e) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {shortModel(e.selection?.model)}
          {e.selection?.effort ? `/${e.selection.effort}` : ''}
        </span>
      ),
    },
    { key: 'answered', title: 'Answered by', render: (e) => <span className="font-mono text-xs">{e.appliedModel ?? '—'}</span> },
    { key: 'task', title: 'Task', render: (e) => label(e.taskType) },
    { key: 'cost', title: 'Est. cost', align: 'right', render: (e) => usd(e.estimatedCostUsd) },
    {
      key: 'why',
      title: '',
      render: (e) => (
        <Button variant="ghost" className="h-6 px-2 text-xs" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
          {open === e.id ? 'Hide' : 'Why'}
        </Button>
      ),
    },
  ];

  const rows = data ?? [];
  return (
    <>
      <PageHeader
        title="Routing history"
        description="Every model decision, newest first. No prompt text is stored: only the classification and the reason."
        actions={
          <>
            <Select label="Status" value={status} onChange={setStatus} options={STATUSES} />
            <Select label="Period" value={period} onChange={setPeriod} options={PERIODS} />
            <Select label="Show" value={limit} onChange={setLimit} options={LIMITS} />
            <Button onClick={reload} disabled={loading}>
              Refresh
            </Button>
          </>
        }
      />
      {error && <Notice tone="critical">{error.message}</Notice>}
      <Card>
        <Table
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          detail={(e) => (e.id === open ? <Detail entry={e} /> : null)}
          empty={loading ? 'Loading…' : 'No routed turns match these filters'}
        />
      </Card>
    </>
  );
}

function Detail({ entry }) {
  if (!entry) return null;
  const c = entry.classification;
  return (
    <div className="rounded-md border border-line bg-surface-2 p-3 text-[13px]">
      <div className="mb-2 font-mono text-xs text-faint">{entry.id}</div>
      <p className="text-ink">{entry.reason}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <Item k="decided by" v={label(entry.decisionSource)} />
        <Item k="verified" v={entry.verified === null ? '—' : entry.verified ? 'yes' : 'no'} />
        <Item k="steps" v={int(entry.steps)} />
        <Item k="session" v={entry.sessionId} />
        {c && (
          <>
            <Item k="complexity" v={c.complexity?.toFixed?.(2) ?? '—'} />
            <Item k="risk" v={c.risk} />
            <Item k="scope" v={label(c.scope)} />
            <Item k="confidence" v={c.confidence?.toFixed?.(2) ?? '—'} />
          </>
        )}
        {entry.tokens && (
          <>
            <Item k="input tokens" v={int(entry.tokens.inputTokens)} />
            <Item k="output tokens" v={int(entry.tokens.outputTokens)} />
            <Item k="cache read" v={int(entry.tokens.cacheReadTokens)} />
            <Item k="cache write" v={int(entry.tokens.cacheWriteTokens)} />
          </>
        )}
      </dl>
    </div>
  );
}

function Item({ k, v }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line py-1">
      <dt className="text-faint">{k}</dt>
      <dd className="truncate font-mono text-ink" title={String(v ?? '')}>
        {v ?? '—'}
      </dd>
    </div>
  );
}
