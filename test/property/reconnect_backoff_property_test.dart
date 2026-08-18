import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';

import 'package:rally/data/services/market_data_service.dart';

/// Feature: live-market-data
/// Property-based tests for MarketDataService reconnection backoff
///
/// Property 6: Exponential backoff delay calculation
/// "For any reconnection attempt number N (0 ≤ N < 10), the computed reconnect
/// delay equals min(1000 × 2^N, 30000) milliseconds."
///
/// **Validates: Requirements 4.5**
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group(
      'Feature: live-market-data, '
      'Property 6: Exponential backoff delay calculation', () {
    // **Validates: Requirements 4.5**

    property(
        'computed delay equals min(1000 * 2^N, 30000) for random attempt numbers 0–9',
        () {
      // Generator for random attempt numbers in range [0, 9]
      final attemptArb = integer(min: 0, max: 9);

      forAll(
        attemptArb,
        (attempt) {
          // Compute expected delay using the formula
          final expectedDelayMs = min(1000 * pow(2, attempt), 30000).toInt();

          // Compute actual delay from the service's static method
          final actualDelay =
              MarketDataService.calculateReconnectDelay(attempt);

          // Verify the computed delay matches the expected value
          expect(actualDelay.inMilliseconds, equals(expectedDelayMs),
              reason: 'For attempt $attempt: '
                  'expected ${expectedDelayMs}ms, '
                  'got ${actualDelay.inMilliseconds}ms. '
                  'Formula: min(1000 × 2^$attempt, 30000) = $expectedDelayMs');
        },
        maxExamples: 100,
      );
    });
  });
}
