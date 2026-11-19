import { useEffect, useState } from 'react';
import { Card, Notice, PageHeader, Button, Empty } from '../components/ui.jsx';
import { useLoad } from '../useLoad.js';

const ROUTING_MODES = ['shadow', 'auto', 'off'];
const PRIVACY_MODES = ['local-only', 'local-ai', 'cloud-ai', 'hybrid'];
const PROVIDERS = ['agent-session', 'ollama', 'anthropic-api', 'openai-api', 'google-api'];
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const HOSTS = ['127.0.0.1', '::1'];

/** A copy of `object` with `path` (`a.b.c`) set to `value`; the original is untouched. */
export function setIn(object, path, value) {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...object, [head]: value };
  return { ...object, [head]: setIn(object?.[head] ?? {}, rest.join('.'), value) };
}

function getIn(object, path) {
  return path.split('.').reduce((v, k) => v?.[k], object);
}

export function Settings({ api, onSignedOut }) {
  const { data, error, loading } = useLoad(() => api.settings(), [], onSignedOut);
  // `saved` is what the file holds now: the loaded settings, then each saved result.
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setSaved(data);
      setForm(data);
    }
  }, [data]);

  if (error && !form) return <Notice tone="critical">{error.message}</Notice>;
  if (loading || !form) return <Empty>Loading…</Empty>;

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const field = (path) => ({ value: getIn(form, path), onChange: (v) => setForm((f) => setIn(f, path, v)) });

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.saveSettings(form);
      setSaved(result.settings);
      setForm(result.settings);
      setMessage({
        tone: 'good',
        text: result.restartNeeded ? 'Saved. The daemon listens on the new address after mr stop and mr start.' : 'Saved.',
      });
    } catch (e) {
      setMessage({ tone: 'critical', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="config.json, validated before it is written."
        actions={
          <>
            <Button variant="ghost" onClick={() => setForm(saved)} disabled={!dirty || busy}>
              Reset
            </Button>
            <Button variant="primary" onClick={save} disabled={!dirty || busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />
      {message && (
        <div className="mb-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scoring (reaches Claude Code)">
          <p className="mb-3 text-xs text-muted">The mod takes these from the daemon at the start of each session, with the routing rules.</p>
          <Toggle label="Sticky routing" hint="Stay on the current model unless another clearly scores better" {...field('routing.sticky.enabled')} />
          <NumberField label="Minimum score gain to switch" min={0} max={1} step={0.05} {...field('routing.sticky.minScoreGain')} />
          <NumberField label="Weight: quality" min={0} max={1} step={0.05} {...field('routing.weights.quality')} />
          <NumberField label="Weight: cost" min={0} max={1} step={0.05} {...field('routing.weights.cost')} />
          <NumberField label="Weight: latency" min={0} max={1} step={0.05} {...field('routing.weights.latency')} />
          <NumberField label="Weight: switching cost" min={0} max={1} step={0.05} {...field('routing.weights.transition')} />
        </Card>

        <Card title="Mode, privacy and classifier (defaults)">
          <p className="mb-3 text-xs text-muted">
            In Claude Code these come from the mod&apos;s own settings (/plugin → configure, or /route), where you consent to them; this page does not change a
            running mod. mr init prints these as the mod&apos;s starting values.
          </p>
          <SelectField label="Routing mode" options={ROUTING_MODES} {...field('routing.mode')} />
          <SelectField label="Privacy mode" options={PRIVACY_MODES} {...field('privacy.mode')} />
          <Toggle label="AI classifier" hint="Ask a model to classify a task when the rules are unsure" {...field('classifier.enabled')} />
          <SelectField label="Classifier provider" options={PROVIDERS} {...field('classifier.provider')} />
          <NumberField label="Classifier confidence threshold" min={0} max={1} step={0.05} {...field('classifier.confidenceThreshold')} />
          <NumberField label="Classifier timeout (ms)" min={100} max={60000} step={100} {...field('classifier.timeoutMs')} />
        </Card>

        <Card title="Daemon">
          <SelectField label="Host" options={HOSTS} {...field('server.host')} />
          <NumberField label="Port" min={1024} max={65535} step={1} {...field('server.port')} />
          <SelectField label="Log level" options={LOG_LEVELS} {...field('logging.level')} />
          <p className="mt-2 text-xs text-faint">Host and port apply after mr stop and mr start. Loopback only.</p>
        </Card>
      </div>
    </>
  );
}

function Row({ label, htmlFor, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0">
      <div>
        <label htmlFor={htmlFor} className="text-[13px] text-ink">
          {label}
        </label>
        {hint && <div className="text-xs text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

const idOf = (label) => `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function SelectField({ label, options, value, onChange }) {
  return (
    <Row label={label} htmlFor={idOf(label)}>
      <select id={idOf(label)} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md border border-line bg-surface-2 px-2 text-[13px] text-ink">
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Row>
  );
}

function NumberField({ label, value, onChange, min, max, step }) {
  return (
    <Row label={label} htmlFor={idOf(label)}>
      <input
        id={idOf(label)}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="h-8 w-28 rounded-md border border-line bg-surface-2 px-2 text-right font-mono text-[13px] text-ink"
      />
    </Row>
  );
}

function Toggle({ label, hint, value, onChange }) {
  return (
    <Row label={label} htmlFor={idOf(label)} hint={hint}>
      <input id={idOf(label)} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
    </Row>
  );
}
