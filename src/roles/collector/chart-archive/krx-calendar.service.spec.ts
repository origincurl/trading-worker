import { KrxCalendarService } from './krx-calendar.service';

describe('KrxCalendarService', () => {
  const service = new KrxCalendarService();

  it('marks known KRX holidays as non-trading days', () => {
    expect(service.isTradingDay('2026-09-24')).toBe(false);
    expect(service.isTradingDay('2026-12-31')).toBe(false);
    expect(service.isTradingDay('2027-10-15')).toBe(false);
  });

  it('counts regular and partial one-minute sessions', () => {
    expect(service.expectedOneMinuteRows('2026-05-28')).toBe(380);
    expect(service.expectedOneMinuteRows('2026-12-30')).toBe(210);
    expect(service.expectedOneMinuteRows('2026-12-31')).toBe(0);
  });

  it('counts expected monthly hourly rows only through the current trade date', () => {
    expect(service.expectedHourlyRowsInMonth('2026-05', '2026-05-06')).toBe(14);
  });

  it('counts yearly daily rows only through the current trade date', () => {
    expect(service.expectedDailyRowsInYear('2026', '2026-01-06')).toBe(3);
  });
});
