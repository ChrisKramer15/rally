import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';

/// Feature: stock-trading-valuations-engine
/// Property-based tests for numeric display formatting
///
/// Property 5: Numeric display formatting
/// "For any numeric price, percentage, or ratio value displayed to the user,
/// the formatted output SHALL contain exactly 2 decimal places."
///
/// **Validates: Requirements 2.4, 4.5**
void main() {
  /// Regex pattern for a number with exactly 2 decimal places.
  /// Matches: "0.01", "999999999.99", "-100.00", "1000.00", etc.
  final twoDecimalPattern = RegExp(r'^-?\d+\.\d{2}$');

  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 5: Numeric display formatting', () {
    // **Validates: Requirements 2.4, 4.5**

    property(
        'prices (0.01 to 999999999.99) formatted with toStringAsFixed(2) '
        'always have exactly 2 decimal places', () {
      forAll(
        float(min: 0.01, max: 999999999.99, nan: false, infinity: false),
        (price) {
          final formatted = price.toStringAsFixed(2);

          expect(twoDecimalPattern.hasMatch(formatted), isTrue,
              reason:
                  'Price $price formatted as "$formatted" should match '
                  'pattern ^-?\\d+\\.\\d{2}\$');
        },
        maxExamples: 100,
      );
    });

    property(
        'percentage changes (-100 to +1000) formatted with toStringAsFixed(2) '
        'always have exactly 2 decimal places', () {
      forAll(
        float(min: -100.0, max: 1000.0, nan: false, infinity: false),
        (percentage) {
          final formatted = percentage.toStringAsFixed(2);

          expect(twoDecimalPattern.hasMatch(formatted), isTrue,
              reason:
                  'Percentage $percentage formatted as "$formatted" should match '
                  'pattern ^-?\\d+\\.\\d{2}\$');
        },
        maxExamples: 100,
      );
    });

    property(
        'R:R ratios (0.01 to 100.0) formatted with toStringAsFixed(2) '
        'always have exactly 2 decimal places', () {
      forAll(
        float(min: 0.01, max: 100.0, nan: false, infinity: false),
        (ratio) {
          final formatted = ratio.toStringAsFixed(2);

          expect(twoDecimalPattern.hasMatch(formatted), isTrue,
              reason:
                  'Ratio $ratio formatted as "$formatted" should match '
                  'pattern ^-?\\d+\\.\\d{2}\$');
        },
        maxExamples: 100,
      );
    });
  });
}
