import 'package:flutter_test/flutter_test.dart';

import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/ohlc_candle.dart';
import 'package:rally/domain/models/price_zone.dart';
import 'package:rally/domain/models/recommendation.dart';
import 'package:rally/domain/models/reward_risk_ratio.dart';
import 'package:rally/domain/services/valuations_engine.dart';

void main() {
  late ValuationsEngine engine;

  setUp(() {
    engine = ValuationsEngine();
  });

  /// Helper to create a candle with a rejection pattern at the high
  /// (significant upper wick relative to total range).
  OhlcCandle supplyRejectionCandle({
    required double high,
    required DateTime timestamp,
    double? open,
    double? close,
  }) {
    // Upper wick should be >= 30% of range.
    // range = high - low. upper wick = high - max(open, close).
    // We'll set close well below the high to form a big upper wick.
    final closePrice = close ?? (high * 0.97);
    final openPrice = open ?? (high * 0.975);
    final low = high * 0.95;
    return OhlcCandle(
      timestamp: timestamp,
      open: openPrice,
      high: high,
      low: low,
      close: closePrice,
      volume: 1000,
    );
  }

  /// Helper to create a candle with a bounce pattern at the low
  /// (significant lower wick relative to total range).
  OhlcCandle demandBounceCandle({
    required double low,
    required DateTime timestamp,
    double? open,
    double? close,
  }) {
    // Lower wick should be >= 30% of range.
    // range = high - low. lower wick = min(open, close) - low.
    // We'll set close well above the low to form a big lower wick.
    final closePrice = close ?? (low * 1.03);
    final openPrice = open ?? (low * 1.025);
    final high = low * 1.05;
    return OhlcCandle(
      timestamp: timestamp,
      open: openPrice,
      high: high,
      low: low,
      close: closePrice,
      volume: 1000,
    );
  }

  /// Helper to create a neutral candle (no significant wicks).
  /// Body fills most of the range, leaving tiny upper and lower wicks.
  OhlcCandle neutralCandle({
    required double price,
    required DateTime timestamp,
  }) {
    // Make a candle where the body is most of the range (open near low, close near high)
    // so neither wick is >= 30% of the range.
    final low = price * 0.99;
    final high = price * 1.01;
    final open = low + (high - low) * 0.15; // small lower wick (~15%)
    final close = high - (high - low) * 0.15; // small upper wick (~15%)
    return OhlcCandle(
      timestamp: timestamp,
      open: open,
      high: high,
      low: low,
      close: close,
      volume: 1000,
    );
  }

  group('ValuationsEngine', () {
    group('identifySupplyZones', () {
      test('returns empty list when fewer than 5 candles', () {
        final candles = List.generate(
          4,
          (i) => supplyRejectionCandle(
            high: 100.0,
            timestamp: DateTime(2024, 1, i + 1),
          ),
        );

        final zones = engine.identifySupplyZones(candles);
        expect(zones, isEmpty);
      });

      test('returns empty list when no rejection patterns found', () {
        // Candles with no significant upper wicks
        final candles = List.generate(
          10,
          (i) => neutralCandle(
            price: 100.0 + i,
            timestamp: DateTime(2024, 1, i + 1),
          ),
        );

        final zones = engine.identifySupplyZones(candles);
        expect(zones, isEmpty);
      });

      test('returns empty list when only 1 rejection at a level', () {
        final candles = <OhlcCandle>[
          supplyRejectionCandle(
            high: 100.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          ...List.generate(
            6,
            (i) => neutralCandle(
              price: 95.0,
              timestamp: DateTime(2024, 1, i + 2),
            ),
          ),
        ];

        final zones = engine.identifySupplyZones(candles);
        expect(zones, isEmpty);
      });

      test('identifies supply zone with 2 rejections at same level', () {
        final candles = <OhlcCandle>[
          supplyRejectionCandle(
            high: 100.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          neutralCandle(price: 95.0, timestamp: DateTime(2024, 1, 2)),
          neutralCandle(price: 96.0, timestamp: DateTime(2024, 1, 3)),
          supplyRejectionCandle(
            high: 100.2,
            timestamp: DateTime(2024, 1, 4),
          ),
          neutralCandle(price: 94.0, timestamp: DateTime(2024, 1, 5)),
        ];

        final zones = engine.identifySupplyZones(candles);
        expect(zones, hasLength(1));
        expect(zones.first.type, ZoneType.supply);
        expect(zones.first.touchCount, 2);
        expect(zones.first.upperBound, greaterThanOrEqualTo(100.0));
        expect(zones.first.lowerBound, lessThanOrEqualTo(100.2));
      });

      test('identifies supply zone with 3 rejections at similar level', () {
        final candles = <OhlcCandle>[
          supplyRejectionCandle(
            high: 100.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          neutralCandle(price: 95.0, timestamp: DateTime(2024, 1, 2)),
          supplyRejectionCandle(
            high: 100.3,
            timestamp: DateTime(2024, 1, 3),
          ),
          neutralCandle(price: 96.0, timestamp: DateTime(2024, 1, 4)),
          supplyRejectionCandle(
            high: 100.5,
            timestamp: DateTime(2024, 1, 5),
          ),
        ];

        final zones = engine.identifySupplyZones(candles);
        expect(zones, hasLength(1));
        expect(zones.first.touchCount, 3);
      });

      test('identifies multiple supply zones at different levels', () {
        final candles = <OhlcCandle>[
          supplyRejectionCandle(
            high: 100.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          supplyRejectionCandle(
            high: 100.2,
            timestamp: DateTime(2024, 1, 2),
          ),
          neutralCandle(price: 90.0, timestamp: DateTime(2024, 1, 3)),
          supplyRejectionCandle(
            high: 120.0,
            timestamp: DateTime(2024, 1, 4),
          ),
          supplyRejectionCandle(
            high: 120.4,
            timestamp: DateTime(2024, 1, 5),
          ),
        ];

        final zones = engine.identifySupplyZones(candles);
        expect(zones, hasLength(2));
      });

      test('firstIdentified is the earliest timestamp in cluster', () {
        final candles = <OhlcCandle>[
          supplyRejectionCandle(
            high: 100.0,
            timestamp: DateTime(2024, 1, 5),
          ),
          neutralCandle(price: 95.0, timestamp: DateTime(2024, 1, 6)),
          supplyRejectionCandle(
            high: 100.2,
            timestamp: DateTime(2024, 1, 1),
          ),
          neutralCandle(price: 94.0, timestamp: DateTime(2024, 1, 7)),
          neutralCandle(price: 93.0, timestamp: DateTime(2024, 1, 8)),
        ];

        final zones = engine.identifySupplyZones(candles);
        expect(zones, hasLength(1));
        expect(zones.first.firstIdentified, DateTime(2024, 1, 1));
      });
    });

    group('identifyDemandZones', () {
      test('returns empty list when fewer than 5 candles', () {
        final candles = List.generate(
          4,
          (i) => demandBounceCandle(
            low: 50.0,
            timestamp: DateTime(2024, 1, i + 1),
          ),
        );

        final zones = engine.identifyDemandZones(candles);
        expect(zones, isEmpty);
      });

      test('returns empty list when no bounce patterns found', () {
        final candles = List.generate(
          10,
          (i) => neutralCandle(
            price: 100.0 + i,
            timestamp: DateTime(2024, 1, i + 1),
          ),
        );

        final zones = engine.identifyDemandZones(candles);
        expect(zones, isEmpty);
      });

      test('returns empty list when only 1 bounce at a level', () {
        final candles = <OhlcCandle>[
          demandBounceCandle(
            low: 50.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          ...List.generate(
            6,
            (i) => neutralCandle(
              price: 55.0,
              timestamp: DateTime(2024, 1, i + 2),
            ),
          ),
        ];

        final zones = engine.identifyDemandZones(candles);
        expect(zones, isEmpty);
      });

      test('identifies demand zone with 2 bounces at same level', () {
        final candles = <OhlcCandle>[
          demandBounceCandle(
            low: 50.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          neutralCandle(price: 55.0, timestamp: DateTime(2024, 1, 2)),
          neutralCandle(price: 56.0, timestamp: DateTime(2024, 1, 3)),
          demandBounceCandle(
            low: 50.2,
            timestamp: DateTime(2024, 1, 4),
          ),
          neutralCandle(price: 54.0, timestamp: DateTime(2024, 1, 5)),
        ];

        final zones = engine.identifyDemandZones(candles);
        expect(zones, hasLength(1));
        expect(zones.first.type, ZoneType.demand);
        expect(zones.first.touchCount, 2);
        expect(zones.first.lowerBound, lessThanOrEqualTo(50.0));
        expect(zones.first.upperBound, greaterThanOrEqualTo(50.2));
      });

      test('identifies demand zone with 3 bounces at similar level', () {
        final candles = <OhlcCandle>[
          demandBounceCandle(
            low: 50.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          neutralCandle(price: 55.0, timestamp: DateTime(2024, 1, 2)),
          demandBounceCandle(
            low: 50.15,
            timestamp: DateTime(2024, 1, 3),
          ),
          neutralCandle(price: 56.0, timestamp: DateTime(2024, 1, 4)),
          demandBounceCandle(
            low: 50.3,
            timestamp: DateTime(2024, 1, 5),
          ),
        ];

        final zones = engine.identifyDemandZones(candles);
        expect(zones, hasLength(1));
        expect(zones.first.touchCount, 3);
      });

      test('identifies multiple demand zones at different levels', () {
        final candles = <OhlcCandle>[
          demandBounceCandle(
            low: 50.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          demandBounceCandle(
            low: 50.1,
            timestamp: DateTime(2024, 1, 2),
          ),
          neutralCandle(price: 60.0, timestamp: DateTime(2024, 1, 3)),
          demandBounceCandle(
            low: 30.0,
            timestamp: DateTime(2024, 1, 4),
          ),
          demandBounceCandle(
            low: 30.1,
            timestamp: DateTime(2024, 1, 5),
          ),
        ];

        final zones = engine.identifyDemandZones(candles);
        expect(zones, hasLength(2));
      });

      test('firstIdentified is the earliest timestamp in cluster', () {
        final candles = <OhlcCandle>[
          demandBounceCandle(
            low: 50.0,
            timestamp: DateTime(2024, 1, 10),
          ),
          neutralCandle(price: 55.0, timestamp: DateTime(2024, 1, 11)),
          demandBounceCandle(
            low: 50.2,
            timestamp: DateTime(2024, 1, 3),
          ),
          neutralCandle(price: 54.0, timestamp: DateTime(2024, 1, 12)),
          neutralCandle(price: 53.0, timestamp: DateTime(2024, 1, 13)),
        ];

        final zones = engine.identifyDemandZones(candles);
        expect(zones, hasLength(1));
        expect(zones.first.firstIdentified, DateTime(2024, 1, 3));
      });
    });

    group('edge cases', () {
      test('empty candle list returns empty zones for supply', () {
        expect(engine.identifySupplyZones([]), isEmpty);
      });

      test('empty candle list returns empty zones for demand', () {
        expect(engine.identifyDemandZones([]), isEmpty);
      });

      test('exactly 5 candles is sufficient for detection', () {
        final candles = <OhlcCandle>[
          supplyRejectionCandle(
            high: 100.0,
            timestamp: DateTime(2024, 1, 1),
          ),
          supplyRejectionCandle(
            high: 100.3,
            timestamp: DateTime(2024, 1, 2),
          ),
          neutralCandle(price: 95.0, timestamp: DateTime(2024, 1, 3)),
          neutralCandle(price: 94.0, timestamp: DateTime(2024, 1, 4)),
          neutralCandle(price: 93.0, timestamp: DateTime(2024, 1, 5)),
        ];

        final zones = engine.identifySupplyZones(candles);
        expect(zones, hasLength(1));
      });

      test('candles with zero range are skipped', () {
        final candles = <OhlcCandle>[
          // Zero-range candles (flat bars)
          OhlcCandle(
            timestamp: DateTime(2024, 1, 1),
            open: 100.0,
            high: 100.0,
            low: 100.0,
            close: 100.0,
            volume: 1000,
          ),
          OhlcCandle(
            timestamp: DateTime(2024, 1, 2),
            open: 100.0,
            high: 100.0,
            low: 100.0,
            close: 100.0,
            volume: 1000,
          ),
          neutralCandle(price: 95.0, timestamp: DateTime(2024, 1, 3)),
          neutralCandle(price: 94.0, timestamp: DateTime(2024, 1, 4)),
          neutralCandle(price: 93.0, timestamp: DateTime(2024, 1, 5)),
        ];

        final supplyZones = engine.identifySupplyZones(candles);
        final demandZones = engine.identifyDemandZones(candles);
        expect(supplyZones, isEmpty);
        expect(demandZones, isEmpty);
      });
    });

    group('calculateRewardRisk', () {
      test('calculates correct R:R for buy trade', () {
        // Buy: (target - entry) / (entry - stopLoss) = (150 - 100) / (100 - 90) = 50/10 = 5.0
        final rr = engine.calculateRewardRisk(
          direction: TradeDirection.buy,
          entryPrice: 100.0,
          targetPrice: 150.0,
          stopLossPrice: 90.0,
        );
        expect(rr.value, closeTo(5.0, 0.001));
      });

      test('calculates correct R:R for short trade', () {
        // Short: (entry - target) / (stopLoss - entry) = (100 - 80) / (110 - 100) = 20/10 = 2.0
        final rr = engine.calculateRewardRisk(
          direction: TradeDirection.short_,
          entryPrice: 100.0,
          targetPrice: 80.0,
          stopLossPrice: 110.0,
        );
        expect(rr.value, closeTo(2.0, 0.001));
      });

      test('throws ArgumentError when entry equals stopLoss', () {
        expect(
          () => engine.calculateRewardRisk(
            direction: TradeDirection.buy,
            entryPrice: 100.0,
            targetPrice: 150.0,
            stopLossPrice: 100.0,
          ),
          throwsA(isA<ArgumentError>()),
        );
      });

      test('calculates R:R of 1.0 for symmetric setup', () {
        // Buy: (target - entry) / (entry - stopLoss) = (110 - 100) / (100 - 90) = 10/10 = 1.0
        final rr = engine.calculateRewardRisk(
          direction: TradeDirection.buy,
          entryPrice: 100.0,
          targetPrice: 110.0,
          stopLossPrice: 90.0,
        );
        expect(rr.value, closeTo(1.0, 0.001));
      });

      test('formatted displays R:R with 2 decimal places', () {
        final rr = engine.calculateRewardRisk(
          direction: TradeDirection.buy,
          entryPrice: 100.0,
          targetPrice: 150.0,
          stopLossPrice: 90.0,
        );
        expect(rr.formatted, 'R:R 5.00');
      });
    });

    group('categorize', () {
      test('oneMin → dayTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.oneMin,
          ),
          TradeCategory.dayTrade,
        );
      });

      test('fiveMin → dayTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.fiveMin,
          ),
          TradeCategory.dayTrade,
        );
      });

      test('fifteenMin → dayTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.fifteenMin,
          ),
          TradeCategory.dayTrade,
        );
      });

      test('thirtyMin → dayTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.thirtyMin,
          ),
          TradeCategory.dayTrade,
        );
      });

      test('oneHour → dayTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.oneHour,
          ),
          TradeCategory.dayTrade,
        );
      });

      test('fourHour → dayTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.fourHour,
          ),
          TradeCategory.dayTrade,
        );
      });

      test('eightHour → dayTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.eightHour,
          ),
          TradeCategory.dayTrade,
        );
      });

      test('twelveHour → dayTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.twelveHour,
          ),
          TradeCategory.dayTrade,
        );
      });

      test('twentyFourHour → swingTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.twentyFourHour,
          ),
          TradeCategory.swingTrade,
        );
      });

      test('oneWeek → swingTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.oneWeek,
          ),
          TradeCategory.swingTrade,
        );
      });

      test('oneMonth → positionTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.oneMonth,
          ),
          TradeCategory.positionTrade,
        );
      });

      test('oneQuarter → positionTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.oneQuarter,
          ),
          TradeCategory.positionTrade,
        );
      });

      test('oneYear → positionTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.oneYear,
          ),
          TradeCategory.positionTrade,
        );
      });

      test('allTime → positionTrade', () {
        expect(
          engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: TimeDuration.allTime,
          ),
          TradeCategory.positionTrade,
        );
      });
    });

    group('isCompleted', () {
      test('buy is completed when price reaches target', () {
        final rec = Recommendation(
          symbol: 'AAPL',
          assetName: 'Apple',
          direction: TradeDirection.buy,
          category: TradeCategory.dayTrade,
          entryPrice: 100.0,
          targetPrice: 110.0,
          stopLossPrice: 95.0,
          rewardRisk: const RewardRiskRatio(2.0),
          generatedAt: DateTime(2024, 1, 1),
          status: RecommendationStatus.active,
        );

        expect(engine.isCompleted(rec, 110.0), isTrue);
        expect(engine.isCompleted(rec, 115.0), isTrue);
      });

      test('buy is completed when price hits stop loss', () {
        final rec = Recommendation(
          symbol: 'AAPL',
          assetName: 'Apple',
          direction: TradeDirection.buy,
          category: TradeCategory.dayTrade,
          entryPrice: 100.0,
          targetPrice: 110.0,
          stopLossPrice: 95.0,
          rewardRisk: const RewardRiskRatio(2.0),
          generatedAt: DateTime(2024, 1, 1),
          status: RecommendationStatus.active,
        );

        expect(engine.isCompleted(rec, 95.0), isTrue);
        expect(engine.isCompleted(rec, 90.0), isTrue);
      });

      test('buy is NOT completed when price is between stop and target', () {
        final rec = Recommendation(
          symbol: 'AAPL',
          assetName: 'Apple',
          direction: TradeDirection.buy,
          category: TradeCategory.dayTrade,
          entryPrice: 100.0,
          targetPrice: 110.0,
          stopLossPrice: 95.0,
          rewardRisk: const RewardRiskRatio(2.0),
          generatedAt: DateTime(2024, 1, 1),
          status: RecommendationStatus.active,
        );

        expect(engine.isCompleted(rec, 100.0), isFalse);
        expect(engine.isCompleted(rec, 105.0), isFalse);
        expect(engine.isCompleted(rec, 95.01), isFalse);
      });

      test('short is completed when price reaches target', () {
        final rec = Recommendation(
          symbol: 'AAPL',
          assetName: 'Apple',
          direction: TradeDirection.short_,
          category: TradeCategory.dayTrade,
          entryPrice: 100.0,
          targetPrice: 90.0,
          stopLossPrice: 105.0,
          rewardRisk: const RewardRiskRatio(2.0),
          generatedAt: DateTime(2024, 1, 1),
          status: RecommendationStatus.active,
        );

        expect(engine.isCompleted(rec, 90.0), isTrue);
        expect(engine.isCompleted(rec, 85.0), isTrue);
      });

      test('short is completed when price hits stop loss', () {
        final rec = Recommendation(
          symbol: 'AAPL',
          assetName: 'Apple',
          direction: TradeDirection.short_,
          category: TradeCategory.dayTrade,
          entryPrice: 100.0,
          targetPrice: 90.0,
          stopLossPrice: 105.0,
          rewardRisk: const RewardRiskRatio(2.0),
          generatedAt: DateTime(2024, 1, 1),
          status: RecommendationStatus.active,
        );

        expect(engine.isCompleted(rec, 105.0), isTrue);
        expect(engine.isCompleted(rec, 110.0), isTrue);
      });

      test('short is NOT completed when price is between stop and target', () {
        final rec = Recommendation(
          symbol: 'AAPL',
          assetName: 'Apple',
          direction: TradeDirection.short_,
          category: TradeCategory.dayTrade,
          entryPrice: 100.0,
          targetPrice: 90.0,
          stopLossPrice: 105.0,
          rewardRisk: const RewardRiskRatio(2.0),
          generatedAt: DateTime(2024, 1, 1),
          status: RecommendationStatus.active,
        );

        expect(engine.isCompleted(rec, 100.0), isFalse);
        expect(engine.isCompleted(rec, 95.0), isFalse);
        expect(engine.isCompleted(rec, 104.99), isFalse);
      });
    });

    group('generateRecommendations', () {
      test('generates buy when price is within 1% of demand zone upperBound', () {
        final demandZones = [
          PriceZone(
            upperBound: 100.0,
            lowerBound: 95.0,
            type: ZoneType.demand,
            touchCount: 3,
            firstIdentified: DateTime(2024, 1, 1),
          ),
        ];

        // Current price at 100.5, which is within 1% of upperBound (100.0)
        // distance = 0.5, threshold = 100.0 * 0.01 = 1.0
        // entry=100.5, stopLoss=95.0, target=100.5 + (100-95)= 105.5
        // R:R buy = (105.5-100.5)/(100.5-95.0) = 5.0/5.5 ≈ 0.909 → NOT > 1.0
        // Let's use a price that gives R:R > 1.0
        // entry=99.5 → distance=0.5 ≤ 1.0, stopLoss=95.0, target=99.5+5=104.5
        // R:R = (104.5-99.5)/(99.5-95.0) = 5.0/4.5 ≈ 1.11 → > 1.0 ✓
        final recs = engine.generateRecommendations(
          symbol: 'AAPL',
          currentPrice: 99.5,
          supplyZones: [],
          demandZones: demandZones,
        );

        expect(recs, hasLength(1));
        expect(recs.first.direction, TradeDirection.buy);
        expect(recs.first.entryPrice, 99.5);
        expect(recs.first.stopLossPrice, 95.0);
        expect(recs.first.targetPrice, 104.5);
        expect(recs.first.rewardRisk.value, greaterThan(1.0));
      });

      test('generates short when price is within 1% of supply zone lowerBound', () {
        final supplyZones = [
          PriceZone(
            upperBound: 110.0,
            lowerBound: 105.0,
            type: ZoneType.supply,
            touchCount: 2,
            firstIdentified: DateTime(2024, 1, 1),
          ),
        ];

        // Current price at 105.5, within 1% of lowerBound (105.0)
        // distance=0.5, threshold=105.0*0.01=1.05
        // entry=105.5, stopLoss=110.0, target=105.5-(110-105)=100.5
        // R:R short = (105.5-100.5)/(110.0-105.5) = 5.0/4.5 ≈ 1.11 → > 1.0 ✓
        final recs = engine.generateRecommendations(
          symbol: 'AAPL',
          currentPrice: 105.5,
          supplyZones: supplyZones,
          demandZones: [],
        );

        expect(recs, hasLength(1));
        expect(recs.first.direction, TradeDirection.short_);
        expect(recs.first.entryPrice, 105.5);
        expect(recs.first.stopLossPrice, 110.0);
        expect(recs.first.targetPrice, 100.5);
        expect(recs.first.rewardRisk.value, greaterThan(1.0));
      });

      test('does not generate recommendation when R:R <= 1.0', () {
        final demandZones = [
          PriceZone(
            upperBound: 100.0,
            lowerBound: 95.0,
            type: ZoneType.demand,
            touchCount: 2,
            firstIdentified: DateTime(2024, 1, 1),
          ),
        ];

        // entry=100.5 (within 1% of 100.0), stopLoss=95.0, target=100.5+5=105.5
        // R:R = (105.5-100.5)/(100.5-95.0) = 5.0/5.5 = 0.909 → NOT > 1.0
        final recs = engine.generateRecommendations(
          symbol: 'AAPL',
          currentPrice: 100.5,
          supplyZones: [],
          demandZones: demandZones,
        );

        expect(recs, isEmpty);
      });

      test('does not generate recommendation when price is too far from zone', () {
        final demandZones = [
          PriceZone(
            upperBound: 100.0,
            lowerBound: 95.0,
            type: ZoneType.demand,
            touchCount: 2,
            firstIdentified: DateTime(2024, 1, 1),
          ),
        ];

        // Price at 105.0 → distance = 5.0, threshold = 1.0 → too far
        final recs = engine.generateRecommendations(
          symbol: 'AAPL',
          currentPrice: 105.0,
          supplyZones: [],
          demandZones: demandZones,
        );

        expect(recs, isEmpty);
      });

      test('results are sorted by R:R descending', () {
        final demandZones = [
          PriceZone(
            upperBound: 100.0,
            lowerBound: 90.0, // wide zone → high R:R
            type: ZoneType.demand,
            touchCount: 2,
            firstIdentified: DateTime(2024, 1, 1),
          ),
          PriceZone(
            upperBound: 100.0,
            lowerBound: 95.0, // narrow zone → lower R:R
            type: ZoneType.demand,
            touchCount: 2,
            firstIdentified: DateTime(2024, 1, 2),
          ),
        ];

        // Price at 99.5, within 1% of both zones' upperBound (100.0)
        // Zone 1: entry=99.5, stop=90.0, target=99.5+10=109.5
        //   R:R = (109.5-99.5)/(99.5-90.0) = 10.0/9.5 ≈ 1.053
        // Zone 2: entry=99.5, stop=95.0, target=99.5+5=104.5
        //   R:R = (104.5-99.5)/(99.5-95.0) = 5.0/4.5 ≈ 1.111
        final recs = engine.generateRecommendations(
          symbol: 'AAPL',
          currentPrice: 99.5,
          supplyZones: [],
          demandZones: demandZones,
        );

        expect(recs, hasLength(2));
        expect(recs.first.rewardRisk.value,
            greaterThanOrEqualTo(recs.last.rewardRisk.value));
      });

      test('returns empty list when no zones provided', () {
        final recs = engine.generateRecommendations(
          symbol: 'AAPL',
          currentPrice: 100.0,
          supplyZones: [],
          demandZones: [],
        );

        expect(recs, isEmpty);
      });

      test('filters recommendations with negative target for shorts', () {
        final supplyZones = [
          PriceZone(
            upperBound: 200.0,
            lowerBound: 5.0,
            type: ZoneType.supply,
            touchCount: 2,
            firstIdentified: DateTime(2024, 1, 1),
          ),
        ];

        // entry=5.0 (within 1% of lowerBound 5.0)
        // target = 5.0 - (200.0 - 5.0) = 5.0 - 195.0 = -190.0 → negative, filtered
        final recs = engine.generateRecommendations(
          symbol: 'AAPL',
          currentPrice: 5.0,
          supplyZones: supplyZones,
          demandZones: [],
        );

        expect(recs, isEmpty);
      });
    });
  });
}
