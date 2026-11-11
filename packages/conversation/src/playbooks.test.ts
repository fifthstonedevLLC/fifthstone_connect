import { AiSettingsSchema } from '@fsc/core';
import { describe, expect, it } from 'vitest';
import { TRADES, WORKFLOW_KEYS, WORKFLOWS, trade, tradesFor, workflow } from './playbooks.js';
import { checkTemplate, sampleText, templateRule } from './templates.js';
import { simulateTestCall } from './test-call.js';

const BUSINESS = 'Riverbend Heating & Air';

describe('business types', () => {
  it('has one workflow per key, each with named trades and an "other" choice', () => {
    expect(WORKFLOWS.map((w) => w.key)).toEqual([...WORKFLOW_KEYS]);
    for (const key of WORKFLOW_KEYS) {
      const trades = tradesFor(key);
      expect(trades.length).toBeGreaterThanOrEqual(2);
      expect(trades.at(-1)?.key).toMatch(/_other$/);
    }
  });

  it('keys are unique and fit the database key pattern', () => {
    const keys = [...WORKFLOWS.map((w) => w.key), ...TRADES.map((t) => t.key)];
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z_]{1,39}$/);
    expect(new Set(TRADES.map((t) => t.key)).size).toBe(TRADES.length);
  });

  it.each(WORKFLOWS.map((w) => [w.key, w] as const))(
    'the %s starter templates pass every template rule',
    (_key, w) => {
      expect(Object.keys(w.templates).every((k) => templateRule(k) !== null)).toBe(true);
      for (const [key, body] of Object.entries(w.templates)) {
        expect({ key, problems: checkTemplate(key, body, BUSINESS).problems }).toEqual({
          key,
          problems: [],
        });
      }
    },
  );

  it('every workflow sends the same template keys, so switching keeps the engine whole', () => {
    const keys = Object.keys(WORKFLOWS[0]!.templates).sort();
    for (const w of WORKFLOWS) expect(Object.keys(w.templates).sort()).toEqual(keys);
  });

  it.each(TRADES.map((t) => [t.key, t] as const))(
    'the %s starter instructions are valid AI settings',
    (_key, t) => {
      expect(AiSettingsSchema.parse(t.ai)).toEqual(t.ai);
      expect(t.ai.questions?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(t.jobMinutes).toBeGreaterThanOrEqual(15);
      expect(t.jobMinutes).toBeLessThanOrEqual(480);
    },
  );

  it.each(TRADES.map((t) => [t.key, t] as const))(
    'the %s test call fills every text from its own sample',
    (_key, t) => {
      const w = workflow(t.workflow)!;
      const steps = simulateTestCall({
        businessName: BUSINESS,
        trade: t.key,
        connectNumber: '+13195550100',
        callerName: 'Rhett Boyd',
        callerNumber: '+13195550104',
        approverName: 'Rhett Boyd',
        approverChannel: w.approverChannel,
        templates: w.templates,
      });
      expect(steps[2]).toEqual({ kind: 'caller_replies', body: t.sample.reply });
      for (const step of steps) {
        if ('body' in step && step.body !== null) expect(step.body).not.toMatch(/[{}]/);
      }
      expect(sampleText(w.templates.missed_call_text_back!, BUSINESS, t.sample.values)).toContain(
        t.sample.values.need!,
      );
    },
  );

  it('looks up workflows and trades by key, and nothing else', () => {
    expect(workflow('shop_dropoff')?.name).toBe('Shop drop-off');
    expect(trade('lawn_care')?.workflow).toBe('recurring_service');
    expect(workflow('clinic')).toBeNull();
    expect(trade('clinic')).toBeNull();
  });
});
