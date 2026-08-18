import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';

import 'package:rally/presentation/widgets/market_data/percentage_display_helper.dart';

/// Feature: live-market-data
/// Property-based tests for price ticker formatting correctness
///
/// Property 5: Price ticker formatting correctness
/// "For any valid AssetPrice, the formatted price ticker output contains:
/// the asset symbol, the price formatted to exactly 2 decimal places, and
/// the percentage change formatted to exactly 2 decimal places followed by
/// a percent sign. When percentage change is positive, a plus sign prefix
/// and upward indicator are present. When negative, a minus sign prefix and
/// downward indicator are present. When zero, no directional sign is present."
///
/// **Validates: Requirements 3.1, 3.2, 3.3**
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group(
      'Feature: live-market-data, '
      'Property 5: Price ticker formatting correctness', () {
    // **Validates: Requirements 3.1, 3.2, 3.3**

    property(
        'positive percentage change: formatted string starts with +, ends with %, has 2 decimal places',
        () {
      // Generate random positive double values for percentageChange
      final positiveChangeArb = float(
        min: double.minPositive,
        max: 9999.99,
      ).filter((v) => v > 0);

      forAll(
        positiveChangeArb,
        (percentageChange) {
          final formatted = formatPercentageChange(percentageChange);

          // Must start with '+'
          expect(formatted.startsWith('+'), isTrue,
              reason:
                  'Positive change $percentageChange should format with + prefix, '
                  'got "$formatted"');

          // Must end with '%'
          expect(formatted.endsWith('%'), isTrue,
              reason:
                  'Formatted change should end with %, got "$formatted"');

          // Must have exactly 2 decimal places
          // Extract numeric part (remove + prefix and % suffix)
          final numericPart = formatted.substring(1, formatted.length - 1);
          final decimalIndex = numericPart.indexOf('.');
          expect(decimalIndex, isNot(-1),
              reason: 'Formatted value should contain a decimal point');
          final decimalPlaces = numericPart.length - decimalIndex - 1;
          expect(decimalPlaces, equals(2),
              reason:
                  'Should have exactly 2 decimal places, '
                  'got $decimalPlaces in "$formatted"');
        },
        maxExamples: 100,
      );
    });

    property(
        'negative percentage change: formatted string starts with -, ends with %, has 2 decimal places',
        () {
      // Generate random negative double values for percentageChange
      final negativeChangeArb = float(
        min: -9999.99,
        max: -double.minPositive,
      ).filter((v) => v < 0);

      forAll(
        negativeChangeArb,
        (percentageChange) {
          final formatted = formatPercentageChange(percentageChange);

          // Must start with '-'
          expect(formatted.startsWith('-'), isTrue,
              reason:
                  'Negative change $percentageChange should format with - prefix, '
                  'got "$formatted"');

          // Must end with '%'
          expect(formatted.endsWith('%'), isTrue,
              reason:
                  'Formatted change should end with %, got "$formatted"');

          // Must have exactly 2 decimal places
          // Extract numeric part (remove - prefix and % suffix)
          final numericPart = formatted.substring(1, formatted.length - 1);
          final decimalIndex = numericPart.indexOf('.');
          expect(decimalIndex, isNot(-1),
              reason: 'Formatted value should contain a decimal point');
          final decimalPlaces = numericPart.length - decimalIndex - 1;
          expect(decimalPlaces, equals(2),
              reason:
                  'Should have exactly 2 decimal places, '
                  'got $decimalPlaces in "$formatted"');
        },
        maxExamples: 100,
      );
    });

    property(
        'zero percentage change: formatted string is "0.00%" with no prefix',
        () {
      // Zero is a single value, but we test it as a property for completeness
      forAll(
        constant(0.0),
        (percentageChange) {
          final formatted = formatPercentageChange(percentageChange);

          // Must be exactly '0.00%' with no prefix
          expect(formatted, equals('0.00%'),
              reason:
                  'Zero change should format as "0.00%", got "$formatted"');

          // Must not start with '+' or '-'
          expect(formatted.startsWith('+'), isFalse,
              reason: 'Zero change should have no + prefix');
          expect(formatted.startsWith('-'), isFalse,
              reason: 'Zero change should have no - prefix');
        },
        maxExamples: 100,
      );
    });

    property(
        'positive percentage change: getTickerPercentageDisplay returns arrow_upward icon and + prefix',
        () {
      final positiveChangeArb = float(
        min: double.minPositive,
        max: 9999.99,
      ).filter((v) => v > 0);

      forAll(
        positiveChangeArb,
        (percentageChange) {
          final display = getTickerPercentageDisplay(percentageChange);

          // Icon should be arrow_upward for positive values
          expect(display.icon, equals(Icons.arrow_upward),
              reason:
                  'Positive change $percentageChange should show arrow_upward icon');

          // Prefix should be '+'
          expect(display.prefix, equals('+'),
              reason:
                  'Positive change $percentageChange should have + prefix');
        },
        maxExamples: 100,
      );
    });

    property(
        'negative percentage change: getTickerPercentageDisplay returns arrow_downward icon',
        () {
      final negativeChangeArb = float(
        min: -9999.99,
        max: -double.minPositive,
      ).filter((v) => v < 0);

      forAll(
        negativeChangeArb,
        (percentageChange) {
          final display = getTickerPercentageDisplay(percentageChange);

          // Icon should be arrow_downward for negative values
          expect(display.icon, equals(Icons.arrow_downward),
              reason:
                  'Negative change $percentageChange should show arrow_downward icon');

          // Prefix should be empty (the minus comes from the value itself)
          expect(display.prefix, equals(''),
              reason:
                  'Negative change should have empty prefix (minus is in value)');
        },
        maxExamples: 100,
      );
    });

    property(
        'zero percentage change: getTickerPercentageDisplay returns null icon and empty prefix',
        () {
      forAll(
        constant(0.0),
        (percentageChange) {
          final display = getTickerPercentageDisplay(percentageChange);

          // Icon should be null for zero
          expect(display.icon, isNull,
              reason: 'Zero change should have null icon');

          // Prefix should be empty
          expect(display.prefix, equals(''),
              reason: 'Zero change should have empty prefix');
        },
        maxExamples: 100,
      );
    });
  });
}
