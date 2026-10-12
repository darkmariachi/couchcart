import { describe, expect, it } from 'vitest';
import { redact } from '../src/main/logging/redact';
import { makeJwt } from './helpers/fakeRomm';

describe('redact', () => {
  it('masks Authorization header values', () => {
    expect(redact('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [redacted]');
    expect(redact('authorization: basic dXNlcjpwYXNz')).toBe('authorization: basic [redacted]');
  });

  it('masks JWTs wherever they appear', () => {
    const jwt = makeJwt(Date.now());

    expect(redact(`failed with ${jwt} in body`)).toBe('failed with [redacted] in body');
  });

  it('masks sensitive form fields and JSON properties', () => {
    expect(redact('grant_type=password&username=bob&password=hunter2&scope=x')).toBe(
      'grant_type=password&username=bob&password=[redacted]&scope=x',
    );
    expect(redact('{"refresh_token": "opaque value", "expires": 1800}')).toBe(
      '{"refresh_token": [redacted], "expires": 1800}',
    );
    expect(redact('raw_token=rmm_abc123')).toBe('raw_token=[redacted]');
  });

  it('leaves ordinary text alone', () => {
    const text = 'GET /api/roms?platform_ids=4&limit=50 → 200 in 31 ms';

    expect(redact(text)).toBe(text);
  });
});
