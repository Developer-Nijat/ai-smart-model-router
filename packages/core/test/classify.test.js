'use strict';

const { ClassificationSchema } = require('@smr/shared');
const { classifyByRules } = require('../src');

const classify = (text, contextTokens) => classifyByRules({ text, contextTokens }).classification;

describe('classifyByRules', () => {
  it.each([
    ['Fix the bug where login fails with 500', 'bug_fix'],
    ['Add a /health endpoint to the express server', 'feature'],
    ['Refactor the parser to remove duplication', 'refactor'],
    ['Write unit tests for the cart module', 'test'],
    ['Update the README with install steps', 'docs'],
    ['Investigate and compare the two caching strategies', 'analysis'],
    ['Design the architecture for a microservice split', 'architecture'],
    ['Check the API for XSS and CSRF vulnerabilities', 'security'],
    ['Make the button layout responsive with tailwind', 'ui'],
    ['Set up the docker pipeline config', 'config'],
    ['What does this function do?', 'question'],
    ['hello there', 'other'],
    ['Login səhifəsində xətanı düzəlt', 'bug_fix'],
    ['Ödəniş modulunda təhlükəsizlik zəifliklərini araşdır', 'security'],
    ['Sistemin arxitekturasını izah et və struktur təklif et', 'architecture'],
    ['Bu funksiya nədir?', 'question'],
  ])('%s → %s', (text, taskType) => {
    expect(classify(text).taskType).toBe(taskType);
  });

  it('always returns a valid classification', () => {
    for (const text of ['', 'x'.repeat(10000), '🙂', 'Fix it', 'Ödəniş']) {
      expect(ClassificationSchema.safeParse(classify(text)).success).toBe(true);
    }
    expect(ClassificationSchema.safeParse(classifyByRules().classification).success).toBe(true);
  });

  it('does not match stems inside other words', () => {
    expect(classify('Show the city on the product page address').taskType).not.toBe('config');
    expect(classify('Update the author name').taskType).not.toBe('security');
    expect(classify('The silver product').risk).toBe('low');
  });

  it('treats explanation requests as questions, not as the topic they name', () => {
    expect(classify('Explain how the auth middleware works')).toMatchObject({ taskType: 'question', risk: 'low' });
    expect(classify('How does the security layer work?').taskType).toBe('question');
    expect(classify('Auth middleware-in necə işlədiyini izah et').taskType).toBe('question');
    expect(classify('Why does the login fail?').taskType).toBe('bug_fix');
    expect(classify('Whatever, add a logout button').taskType).toBe('feature');
  });

  it('does not flag ordinary wording as hard, risky or wide', () => {
    const plain = classify('Rename the helper and perform the cleanup');
    expect(plain.complexity).toBeLessThan(0.7);
    expect(classify('Delete the unused import in utils').risk).not.toBe('high');
    expect(classify('Bu importu sil').risk).toBe('low');
    expect(classify('Review this PR for naming').reasoning).not.toBe('high');
    expect(classify('Fix the version in package.json').scope).toBe('single_file');
    expect(classify('Add a tooltip across the header').complexity).toBe(classify('Add a tooltip in the header').complexity);
  });

  it('still flags real performance and destructive data work', () => {
    expect(classify('Fix the performance regression').reasoning).toBe('high');
    expect(classify('Delete the users table rows older than a year').risk).toBe('high');
    expect(classify('Bazadakı köhnə məlumatları sil').risk).toBe('high');
  });

  it('reads upper-case Azerbaijani with the dotted İ', () => {
    expect(classify('LOGİN SƏHİFƏSİ İŞLƏMİR').taskType).toBe('bug_fix');
  });

  it('lowers complexity for trivial work and raises it for hard or wide work', () => {
    const plain = classify('Fix the bug in the parser').complexity;
    expect(classify('Fix the small typo in the parser').complexity).toBeLessThan(plain);
    expect(classify('Fix the race condition in the parser').complexity).toBeGreaterThan(plain);
    expect(classify('Fix the bug in the parser across the entire codebase').complexity).toBeGreaterThan(plain);
    expect(classify(`Fix the bug ${'word '.repeat(450)}`).complexity).toBeGreaterThan(plain);
  });

  it('marks security and risky work as high risk with high reasoning', () => {
    const security = classify('Audit the auth flow for injection');
    expect(security).toMatchObject({ risk: 'high', reasoning: 'high' });
    expect(classify('Add a column to the production database').risk).toBe('high');
    expect(classify('Rename a variable').risk).toBe('medium');
    expect(classify('Fix the typo').risk).toBe('low');
  });

  it('derives scope from services, modules, paths and files', () => {
    expect(classify('Fix the bug').scope).toBe('single_file');
    expect(classify('Fix src/a.js and src/b.js').scope).toBe('multi_file');
    expect(classify('Fix src/a.js, src/b.js and lib/c.ts').scope).toBe('multi_module');
    expect(classify('Fix the bug in the billing module').scope).toBe('multi_module');
    expect(classify('Fix the bug across services').scope).toBe('multi_service');
  });

  it('is confident when one type clearly wins and unsure on a tie or no signal', () => {
    expect(classify('Fix the crash bug').confidence).toBeGreaterThanOrEqual(0.85);
    expect(classify('hello there').confidence).toBe(0.3);
    expect(classify('Fix the README').confidence).toBeLessThan(0.7);
  });

  it('flags urgency and keeps context size', () => {
    expect(classify('Quick: fix the bug').latencyPriority).toBe(true);
    expect(classify('Fix the bug', 72000).contextTokens).toBe(72000);
    expect(classify('Fix the bug', -1).contextTokens).toBeNull();
    expect(classify('Fix the bug', 1.5).contextTokens).toBeNull();
  });

  it('reports signal names, never the prompt words', () => {
    const { signals } = classifyByRules({ text: 'Fix the race condition in secret-project-x' });
    expect(signals).toContain('hard');
    expect(signals.join(' ')).not.toContain('secret-project-x');
  });

  it('caps mechanical one-spot edits at trivial complexity, unless they are wide or risky', () => {
    for (const text of ['Rename the variable usr to user in src/profile.js', 'Delete the unused import in src/app.ts', 'Change the submit button color to blue', 'Düymənin rəngini yaşıl et']) {
      const { classification, signals } = classifyByRules({ text });
      expect(signals, text).toContain('mechanical');
      expect(classification.complexity, text).toBeLessThanOrEqual(0.2);
    }
    expect(classifyByRules({ text: 'Remove the unused variable and refactor all files' }).signals).not.toContain('mechanical');
    expect(classifyByRules({ text: 'Change the payment button color in production' }).signals).not.toContain('mechanical');
  });

  it('reads a size word as trivial only when it sizes the change, not the thing built', () => {
    for (const text of ['Fix the small typo in the readme', 'Make a minor change to the footer text', 'Düymənin rəngini dəyiş, kiçik dəyişiklikdir']) {
      expect(classifyByRules({ text }).signals, text).toContain('trivial');
    }
    for (const text of ['Create a small Express API with GET /users and POST /users stored in a JSON file', 'Build a simple todo app with React', 'Kiçik bir REST API yarat']) {
      const { classification, signals } = classifyByRules({ text });
      expect(signals, text).not.toContain('trivial');
      expect(classification.complexity, text).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('does not read a file name as a task: profile.js is not profiling', () => {
    expect(classifyByRules({ text: 'Rename the variable usr to user in src/profile.js' }).signals).not.toContain('type:analysis');
    expect(classifyByRules({ text: 'Run profiling on the startup path' }).signals).toContain('type:analysis');
  });

  it('treats deleting stored data as hard-reasoning work, but not deleting code', () => {
    const data = classifyByRules({ text: 'Write a script to delete the duplicate records in the production database' });
    expect(data.signals).toContain('destructive');
    expect(data.classification.reasoning).toBe('high');
    expect(data.classification.complexity).toBeGreaterThanOrEqual(0.6);
    expect(classifyByRules({ text: 'Delete the old helper function' }).signals).not.toContain('destructive');
  });

  it('knows migrate as a verb and Azerbaijani authentication words', () => {
    expect(classifyByRules({ text: 'Migrate the orders table to a new schema' }).signals).toContain('hard');
    expect(classifyByRules({ text: 'Autentifikasiyanı yenidən dizayn et' }).classification.taskType).toBe('security');
  });

  it('is deterministic', () => {
    const text = 'Refactor the payment module across services';
    expect(classifyByRules({ text })).toEqual(classifyByRules({ text }));
  });
});
