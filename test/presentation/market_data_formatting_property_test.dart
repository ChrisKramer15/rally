import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';

import 'package:rally/presentation/widgets/market_data/percentage_display_helper.dart';
import 'package:rally/presentation/widgets/market_data/volume_formatter.dart';

/// Feature: market-data-display
/// Property-based tests for market data formatting
///
/// Property 1: Volume formatting uses correct suffix based on magnitude
/// "For any non-negative volume value, the formatted output SHALL end with "B"
/// if volume >= 1,000,000,000; end with "M" if volume in [1,000,000, 1,000,000,000);
/// end with "K" if volume in [1,000, 1,000,000); or be a plain decimal with 2
/// decimal places if volume < 1,000."
///
/// **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
///
/// Property 2: Percentage change display uses correct direction and color
/// "For any percentage change value, the display SHALL show an up-arrow icon
/// and green color when the value is non-negative, and a down-arrow icon and
/// red color when the value is negative."
///
/// **Validates: Requirements 2.3, 2.4**
void main() {
  group(
      'Feature: market-data-display, '
      'Property 1: Volume formatting uses correct suffix based on magnitude',
      () {
    // **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

    property(
        'volumes >= 1,000,000,000 are formatted with "B" suffix and correct numeric value',
        () {
      // Generate random volumes in the billions range [1B, 999B]
      final billionVolumeArb =
          integer(min: 100000000000, max: 99900000000000).map((i) => i / 100.0);

      forAll(
        billionVolumeArb,
        (volume) {
          final result = formatVolume(volume);

          // Must end with 'B'
          expect(result.endsWith('B'), isTrue,
              reason:
                  'Volume $volume should be formatted with "B" suffix, got: $result');

          // Verify numeric part matches expected value
          final numericPart = result.substring(0, result.length - 1);
          final expected = (volume / 1000000000).toStringAsFixed(2);
          expect(numericPart, equals(expected),
              reason:
                  'Numeric part for volume $volume should be $expected, got: $numericPart');
        },
        maxExamples: 100,
      );
    });

    property(
        'volumes >= 1,000,000 and < 1,000,000,000 are formatted with "M" suffix and correct numeric value',
        () {
      // Generate random volumes in the millions range [1M, 999.99M]
      final millionVolumeArb =
          integer(min: 100000000, max: 99999999999).map((i) => i / 100.0);

      forAll(
        millionVolumeArb,
        (volume) {
          final result = formatVolume(volume);

          // Must end with 'M'
          expect(result.endsWith('M'), isTrue,
              reason:
                  'Volume $volume should be formatted with "M" suffix, got: $result');

          // Verify numeric part matches expected value
          final numericPart = result.substring(0, result.length - 1);
          final expected = (volume / 1000000).toStringAsFixed(2);
          expect(numericPart, equals(expected),
              reason:
                  'Numeric part for volume $volume should be $expected, got: $numericPart');
        },
        maxExamples: 100,
      );
    });

    property(
        'volumes >= 1,000 and < 1,000,000 are formatted with "K" suffix and correct numeric value',
        () {
      // Generate random volumes in the thousands range [1K, 999.99K]
      final thousandVolumeArb =
          integer(min: 100000, max: 99999999).map((i) => i / 100.0);

      forAll(
        thousandVolumeArb,
        (volume) {
          final result = formatVolume(volume);

          // Must end with 'K'
          expect(result.endsWith('K'), isTrue,
              reason:
                  'Volume $volume should be formatted with "K" suffix, got: $result');

          // Verify numeric part matches expected value
          final numericPart = result.substring(0, result.length - 1);
          final expected = (volume / 1000).toStringAsFixed(2);
          expect(numericPart, equals(expected),
              reason:
                  'Numeric part for volume $volume should be $expected, got: $numericPart');
        },
        maxExamples: 100,
      );
    });

    property(
        'volumes < 1,000 are formatted as plain decimal with 2 decimal places (no suffix)',
        () {
      // Generate random volumes in range [0, 999.99]
      final smallVolumeArb =
          integer(min: 0, max: 99999).map((i) => i / 100.0);

      forAll(
        smallVolumeArb,
        (volume) {
          final result = formatVolume(volume);

          // Must NOT end with any suffix
          expect(result.endsWith('B'), isFalse,
              reason: 'Volume $volume should not have "B" suffix, got: $result');
          expect(result.endsWith('M'), isFalse,
              reason: 'Volume $volume should not have "M" suffix, got: $result');
          expect(result.endsWith('K'), isFalse,
              reason: 'Volume $volume should not have "K" suffix, got: $result');

          // Must be a valid decimal with exactly 2 decimal places
          final expected = volume.toStringAsFixed(2);
          expect(result, equals(expected),
              reason:
                  'Volume $volume should be formatted as $expected, got: $result');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: market-data-display, '
      'Property 2: Percentage change display uses correct direction and color',
      () {
    // **Validates: Requirements 2.3, 2.4**

    property(
        'non-negative percentage changes display up-arrow icon and green color',
        () {
      // Generate random non-negative percentages in [0, +1000]
      final nonNegativePercentageArb =
          integer(min: 0, max: 100000).map((i) => i / 100.0);

      forAll(
        nonNegativePercentageArb,
        (percentage) {
          final result = getPercentageDisplay(percentage);

          expect(result.icon, equals(Icons.arrow_upward),
              reason:
                  'Percentage $percentage (non-negative) should show up-arrow icon');
          expect(result.color, equals(Colors.greenAccent),
              reason:
                  'Percentage $percentage (non-negative) should use green color');
        },
        maxExamples: 100,
      );
    });

    property(
        'negative percentage changes display down-arrow icon and red color',
        () {
      // Generate random negative percentages in [-100, -0.01]
      final negativePercentageArb =
          integer(min: 1, max: 10000).map((i) => -i / 100.0);

      forAll(
        negativePercentageArb,
        (percentage) {
          final result = getPercentageDisplay(percentage);

          expect(result.icon, equals(Icons.arrow_downward),
              reason:
                  'Percentage $percentage (negative) should show down-arrow icon');
          expect(result.color, equals(Colors.redAccent),
              reason:
                  'Percentage $percentage (negative) should use red color');
        },
        maxExamples: 100,
      );
    });

    property(
        'zero percentage change displays up-arrow icon and green color (boundary)',
        () {
      final result = getPercentageDisplay(0.0);

      expect(result.icon, equals(Icons.arrow_upward),
          reason: 'Percentage 0.0 (non-negative) should show up-arrow icon');
      expect(result.color, equals(Colors.greenAccent),
          reason: 'Percentage 0.0 (non-negative) should use green color');
    });
  });
}
