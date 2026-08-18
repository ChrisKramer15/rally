import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/price_zone.dart';
import 'package:rally/domain/services/valuations_engine.dart';

/// Feature: stock-trading-valuations-engine
/// Property-based tests for ValuationsEngine
void main() {
  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 6: Trade category assignment', () {
    // **Validates: Requirements 3.2**
    //
    // For any prediction with a target hold duration, the Valuations_Engine
    // SHALL assign exactly one TradeCategory: day trade if duration < 24 hours,
    // swing trade if duration is between 1 day and 2 weeks inclusive, or
    // position trade if duration > 2 weeks.

    property(
        'categorize assigns exactly one TradeCategory based on TimeDuration',
        () {
      forAll(
        // Generate a random integer index mapped to TimeDuration.values
        integer(min: 0, max: TimeDuration.values.length - 1),
        (index) {
          final engine = ValuationsEngine();
          final duration = TimeDuration.values[index];

          final category = engine.categorize(
            entryPrice: 100.0,
            targetPrice: 110.0,
            timeframe: duration,
          );

          // Verify exactly one category is assigned (non-null return from switch)
          expect(category, isA<TradeCategory>());

          // Verify correct mapping based on duration
          switch (duration) {
            // Duration < 24 hours → dayTrade
            case TimeDuration.oneMin:
            case TimeDuration.fiveMin:
            case TimeDuration.fifteenMin:
            case TimeDuration.thirtyMin:
            case TimeDuration.oneHour:
            case TimeDuration.fourHour:
            case TimeDuration.eightHour:
            case TimeDuration.twelveHour:
              expect(category, equals(TradeCategory.dayTrade),
                  reason:
                      '$duration (< 24 hours) should map to dayTrade, got $category');
              break;
            // Duration between 1 day and 2 weeks inclusive → swingTrade
            case TimeDuration.twentyFourHour:
            case TimeDuration.oneWeek:
              expect(category, equals(TradeCategory.swingTrade),
                  reason:
                      '$duration (1 day to 2 weeks) should map to swingTrade, got $category');
              break;
            // Duration > 2 weeks → positionTrade
            case TimeDuration.oneMonth:
            case TimeDuration.oneQuarter:
            case TimeDuration.oneYear:
            case TimeDuration.allTime:
              expect(category, equals(TradeCategory.positionTrade),
                  reason:
                      '$duration (> 2 weeks) should map to positionTrade, got $category');
              break;
          }
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 8: Recommendations sorted by R:R descending', () {
    // **Validates: Requirements 3.4**
    //
    // For any list of active recommendations, the displayed order SHALL have
    // each recommendation's Reward_Risk_Ratio greater than or equal to the
    // next recommendation's Reward_Risk_Ratio.

    property(
        'generateRecommendations returns results sorted by rewardRisk.value descending',
        () {
      forAll(
        combine3(
          // Number of demand zones to generate (2 to 6) – want multiple zones
          integer(min: 2, max: 6),
          // Base price level for zone upper bounds (50 to 500)
          // All zones share a similar upperBound so one currentPrice is within 1% of each
          integer(min: 50, max: 500),
          // Seed for varying zone heights (produces different R:R ratios)
          integer(min: 1, max: 10000),
        ),
        (values) {
          final numZones = values.$1;
          final basePriceInt = values.$2;
          final seed = values.$3;

          final engine = ValuationsEngine();

          // All zones share the same upperBound so a single currentPrice
          // can be within 1% of each zone's upperBound
          final upperBound = basePriceInt.toDouble();

          // Generate demand zones with varying lowerBounds (different zone heights)
          // Zone height determines R:R: target = entry + height, stop = lowerBound
          // R:R = (target - entry) / (entry - stop) = height / (entry - lowerBound)
          // Since entry ≈ upperBound, R:R ≈ height / (upperBound - lowerBound) = 1.0
          // Actually: entry = currentPrice, target = entry + height,
          //   stop = lowerBound, R:R = height / (entry - lowerBound)
          // With varying lowerBounds we get varying R:R ratios.
          final demandZones = List.generate(numZones, (i) {
            // Zone height varies: use seed to generate different heights
            // Ensure lowerBound < upperBound and produces R:R > 1.0
            // Height between 2 and 50 (varied by seed and index)
            final height = ((seed * (i + 1)) % 48).toDouble() + 2.0;
            final lowerBound = upperBound - height;

            return PriceZone(
              upperBound: upperBound,
              lowerBound: lowerBound,
              type: ZoneType.demand,
              touchCount: 2,
              firstIdentified: DateTime(2024, 1, 1),
            );
          });

          // Choose currentPrice within 1% of the zones' upperBound.
          // Distance must be <= upperBound * 0.01.
          // Use a price slightly below or at the upperBound.
          final currentPrice = upperBound - (upperBound * 0.005);

          final recommendations = engine.generateRecommendations(
            symbol: 'TEST',
            currentPrice: currentPrice,
            supplyZones: [],
            demandZones: demandZones,
          );

          // Only verify sort order when we have 2+ recommendations
          if (recommendations.length >= 2) {
            for (var i = 0; i < recommendations.length - 1; i++) {
              expect(
                recommendations[i].rewardRisk.value,
                greaterThanOrEqualTo(recommendations[i + 1].rewardRisk.value),
                reason:
                    'Recommendation at index $i (R:R=${recommendations[i].rewardRisk.value}) '
                    'should be >= recommendation at index ${i + 1} '
                    '(R:R=${recommendations[i + 1].rewardRisk.value})',
              );
            }
          }
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 13: Incomplete recommendation filtering', () {
    // **Validates: Requirements 4.7**
    //
    // For any recommendation with a missing entry price, stop loss price, or
    // target price, the recommendation SHALL NOT be included in the displayed
    // recommendations list.

    property(
        'generateRecommendations never outputs recommendations with '
        'zero or negative entry, stopLoss, or targetPrice', () {
      forAll(
        combine4(
          // currentPrice: can be any positive or zero/negative value
          float(min: -100.0, max: 500.0),
          // Number of demand zones to generate (0 to 5)
          integer(min: 0, max: 5),
          // Number of supply zones to generate (0 to 5)
          integer(min: 0, max: 5),
          // Seed for zone parameter generation (used to vary zone bounds)
          integer(min: 1, max: 10000),
        ),
        (values) {
          final currentPrice = values.$1;
          final numDemandZones = values.$2;
          final numSupplyZones = values.$3;
          final seed = values.$4;

          final engine = ValuationsEngine();

          // Generate random demand zones with varying parameters
          // Some may have very low bounds (near zero or negative) to stress-test
          final demandZones = List.generate(numDemandZones, (i) {
            // Use seed and index to create varied zone bounds
            final baseLower = (seed * (i + 1) % 200).toDouble() - 50.0;
            final zoneHeight = ((seed * (i + 3)) % 50).toDouble() + 1.0;
            return PriceZone(
              lowerBound: baseLower,
              upperBound: baseLower + zoneHeight,
              type: ZoneType.demand,
              touchCount: 2,
              firstIdentified: DateTime(2024, 1, 1),
            );
          });

          // Generate random supply zones with varying parameters
          final supplyZones = List.generate(numSupplyZones, (i) {
            final baseLower = (seed * (i + 2) % 300).toDouble() - 30.0;
            final zoneHeight = ((seed * (i + 4)) % 60).toDouble() + 1.0;
            return PriceZone(
              lowerBound: baseLower,
              upperBound: baseLower + zoneHeight,
              type: ZoneType.supply,
              touchCount: 2,
              firstIdentified: DateTime(2024, 1, 1),
            );
          });

          final recommendations = engine.generateRecommendations(
            symbol: 'TEST',
            currentPrice: currentPrice,
            supplyZones: supplyZones,
            demandZones: demandZones,
          );

          // Assert: every recommendation in the output has all three prices positive
          for (final rec in recommendations) {
            expect(rec.entryPrice, greaterThan(0),
                reason:
                    'Entry price must be > 0, got ${rec.entryPrice} '
                    '(currentPrice=$currentPrice)');
            expect(rec.stopLossPrice, greaterThan(0),
                reason:
                    'Stop loss price must be > 0, got ${rec.stopLossPrice} '
                    '(currentPrice=$currentPrice)');
            expect(rec.targetPrice, greaterThan(0),
                reason:
                    'Target price must be > 0, got ${rec.targetPrice} '
                    '(currentPrice=$currentPrice)');
          }
        },
        maxExamples: 100,
      );
    });
  });
}
