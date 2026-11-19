'use strict';

const { BaseAgentAdapter, ClaudeCodeAdapter, CodexAdapter, GeminiCliAdapter } = require('@smr/adapters');
const { createRegistry } = require('@smr/core');
const { loadRegistryData } = require('@smr/config');
const { defineAdapterContract } = require('./adapter-contract');
const { FakeAdapter } = require('../fixtures/fake-adapter');

defineAdapterContract('base adapter (no capabilities)', () => new BaseAgentAdapter({ id: 'bare', displayName: 'Bare' }));

defineAdapterContract('fake adapter (turn routing + usage + model discovery)', () => new FakeAdapter());

const installed = (output) => async () => ({ found: true, output, error: null });
const missing = async () => ({ found: false, output: '', error: 'not found or failed to run' });
const registry = createRegistry(loadRegistryData());

defineAdapterContract('claude-code', () => new ClaudeCodeAdapter({ registry, runner: installed('2.1.328 (Claude Code)') }));
defineAdapterContract('claude-code (not installed, no registry)', () => new ClaudeCodeAdapter({ runner: missing }));
defineAdapterContract('codex (detection only)', () => new CodexAdapter({ runner: installed('codex-cli 0.98.0') }));
defineAdapterContract('gemini-cli (detection only)', () => new GeminiCliAdapter({ runner: missing }));
