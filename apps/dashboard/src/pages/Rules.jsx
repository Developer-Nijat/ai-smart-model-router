import { useState } from 'react';
import { Card, Table, Notice, PageHeader, Badge, Button, Empty } from '../components/ui.jsx';
import { useLoad } from '../useLoad.js';
import { shortModel } from '../format.js';

const TEMPLATE = {
  id: 'my-rule',
  name: 'Describe what this rule does',
  enabled: true,
  priority: 10,
  when: { taskTypes: ['security'] },
  then: { model: 'anthropic.claude-opus', effort: 'high' },
};

export function Rules({ api, onSignedOut }) {
  const { data, error, loading, reload } = useLoad(() => api.rules(), [], onSignedOut);
  const [draft, setDraft] = useState(null);
  const [problem, setProblem] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(rules, message) {
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      await api.saveRules(rules);
      setDraft(null);
      setSaved(message);
      reload();
    } catch (e) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    let parsed;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      setProblem(`Not valid JSON: ${e.message}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      setProblem('The rules must be a JSON array: [ { ... }, ... ]');
      return;
    }
    save(parsed, 'Rules saved.');
  }

  const user = data?.user ?? [];
  const toggle = (id) => save(user.map((r) => (r.id === id ? { ...r, enabled: r.enabled === false } : r)), `Rule ${id} updated.`);
  const remove = (id) => save(user.filter((r) => r.id !== id), `Rule ${id} deleted.`);

  const columns = [
    { key: 'id', title: 'Rule', render: (r) => <RuleName rule={r} /> },
    { key: 'priority', title: 'Priority', align: 'right', render: (r) => r.priority ?? 0 },
    { key: 'source', title: 'Source', render: (r) => <Badge tone={r.source === 'user' ? 'accent' : 'neutral'}>{r.source}</Badge> },
    { key: 'when', title: 'When', render: (r) => <Conditions when={r.when} /> },
    { key: 'then', title: 'Then', render: (r) => <Actions then={r.then} /> },
    {
      key: 'actions',
      title: '',
      render: (r) =>
        r.source === 'user' ? (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" className="h-6 px-2 text-xs" disabled={busy} onClick={() => toggle(r.id)}>
              {r.enabled === false ? 'Enable' : 'Disable'}
            </Button>
            <Button variant="danger" className="h-6 px-2 text-xs" disabled={busy} onClick={() => remove(r.id)} aria-label={`Delete rule ${r.id}`}>
              Delete
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Routing rules"
        description="Rules run before the scoring: for each action, the highest-priority matching rule wins."
        actions={
          <>
            <Button onClick={() => setDraft(JSON.stringify([...user, TEMPLATE], null, 2))} disabled={!data || draft !== null}>
              Add rule
            </Button>
            <Button onClick={() => setDraft(JSON.stringify(user, null, 2))} disabled={!data || draft !== null}>
              Edit as JSON
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2">
        <Notice>
          Your rules are saved to <code className="font-mono text-xs">{data?.file ?? 'rules.json'}</code>. Claude Code picks them up at the next session start, from the
          daemon. A user rule with a shipped rule&apos;s id replaces it.
        </Notice>
        {data?.userError && <Notice tone="critical">The rules file is invalid, so agents keep their last good rules: {data.userError}</Notice>}
        {error && <Notice tone="critical">{error.message}</Notice>}
        {problem && <Notice tone="critical">{problem}</Notice>}
        {saved && <Notice tone="good">{saved}</Notice>}
      </div>

      {draft !== null && (
        <Card title="Your rules (JSON)" className="mb-4">
          <label htmlFor="rules-json" className="sr-only">
            Rules JSON
          </label>
          <textarea
            id="rules-json"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            rows={Math.min(Math.max(draft.split('\n').length + 1, 8), 30)}
            className="w-full rounded-md border border-line bg-surface-2 p-3 font-mono text-xs text-ink"
          />
          <p className="mt-2 text-xs text-faint">
            Conditions: taskTypes, minComplexity, maxComplexity, risk, keywords, agents, contextUtilizationAbove. Actions: model, effort, avoidModelSwitch. See
            docs/routing-engine.md.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={saveDraft} disabled={busy}>
              Save rules
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setProblem(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <Card>
        {data && data.rules.length === 0 ? (
          <Empty>No routing rules yet. The router uses its classifier and scoring alone. Add a rule to pin a model for some kind of task.</Empty>
        ) : (
          <Table columns={columns} rows={data?.rules ?? []} rowKey={(r) => `${r.source}:${r.id}`} empty={loading ? 'Loading…' : 'No rules'} />
        )}
      </Card>
    </>
  );
}

function RuleName({ rule }) {
  return (
    <div className={rule.enabled === false ? 'opacity-60' : ''}>
      <div className="font-mono text-xs text-ink">{rule.id}</div>
      <div className="text-xs text-muted">
        {rule.name}
        {rule.enabled === false ? ' (disabled)' : ''}
      </div>
    </div>
  );
}

function Conditions({ when = {} }) {
  const parts = Object.entries(when).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  return <span className="font-mono text-xs text-muted">{parts.join(' · ')}</span>;
}

function Actions({ then = {} }) {
  const parts = [then.model && shortModel(then.model), then.effort && `effort ${then.effort}`, then.avoidModelSwitch !== undefined && `avoid switch: ${then.avoidModelSwitch}`].filter(Boolean);
  return <span className="font-mono text-xs text-ink">{parts.join(' · ')}</span>;
}
