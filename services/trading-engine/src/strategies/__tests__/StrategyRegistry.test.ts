/**
 * Tests for Strategy Registry
 */

import { describe, it, expect } from 'vitest';
import { getStrategyByProfileKey, getAvailableImplementationKeys } from '../StrategyRegistry';
import { getProfileByKey } from '../profiles/StrategyProfileStore';

describe('StrategyRegistry', () => {
  describe('getStrategyByProfileKey', () => {
    it('should load first_successful_strategy_from_god profile successfully', async () => {
      const strategy = await getStrategyByProfileKey('first_successful_strategy_from_god');
      expect(strategy).toBeDefined();
      expect(strategy.key).toBe('GOD_SMC_V1');
      expect(strategy.displayName).toBe('First Successful Strategy from GOD (Frozen)');
    });

    it('should throw error for non-existent profile', async () => {
      await expect(
        getStrategyByProfileKey('non_existent_profile')
      ).rejects.toThrow('Strategy profile not found');
    });
  });

  describe('getAvailableImplementationKeys', () => {
    it('should return available implementation keys', () => {
      const keys = getAvailableImplementationKeys();
      expect(keys).toContain('GOD_SMC_V1');
      expect(keys.length).toBeGreaterThan(0);
    });
  });

  describe('Profile Store', () => {
    it('should load first_successful_strategy_from_god profile from store', async () => {
      const profile = await getProfileByKey('first_successful_strategy_from_god');
      expect(profile).toBeDefined();
      expect(profile?.key).toBe('first_successful_strategy_from_god');
      expect(profile?.implementationKey).toBe('GOD_SMC_V1');
      expect(profile?.isDefault).toBe(true);
    });
  });
});

