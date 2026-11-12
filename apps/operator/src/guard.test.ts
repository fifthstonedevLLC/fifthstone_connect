import { describe, expect, it } from 'vitest';
import { guardProblems } from './guard.js';

describe('guardProblems', () => {
  it('keeps development to mock businesses, emails and numbers', () => {
    expect(
      guardProblems({
        env: 'development',
        slug: 'mock-cedar-lane',
        email: 'dee@cedarlane.example.com',
        number: '+13195550188',
      }),
    ).toEqual([]);
    expect(
      guardProblems({
        env: 'development',
        slug: 'cedar-lane',
        email: 'dee@gmail.com',
        number: '+13195551234',
      }),
    ).toHaveLength(3);
  });

  it('needs the environment typed out before changing staging or production', () => {
    expect(guardProblems({ env: 'staging', slug: 'mock-test' })).toEqual([
      'changes on staging need --confirm staging',
    ]);
    expect(guardProblems({ env: 'staging', slug: 'mock-test', confirm: 'staging' })).toEqual([]);
    expect(guardProblems({ env: 'production', slug: 'acme', confirm: 'staging' })).toEqual([
      'changes on production need --confirm production',
    ]);
  });

  it('never lets a mock business into production', () => {
    expect(guardProblems({ env: 'production', slug: 'mock-test', confirm: 'production' })).toEqual([
      'production never holds mock- businesses',
    ]);
    expect(guardProblems({ env: 'production', slug: 'acme', confirm: 'production' })).toEqual([]);
  });
});
