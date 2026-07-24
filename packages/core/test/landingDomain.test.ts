import { describe, expect, it } from 'vitest';
import { landingDomain } from '../src/domain/landingDomain.js';

describe('landingDomain', () => {
  it('전체 URL 에서 호스트 추출 (www 제거)', () => {
    expect(landingDomain('https://www.example.com/path?q=1')).toBe('example.com');
    expect(landingDomain('http://shop.example.co.kr/a/b')).toBe('shop.example.co.kr');
  });

  it('스킴 없는 도메인 문자열 허용', () => {
    expect(landingDomain('example.com')).toBe('example.com');
    expect(landingDomain('www.example.com/foo')).toBe('example.com');
  });

  it('빈/무효 입력은 null', () => {
    expect(landingDomain(null)).toBeNull();
    expect(landingDomain('')).toBeNull();
    expect(landingDomain('   ')).toBeNull();
  });
});
