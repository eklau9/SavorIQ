import { calculateDistance, formatDistance } from '../geo';

describe('geo utility', () => {
    describe('calculateDistance', () => {
        it('calculates the distance between two points correctly (San Francisco to Oakland)', () => {
            // SF: 37.7749, -122.4194
            // Oakland: 37.8044, -122.2711
            // Distance should be ~7.8 miles
            const dist = calculateDistance(37.7749, -122.4194, 37.8044, -122.2711);
            expect(dist).toBeGreaterThan(7);
            expect(dist).toBeLessThan(9);
        });

        it('returns 0 for the same point', () => {
            const dist = calculateDistance(37.7749, -122.4194, 37.7749, -122.4194);
            expect(dist).toBe(0);
        });
    });

    describe('formatDistance', () => {
        it('formats distance correctly', () => {
            expect(formatDistance(0.523)).toBe('0.5 mi');
            expect(formatDistance(10.89)).toBe('10.9 mi');
            expect(formatDistance(0)).toBe('0.0 mi');
        });

        it('returns empty string for null inputs', () => {
            expect(formatDistance(null as any)).toBe('');
            expect(formatDistance(undefined as any)).toBe('');
        });
    });
});
