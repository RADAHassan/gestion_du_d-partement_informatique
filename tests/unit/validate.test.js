const path = require('path');
const v = require(path.resolve(__dirname, '..', '..', 'backend', 'src', 'utils', 'validate'));

describe('stripHtml (anti-XSS stocké)', () => {
  test.each([
    ['<script>alert(1)</script>Salle', 'Salle'],
    ['<img src=x onerror=alert(1)>Nom', 'Nom'],
    ['Texte <b>gras</b>', 'Texte gras'],
    ['<svg/onload=alert(1)>', ''],
    ['javascript:alert(1)', 'alert(1)'],
    ['Amphi A', 'Amphi A'],
  ])('%s => %s', (input, expected) => expect(v.stripHtml(input)).toBe(expected));
  test('ne laisse aucun chevron', () => expect(v.stripHtml('a < b > c')).not.toMatch(/[<>]/));
});

describe('validateurs', () => {
  test('int rejette les non-entiers', () => {
    expect(() => v.int('1; DROP TABLE users', 'id')).toThrow();
    expect(() => v.int(1.5, 'id')).toThrow();
    expect(v.int('12', 'id')).toBe(12);
  });
  test('email', () => {
    expect(() => v.email('pas-un-email')).toThrow();
    expect(v.email('A@B.ma')).toBe('a@b.ma');
  });
  test('period refuse fin <= debut', () => {
    expect(() => v.period({ debut: '2030-01-01T10:00:00Z', fin: '2030-01-01T09:00:00Z' })).toThrow();
    expect(() => v.period({ debut: '2030-01-01T10:00:00Z', fin: '2030-01-01T10:00:00Z' })).toThrow();
  });
  test('oneOf', () => expect(() => v.oneOf('root', 'role', ['admin'])).toThrow());
  test('password', () => {
    expect(() => v.password('court')).toThrow();
    expect(v.password('Longue@1234')).toBe('Longue@1234');
  });
  test('sanitizeDeep préserve les mots de passe', () => {
    expect(v.sanitizeDeep({ password: 'a<b>c', nom: '<i>x</i>' })).toEqual({ password: 'a<b>c', nom: 'x' });
  });
});
