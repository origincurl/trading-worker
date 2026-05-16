import { IndicatorService } from './indicator.service';

describe('IndicatorService', () => {
  let svc: IndicatorService;

  beforeEach(() => {
    svc = new IndicatorService();
  });

  it('emits null SMA while window is not full', () => {
    for (let i = 1; i <= 5; i++) {
      const [sma, ema] = svc.update('005930', 'mock', i);

      expect(sma.indicatorType).toBe('sma');

      expect(sma.value).toBeNull();

      expect(ema.indicatorType).toBe('ema');

      expect(ema.value).toBeNull();
    }
  });

  it('emits SMA20 = average of last 20 closes once window is full', () => {
    let last: number | null = null;

    for (let i = 1; i <= 20; i++) {
      const [sma] = svc.update('005930', 'mock', i);

      last = sma.value;
    }

    // Mean of 1..20 = 10.5
    expect(last).toBe(10.5);
  });

  it('rolls SMA forward as new closes arrive', () => {
    for (let i = 1; i <= 20; i++) svc.update('005930', 'mock', i);

    // Add 21 → drop 1 → window is 2..21, mean = 11.5
    const [sma] = svc.update('005930', 'mock', 21);

    expect(sma.value).toBe(11.5);
  });

  it('emits EMA only after window-size samples are seen', () => {
    for (let i = 1; i < 20; i++) {
      const [, ema] = svc.update('005930', 'mock', i);

      expect(ema.value).toBeNull();
    }

    const [, ema20] = svc.update('005930', 'mock', 20);

    expect(ema20.value).not.toBeNull();
  });

  it('keeps separate state per symbol', () => {
    for (let i = 1; i <= 20; i++) svc.update('005930', 'mock', i);

    const [otherSma] = svc.update('000660', 'mock', 50);

    // First sample for new symbol → window not warm yet
    expect(otherSma.value).toBeNull();
  });
});
