import { describe, expect, it } from 'vitest';
import { parseYouTubeId } from '../src/domain/parseYouTubeId.js';

describe('parseYouTubeId', () => {
  const ID = 'dQw4w9WgXcQ';

  it('watch?v= 형태에서 추출', () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtube.com/watch?v=${ID}&t=10s`)).toBe(ID);
  });

  it('youtu.be 단축 링크에서 추출', () => {
    expect(parseYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtu.be/${ID}?si=abc`)).toBe(ID);
  });

  it('embed / shorts / v 경로에서 추출', () => {
    expect(parseYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/v/${ID}`)).toBe(ID);
  });

  it('nocookie 도메인 지원', () => {
    expect(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID);
  });

  it('순수 ID 원문 허용', () => {
    expect(parseYouTubeId(ID)).toBe(ID);
  });

  it('매칭 실패 시 null', () => {
    expect(parseYouTubeId(null)).toBeNull();
    expect(parseYouTubeId('')).toBeNull();
    expect(parseYouTubeId('https://example.com/video')).toBeNull();
    expect(parseYouTubeId('https://youtu.be/tooShort')).toBeNull();
  });
});
