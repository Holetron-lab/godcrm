import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSpaceManagerStore } from '../store/spaceManagerStore';

describe('spaceManagerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tree state', () => {
    it.todo('should set tree data');
    it.todo('should update tree node');
    it.todo('should remove tree node');
  });

  describe('selection', () => {
    it.todo('should select single item');
    it.todo('should select multiple items');
    it.todo('should toggle selection');
    it.todo('should clear selection');
  });

  describe('expanded state', () => {
    it.todo('should expand node');
    it.todo('should collapse node');
    it.todo('should toggle expand');
  });

  describe('drag and drop', () => {
    it.todo('should set dragging item');
    it.todo('should set drop target');
    it.todo('should clear drag state');
  });

  describe('clipboard', () => {
    it.todo('should copy items');
    it.todo('should cut items');
    it.todo('should paste items');
    it.todo('should clear clipboard');
  });
});
