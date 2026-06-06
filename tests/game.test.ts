import { describe, it, expect } from 'vitest';

import { Game } from '../src/game.js';

const base = {
  id: 1111,
  game_id: 9999,
  game: {
    title: 'Gabaghoul: The Sleazy Symbiosis',
    user: { username: 'grinningportal', display_name: 'Grinning Portal' },
    url: 'https://grinningportal.itch.io/gabaghoul-the-sleazy-symbiosis',
    id: 9999,
  },
};

describe('Game constructor', () => {
  it('parses owned-key data', () => {
    const g = new Game(base);
    expect(g.name).toBe('Gabaghoul: The Sleazy Symbiosis');
    expect(g.publisher).toBe('grinningportal');
    expect(g.id).toBe(1111);
    expect(g.gameId).toBe(9999);
    expect(g.publisherSlug).toBe('grinningportal');
    expect(g.gameSlug).toBe('gabaghoul-the-sleazy-symbiosis');
  });

  it('uses URL slugs when humanFolders is false', () => {
    const g = new Game(base, false);
    expect(g.publisherSlug).toBe('grinningportal');
    expect(g.gameSlug).toBe('gabaghoul-the-sleazy-symbiosis');
  });

  it('uses display names when humanFolders is true', () => {
    const g = new Game(base, true);
    expect(g.publisherSlug).toBe('Grinning Portal');
    expect(g.gameSlug).toBe('Gabaghoul- The Sleazy Symbiosis');
  });

  it('falls back to username when display_name is absent', () => {
    const data = {
      ...base,
      game: { ...base.game, user: { username: 'grinningportal' } },
    };
    const g = new Game(data, true);
    expect(g.publisherSlug).toBe('grinningportal');
  });

  it('sets id=false and derives gameId from game.id when no download key', () => {
    const g = new Game({ game: base.game });
    expect(g.id).toBe(false);
    expect(g.gameId).toBe(9999);
  });

  it('builds a relative dir path from publisher and game slug', () => {
    const g = new Game(base);
    expect(g.dir).toBe('downloads/grinningportal/gabaghoul-the-sleazy-symbiosis');
  });

  it('throws on a URL that does not match the itch.io pattern', () => {
    const data = { game: { ...base.game, url: 'https://example.com/game' } };
    expect(() => new Game(data)).toThrow('Cannot parse game URL');
  });

  it('sanitizes special characters in title for humanFolders dir', () => {
    const data = {
      ...base,
      game: {
        ...base.game,
        title: 'Game: With/Bad\\Chars',
        user: { username: 'dev' },
      },
    };
    const g = new Game(data, true);
    expect(g.gameSlug).not.toMatch(/[:/\\]/);
  });
});
