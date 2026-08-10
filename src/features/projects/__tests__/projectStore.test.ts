import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProjectStore } from '../store/projectStore';

describe('projectStore', () => {
  beforeEach(() => {
    // Reset store state
    useProjectStore.setState({
      currentProjectId: null,
      projects: [],
    });
  });

  describe('currentProjectId', () => {
    it.todo('should set current project ID');
    it.todo('should persist to localStorage');
    it.todo('should restore from localStorage');
  });

  describe('projects', () => {
    it.todo('should set projects list');
    it.todo('should add project to list');
    it.todo('should update project in list');
    it.todo('should remove project from list');
  });

  describe('computed', () => {
    it.todo('should get current project');
    it.todo('should get projects by space');
  });
});
