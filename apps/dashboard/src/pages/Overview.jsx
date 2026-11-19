import { useState } from 'react';
import { Card, Stat, Select, Table, Notice, PageHeader, Empty } from '../components/ui.jsx';
import { BarList } from '../components/BarList.jsx';
import { useLoad } from '../useLoad.js';
import { int, usd, shortModel, label, time } from '../format.js';

const PERIODS = [
  ['24h', 'Last 24 hours'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['all', 'All time'],
];

export function Overview({ api, onSignedOut }) {
  const [period, setPeriod] = useState('7d');
  const { data, error, loading } = useLoad(() => api.overview(period), [period], onSignedOut);

  return (
    <>
      <PageHeader
        title="Overview"
        description="What the router decided and what it cost, from the decisions agents reported."
        actions={<Select label="Period" value={period} onChange={setPeriod} options={PERIODS} />}
      />
      {error && <Notice tone="critical">{error.message}</Notice>}
      {loading && !data && <Empty>Loading…</Empty>}
      {data && <OverviewBody data={data} />}
    </>
  );
}

function OverviewBody({ data }) {
  const { stats, comparison } = data;
  if (stats.total === 0) {
    return (
      <Card>
        <Empty>
          No routed turns in this period. Start the daemon (mr start) and use Claude Code with the mod; decisions appear here.
          {data.last ? ` Last decision: ${time(data.last)}.` : ''}
        </Empty>
      </Card>
    );
  }
  const unknown = stats.unknownCostTurns > 0 ? `+ ${int(stats.unknownCostTurns)} turn(s) with an unknown price` : 'every turn priced';
  // With no turn priced, $0 would claim a known zero: show the dash instead.
  const knownCost = stats.unknownCostTurns >= stats.total ? null : stats.knownCostUsd;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Routed turns" value={int(stats.total)} hint={`${int(stats.mainTurns)} main · ${int(stats.subagentTurns)} subagent`} />
        <Stat label="Sessions" value={int(stats.sessions)} hint={`last ${time(stats.last)}`} />
        <Stat label="Estimated API-equivalent cost" value={usd(knownCost)} hint={unknown} />
        <Stat
          label="Tokens (input / output)"
          value={`${compact(stats.tokens.input)} / ${compact(stats.tokens.output)}`}
          hint={`cache read ${compact(stats.tokens.cacheRead)} · write ${compact(stats.tokens.cacheWrite)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Answered by">
          <BarList counts={stats.byAnsweredModel} total={stats.total} format={shortModel} />
        </Card>
        <Card title="Picked by the router">
          <BarList counts={stats.bySelectedModel} total={stats.total} format={shortModel} />
        </Card>
        <Card title="Task type">
          <BarList counts={stats.byTaskType} total={stats.total} format={label} />
        </Card>
        <Card title="Decision status">
          <BarList counts={stats.byStatus} total={stats.total} />
        </Card>
        <Card title="Decided by">
          <BarList counts={stats.bySource} total={stats.total} format={label} />
        </Card>
        <Card title="Routing mode">
          <BarList counts={stats.byMode} total={stats.total} />
        </Card>
      </div>

      <Card title="Same tokens priced on one model">
        <p className="mb-3 text-[13px] text-muted">
          Over {int(comparison.comparedTurns)} of {int(comparison.turnsWithUsage)} turn(s) with usage: those priced on every model, so each row covers
          the same turns.{comparison.excludedTurns > 0 ? ` ${int(comparison.excludedTurns)} turn(s) left out for an unknown price.` : ''} API list
          prices on each turn&apos;s day: on a subscription these are comparison figures, not charges. Another model would not write exactly the same
          tokens, so this is an approximation.
        </p>
        <Table
          columns={[
            { key: 'name', title: 'Priced as' },
            { key: 'cost', title: 'Estimated cost', align: 'right', render: (r) => usd(r.cost) },
          ]}
          rows={[{ name: 'What actually answered', cost: comparison.actualUsd }, ...Object.entries(comparison.sameTokensOnlyOn).map(([model, cost]) => ({ name: `Only ${shortModel(model)}`, cost }))]}
          rowKey={(r) => r.name}
        />
      </Card>
    </div>
  );
}

function compact(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  return int(n);
}
