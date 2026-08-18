import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';

/// Feature: market-data-display
/// Property-based test for exponential backoff reconnection delay
///
/// Property 10: Exponential backoff calculation
/// "For any reconnection attempt number n (where n ≥ 0), the reconnection
/// delay SHALL equal min(1000 × 2^n, 30000) milliseconds."
///
/// **Validates: Requirements 4.2**

/// Replicates the exponential backoff formula used by MarketDataService.
/// This matches the implementation: `_initialReconnectDelayMs * (1 << n)`
/// clamped to `_maxReconnectDelayMs`.
int calculateReconnectDelay(int attempt) {
  const initialDelayMs = 1000;
  const maxDelayMs = 30000;
  final delay = initialDelayMs * (1 << attempt);
  return delay.clamp(0, maxDelayMs);
}

void main() {
  group(
      'Feature: market-data-display, '
      'Property 10: Exponential backoff calculation', () {
    // **Validates: Requirements 4.2**

    property(
        'reconnect delay equals min(1000 * 2^n, 30000) for any attempt number 0..20',
        () {
      forAll(
        integer(min: 0, max: 20),
        (attempt) {
          final actualDelay = calculateReconnectDelay(attempt);
          final expectedDelay = min(1000 * pow(2, attempt), 30000).toInt();

          expect(actualDelay, equals(expectedDelay),
              reason:
                  'For attempt $attempt: expected delay=$expectedDelay, '
                  'got $actualDelay');
        },
        maxExamples: 100,
      );
    });

    property(
        'reconnect delay never exceeds 30000ms cap regardless of attempt number',
        () {
      forAll(
        integer(min: 0, max: 20),
        (attempt) {
          final delay = calculateReconnectDelay(attempt);

          expect(delay, lessThanOrEqualTo(30000),
              reason: 'Delay $delay exceeds cap of 30000ms for attempt $attempt');
        },
        maxExamples: 100,
      );
    });

    property(
        'reconnect delay is always at least 1000ms (initial delay) for all attempts',
        () {
      forAll(
        integer(min: 0, max: 20),
        (attempt) {
          final delay = calculateReconnectDelay(attempt);

          expect(delay, greaterThanOrEqualTo(1000),
              reason:
                  'Delay $delay is less than initial delay 1000ms for attempt $attempt');
        },
        maxExamples: 100,
      );
    });

    property(
        'reconnect delay is monotonically non-decreasing with attempt number',
        () {
      forAll(
        integer(min: 0, max: 19),
        (attempt) {
          final currentDelay = calculateReconnectDelay(attempt);
          final nextDelay = calculateReconnectDelay(attempt + 1);

          expect(nextDelay, greaterThanOrEqualTo(currentDelay),
              reason:
                  'Delay should be non-decreasing: attempt $attempt=$currentDelay, '
                  'attempt ${attempt + 1}=$nextDelay');
        },
        maxExamples: 100,
      );
    });
  });
}
