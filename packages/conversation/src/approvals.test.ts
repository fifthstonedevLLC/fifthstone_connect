import { describe, expect, it } from 'vitest';
import { approverAnswer, approverChoice } from './approvals.js';

describe('approverChoice', () => {
  it('maps 1, 2 and 3 to approve, suggest another time and call', () => {
    expect(approverChoice('1')).toBe('approve');
    expect(approverChoice(' 2. ')).toBe('suggest_time');
    expect(approverChoice('#3')).toBe('call');
  });

  it('never guesses from other words', () => {
    for (const body of ['yes', 'ok', '4', 'approve', '1 but later']) {
      expect(approverChoice(body), body).toBeNull();
    }
  });
});

describe('approverAnswer', () => {
  it('confirms what happened in plain words', () => {
    expect(
      approverAnswer({ kind: 'approved', name: 'Marcus T.', slot: 'Wed, Nov 11 at 2:00 PM' }),
    ).toBe('Approved. Marcus T. is being booked for Wed, Nov 11 at 2:00 PM.');
    expect(approverAnswer({ kind: 'suggested', name: 'Marcus T.' })).toBe(
      'OK. Marcus T. will be offered other times.',
    );
    expect(approverAnswer({ kind: 'call', name: 'Marcus T.', phone: '(319) 555-0142' })).toBe(
      'Call Marcus T. at (319) 555-0142.',
    );
  });

  it('explains what to reply, and when there is nothing to do', () => {
    expect(approverAnswer({ kind: 'help', name: 'Marcus T.' })).toBe(
      'Reply 1 to approve, 2 to suggest another time, or 3 to call Marcus T.',
    );
    expect(approverAnswer({ kind: 'nothing_waiting' })).toMatch(/^Nothing is waiting/);
    expect(approverAnswer({ kind: 'refused', error: 'hold_expired' })).toMatch(/no longer held/);
  });

  it('reminds once, and says plainly when a hold ran out', () => {
    const slot = 'Tue, Nov 10 at 9:00 AM';
    expect(approverAnswer({ kind: 'reminder', name: 'Marcus T.', slot })).toBe(
      'Reminder: Marcus T. is still waiting on Tue, Nov 10 at 9:00 AM. Reply 1 to approve, 2 to suggest another time, 3 to call.',
    );
    expect(approverAnswer({ kind: 'lapsed', name: 'Marcus T.', slot })).toBe(
      'The hold on Tue, Nov 10 at 9:00 AM for Marcus T. ran out with no approval, so the time was released. It is on the Front Desk.',
    );
  });
});
