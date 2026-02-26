import { describe, expect, it } from 'vitest';
import {
  convertValue,
  formatConverterResult,
  parseConverterInput,
} from '@/lib/converter';

describe('convertValue', () => {
  it('converts pressure values', () => {
    expect(convertValue('pressure', 'psi', 'bar', 32)).toBeCloseTo(2.2063, 4);
    expect(convertValue('pressure', 'bar', 'psi', 2.2)).toBeCloseTo(31.9083, 4);
    expect(convertValue('pressure', 'kPa', 'psi', 220)).toBeCloseTo(31.9083, 4);
  });

  it('converts temperature values', () => {
    expect(convertValue('temperature', 'F', 'C', 212)).toBe(100);
    expect(convertValue('temperature', 'C', 'F', 25)).toBe(77);
  });

  it('converts torque values', () => {
    expect(convertValue('torque', 'Nm', 'ft-lb', 100)).toBeCloseTo(73.7562, 4);
    expect(convertValue('torque', 'ft-lb', 'Nm', 100)).toBeCloseTo(135.5818, 4);
  });

  it('converts mass values', () => {
    expect(convertValue('mass', 'kg', 'lb', 10)).toBeCloseTo(22.0462, 4);
    expect(convertValue('mass', 'lb', 'kg', 100)).toBeCloseTo(45.3592, 4);
  });

  it('converts volume values', () => {
    expect(convertValue('volume', 'gal', 'L', 1)).toBeCloseTo(3.7854, 4);
    expect(convertValue('volume', 'oz', 'ml', 10)).toBeCloseTo(295.7353, 4);
    expect(convertValue('volume', 'qt', 'L', 1)).toBeCloseTo(0.9464, 4);
    expect(convertValue('volume', 'pt', 'oz', 1)).toBeCloseTo(16, 4);
  });

  it('converts spring rate values', () => {
    expect(convertValue('spring_rate', 'N/mm', 'lb/in', 10)).toBeCloseTo(57.1015, 4);
    expect(convertValue('spring_rate', 'lb/in', 'N/mm', 57.1015)).toBeCloseTo(10, 4);
    expect(convertValue('spring_rate', 'kgf/mm', 'lb/in', 1)).toBeCloseTo(56, 0);
  });

  it('converts length values', () => {
    expect(convertValue('length', 'mm', 'in', 25.4)).toBeCloseTo(1, 4);
    expect(convertValue('length', 'in', 'mm', 2)).toBeCloseTo(50.8, 4);
    expect(convertValue('length', 'cm', 'in', 10)).toBeCloseTo(3.937, 3);
  });

  it('converts speed values', () => {
    expect(convertValue('speed', 'mph', 'km/h', 60)).toBeCloseTo(96.5606, 4);
    expect(convertValue('speed', 'km/h', 'm/s', 100)).toBeCloseTo(27.7778, 4);
    expect(convertValue('speed', 'm/s', 'mph', 10)).toBeCloseTo(22.3694, 4);
  });

  it('returns null for invalid input', () => {
    expect(convertValue('volume', 'gal', 'L', null)).toBeNull();
    expect(convertValue('volume', 'x', 'L', 10)).toBeNull();
  });
});

describe('parseConverterInput', () => {
  it('parses valid numbers and returns null for empty/invalid', () => {
    expect(parseConverterInput('32.5')).toBe(32.5);
    expect(parseConverterInput('  10  ')).toBe(10);
    expect(parseConverterInput('')).toBeNull();
    expect(parseConverterInput('abc')).toBeNull();
  });
});

describe('formatConverterResult', () => {
  it('formats converter output for display', () => {
    expect(formatConverterResult(null)).toBe('—');
    expect(formatConverterResult(2)).toBe('2');
    expect(formatConverterResult(2.34567)).toBe('2.346');
    expect(formatConverterResult(2.3001)).toBe('2.3');
  });
});
