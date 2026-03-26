/**
 * Silver Bullet Time Window Service
 *
 * ICT Silver Bullet operates in 3 precise 1-hour windows (New York time):
 *   - London Open: 3:00-4:00 AM
 *   - NY AM: 10:00-11:00 AM
 *   - NY PM: 2:00-3:00 PM
 */

import { Logger } from '@providencex/shared-utils';

const logger = new Logger('SBTimeWindow');

export interface SilverBulletWindow {
  name: 'LDN_OPEN' | 'NY_AM' | 'NY_PM';
  label: string;
  startHourNY: number;
  endHourNY: number;
}

const WINDOWS: SilverBulletWindow[] = [
  { name: 'LDN_OPEN', label: 'London Open', startHourNY: 3, endHourNY: 4 },
  { name: 'NY_AM', label: 'NY AM Session', startHourNY: 10, endHourNY: 11 },
  { name: 'NY_PM', label: 'NY PM Session', startHourNY: 14, endHourNY: 15 },
];

export class SilverBulletTimeWindowService {
  private enabledWindows: Set<string>;

  constructor(enabledWindows?: string[]) {
    this.enabledWindows = new Set(enabledWindows || ['LDN_OPEN', 'NY_AM', 'NY_PM']);
  }

  /**
   * Check if the current time is within a Silver Bullet window
   */
  isInSilverBulletWindow(now?: Date): { active: boolean; window: SilverBulletWindow | null } {
    const nyTime = this.getNYTime(now || new Date());
    const hour = nyTime.getHours();
    const minute = nyTime.getMinutes();

    for (const window of WINDOWS) {
      if (!this.enabledWindows.has(window.name)) continue;
      if (hour === window.startHourNY || (hour === window.endHourNY && minute === 0)) {
        // Within the window (e.g., 10:00-10:59 for NY_AM, or exactly 11:00)
        if (hour === window.startHourNY) {
          return { active: true, window };
        }
      }
    }

    return { active: false, window: null };
  }

  /**
   * Get minutes remaining in the current window
   */
  getMinutesRemainingInWindow(now?: Date): number {
    const check = this.isInSilverBulletWindow(now);
    if (!check.active || !check.window) return 0;

    const nyTime = this.getNYTime(now || new Date());
    const endMinute = check.window.endHourNY * 60;
    const currentMinute = nyTime.getHours() * 60 + nyTime.getMinutes();
    return Math.max(0, endMinute - currentMinute);
  }

  /**
   * Get the next upcoming window
   */
  getNextWindow(now?: Date): { window: SilverBulletWindow; minutesUntil: number } | null {
    const nyTime = this.getNYTime(now || new Date());
    const currentMinute = nyTime.getHours() * 60 + nyTime.getMinutes();

    for (const window of WINDOWS) {
      if (!this.enabledWindows.has(window.name)) continue;
      const windowStart = window.startHourNY * 60;
      if (windowStart > currentMinute) {
        return { window, minutesUntil: windowStart - currentMinute };
      }
    }
    return null;
  }

  private getNYTime(date: Date): Date {
    const nyString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(nyString);
  }
}
