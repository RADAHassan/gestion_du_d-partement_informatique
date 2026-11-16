const path = require('path');
const rules = require(path.resolve(__dirname, '..', '..', 'backend', 'src', 'services', 'rules'));

const P = (d, f) => ({ debut: `2030-01-01T${d}:00Z`, fin: `2030-01-01T${f}:00Z` });

describe('overlaps / findConflicts (détection de conflits)', () => {
  test('chevauchement partiel détecté', () => expect(rules.overlaps(P('08:00', '10:00'), P('09:00', '11:00'))).toBe(true));
  test('inclusion détectée', () => expect(rules.overlaps(P('08:00', '12:00'), P('09:00', '10:00'))).toBe(true));
  test('créneaux identiques', () => expect(rules.overlaps(P('08:00', '10:00'), P('08:00', '10:00'))).toBe(true));
  test('créneaux adjacents : pas de conflit', () => {
    expect(rules.overlaps(P('08:00', '10:00'), P('10:00', '12:00'))).toBe(false);
    expect(rules.overlaps(P('10:00', '12:00'), P('08:00', '10:00'))).toBe(false);
  });
  test('créneaux disjoints : pas de conflit', () => expect(rules.overlaps(P('08:00', '09:00'), P('14:00', '15:00'))).toBe(false));
  test('findConflicts ne retourne que les créneaux en conflit', () => {
    const existing = [P('08:00', '09:00'), P('09:30', '10:30'), P('13:00', '14:00')];
    expect(rules.findConflicts(P('10:00', '11:00'), existing)).toEqual([existing[1]]);
  });
});

describe('computeAbsentees (absences à la clôture du pointage)', () => {
  test('les non-pointés sont absents', () => expect(rules.computeAbsentees([1, 2, 3, 4], [1, 3])).toEqual([2, 4]));
  test('tous présents => aucun absent', () => expect(rules.computeAbsentees([1, 2], [2, 1])).toEqual([]));
  test('personne pointé => tous absents', () => expect(rules.computeAbsentees([1, 2], [])).toEqual([1, 2]));
  test('un présent hors groupe est ignoré', () => expect(rules.computeAbsentees([1, 2], [99])).toEqual([1, 2]));
});

describe('isBelowThreshold (alerte de stock)', () => {
  test('sous le seuil => alerte', () => expect(rules.isBelowThreshold(2, 3)).toBe(true));
  test('égal au seuil => pas d\'alerte', () => expect(rules.isBelowThreshold(3, 3)).toBe(false));
  test('au-dessus => pas d\'alerte', () => expect(rules.isBelowThreshold(10, 3)).toBe(false));
  test('seuil 0 => jamais d\'alerte', () => expect(rules.isBelowThreshold(0, 0)).toBe(false));
});

describe('availableQuantity (pas de double réservation du matériel)', () => {
  const reqs = [
    { ...P('08:00', '10:00'), quantite: 1 },
    { ...P('09:00', '11:00'), quantite: 1 },
    { ...P('14:00', '15:00'), quantite: 2 },
  ];
  test('déduit les demandes chevauchantes', () => expect(rules.availableQuantity(3, reqs, P('09:30', '10:30'))).toBe(1));
  test('ignore les demandes hors période', () => expect(rules.availableQuantity(3, reqs, P('12:00', '13:00'))).toBe(3));
  test('peut être nul quand tout est pris', () => expect(rules.availableQuantity(2, reqs, P('09:30', '10:00'))).toBe(0));
});

describe('generateCode', () => {
  test('longueur et alphabet sans caractères ambigus', () => {
    for (let i = 0; i < 200; i++) expect(rules.generateCode(6)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  test('codes non constants', () => {
    expect(new Set(Array.from({ length: 50 }, () => rules.generateCode(6))).size).toBeGreaterThan(40);
  });
});
