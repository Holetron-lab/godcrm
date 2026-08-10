// backend/database/adapters/__tests__/DatabaseAdapter.test.js
// TDD: RED phase - Tests for abstract DatabaseAdapter interface
import { describe, it, expect } from 'vitest';
import { DatabaseAdapter } from '../DatabaseAdapter.js';

describe('DatabaseAdapter Interface', () => {
  it('should throw Not implemented for query()', async () => {
    const adapter = new DatabaseAdapter();
    await expect(adapter.query('SELECT 1')).rejects.toThrow('Not implemented');
  });

  it('should throw Not implemented for get()', async () => {
    const adapter = new DatabaseAdapter();
    await expect(adapter.get('SELECT 1')).rejects.toThrow('Not implemented');
  });

  it('should throw Not implemented for all()', async () => {
    const adapter = new DatabaseAdapter();
    await expect(adapter.all('SELECT 1')).rejects.toThrow('Not implemented');
  });

  it('should throw Not implemented for run()', async () => {
    const adapter = new DatabaseAdapter();
    await expect(adapter.run('SELECT 1')).rejects.toThrow('Not implemented');
  });

  it('should throw Not implemented for transaction()', async () => {
    const adapter = new DatabaseAdapter();
    await expect(adapter.transaction(() => {})).rejects.toThrow('Not implemented');
  });

  it('should throw Not implemented for ping()', async () => {
    const adapter = new DatabaseAdapter();
    await expect(adapter.ping()).rejects.toThrow('Not implemented');
  });

  it('should throw Not implemented for close()', async () => {
    const adapter = new DatabaseAdapter();
    await expect(adapter.close()).rejects.toThrow('Not implemented');
  });

  it('should throw Not implemented for getKnex()', () => {
    const adapter = new DatabaseAdapter();
    expect(() => adapter.getKnex()).toThrow('Not implemented');
  });
});
