import { useState } from 'react';
import { Card, Table, Notice, PageHeader, Badge, Button } from '../components/ui.jsx';
import { useLoad } from '../useLoad.js';
import { int, shortModel, time } from '../format.js';

const price = (v) => (Number.isFinite(v) ? `$${v}` : '—');

export function Models({ api, onSignedOut }) {
  const { data, error, loading } = useLoad(() => api.models(), [], onSignedOut);
  const sources = [...new Set((data ?? []).map((m) => m.price?.sourceUrl).filter(Boolean))];
  const columns = [
    {
      key: 'name',
      title: 'Model',
      render: (m) => (
        <div>
          <div className="text-ink">{m.name}</div>
          <div className="font-mono text-xs text-faint">{shortModel(m.id)}</div>
        </div>
      ),
    },
    { key: 'cc', title: 'Claude Code', render: (m) => <span className="font-mono text-xs">{m.claudeCode ?? '—'}</span> },
    { key: 'tier', title: 'Tier', render: (m) => m.tier },
    { key: 'status', title: 'Status', render: (m) => <Badge tone={m.status === 'enabled' ? 'good' : 'neutral'}>{m.status}</Badge> },
    { key: 'effort', title: 'Effort', render: (m) => <span className="text-xs text-muted">{(m.efforts ?? []).join(', ') || '—'}</span> },
    { key: 'ctx', title: 'Context', align: 'right', render: (m) => int(m.contextWindow) },
    { key: 'in', title: 'Input $/M', align: 'right', render: (m) => price(m.price?.inputPerMillion) },
    { key: 'out', title: 'Output $/M', align: 'right', render: (m) => price(m.price?.outputPerMillion) },
    { key: 'cr', title: 'Cache read $/M', align: 'right', render: (m) => price(m.price?.cacheReadPerMillion) },
    { key: 'cw', title: 'Cache write $/M', align: 'right', render: (m) => price(m.price?.cacheWritePerMillion) },
    { key: 'asof', title: 'Price as of', render: (m) => <span className="font-mono text-xs">{m.price?.asOf ?? '—'}</span> },
  ];
  return (
    <>
      <PageHeader title="Models" description="The model registry with sourced list prices. A missing price shows as —, never as zero." />
      {error && <Notice tone="critical">{error.message}</Notice>}
      <Card>
        <Table columns={columns} rows={data ?? []} rowKey={(m) => m.id} empty={loading ? 'Loading…' : 'No models in the registry'} />
        {sources.length > 0 && (
          <p className="mt-3 text-xs text-faint">
            Prices from{' '}
            {sources.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                {new URL(url).hostname}
              </a>
            ))}
            . Cache writes use the 5-minute rate; with 1-hour caching the real cost is higher.
          </p>
        )}
      </Card>
    </>
  );
}

const ROUTING = { turnLevelRouting: 'turns', subagentRouting: 'subagents', effortControl: 'effort' };

export function Agents({ api, onSignedOut }) {
  const { data, error, loading, reload } = useLoad(() => api.agents(), [], onSignedOut);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  async function detect() {
    setBusy(true);
    setProblem(null);
    try {
      await api.detectAgents();
      reload();
    } catch (e) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'name', title: 'Agent', render: (a) => a.displayName },
    { key: 'installed', title: 'Installed', render: (a) => <Badge tone={a.installed ? 'good' : 'neutral'}>{a.installed ? 'yes' : 'no'}</Badge> },
    { key: 'version', title: 'Version', render: (a) => <span className="font-mono text-xs">{a.version ?? '—'}</span> },
    {
      key: 'routing',
      title: 'Routing',
      render: (a) => {
        // Only what routing can change; other capabilities (usage, commands) are not routing.
        const on = Object.entries(ROUTING)
          .filter(([key]) => a.capabilities?.[key])
          .map(([, name]) => name);
        return <span className="text-xs text-muted">{on.length > 0 ? on.join(', ') : 'detection only'}</span>;
      },
    },
    { key: 'notes', title: 'Notes', render: (a) => <span className="text-xs text-muted">{(a.notes ?? []).join(' ')}</span> },
    { key: 'when', title: 'Checked', render: (a) => <span className="whitespace-nowrap font-mono text-xs">{time(a.detectedAt)}</span> },
  ];
  return (
    <>
      <PageHeader
        title="Agents"
        description="Coding agents on this machine and what routing each supports. Only Claude Code is routed; the others are detected."
        actions={
          <Button onClick={detect} disabled={busy}>
            {busy ? 'Detecting…' : 'Detect again'}
          </Button>
        }
      />
      {(error || problem) && <Notice tone="critical">{problem ?? error.message}</Notice>}
      <Card>
        <Table columns={columns} rows={data ?? []} rowKey={(a) => a.id} empty={loading ? 'Loading…' : 'Nothing detected yet: press Detect again'} />
      </Card>
    </>
  );
}
