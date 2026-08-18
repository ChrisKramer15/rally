import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:rally/domain/models/reward_risk_ratio.dart';

/// Feature: stock-trading-valuations-engine
/// Property-based tests for R:R display format
void main() {
  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 12: R:R display format', () {
    // **Validates: Requirements 4.3**
    //
    // For any Reward_Risk_Ratio value V, the formatted display string SHALL
    // match the pattern "R:R X.XX" where X.XX is V rounded to 2 decimal places.

    final rrPattern = RegExp(r'^R:R \d+\.\d{2}$');

    property(
        'formatted output matches pattern "R:R X.XX" for any positive ratio value',
        () {
      forAll(
        // Generate random positive doubles in the range 0.01 to 100.0
        integer(min: 1, max: 10000).map((i) => i / 100.0),
        (value) {
          final ratio = RewardRiskRatio(value);
          final formatted = ratio.formatted;

          // Verify the formatted string matches the expected pattern
          expect(formatted, matches(rrPattern),
              reason:
                  'R:R formatted output "$formatted" for value $value should match pattern "R:R X.XX"');

          // Verify the numeric part equals the value rounded to 2 decimal places
          final expectedStr = 'R:R ${value.toStringAsFixed(2)}';
          expect(formatted, equals(expectedStr),
              reason:
                  'R:R formatted output "$formatted" should equal "$expectedStr" for value $value');
        },
        maxExamples: 100,
      );
    });

    property(
        'formatted output matches pattern "R:R X.XX" for values with many decimal places',
        () {
      forAll(
        // Generate values with many decimal places to test rounding
        integer(min: 1, max: 9999999).map((i) => i / 100000.0),
        (value) {
          final ratio = RewardRiskRatio(value);
          final formatted = ratio.formatted;

          // Verify the formatted string matches the expected pattern
          expect(formatted, matches(rrPattern),
              reason:
                  'R:R formatted output "$formatted" for value $value should match pattern "R:R X.XX"');

          // Verify exact match with toStringAsFixed(2)
          final expectedStr = 'R:R ${value.toStringAsFixed(2)}';
          expect(formatted, equals(expectedStr),
              reason:
                  'R:R formatted output "$formatted" should equal "$expectedStr" for value $value');
        },
        maxExamples: 100,
      );
    });
  });
}
