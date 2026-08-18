import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:kiri_check/kiri_check.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rally/data/services/market_data_service.dart';
import 'package:rally/domain/models/asset_price.dart';
import 'package:rally/domain/models/asset_search_result.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/market_data_exception.dart';

// --- Mocks ---
class MockHttpClient extends Mock implements http.Client {}

class FakeUri extends Fake implements Uri {}

/// Feature: market-data-display
/// Property-based tests for market data JSON parsing
///
/// Property 3: AssetPrice JSON round-trip
/// "For any valid AssetPrice object, serializing to JSON then parsing back
/// SHALL produce an equivalent AssetPrice object (all fields preserved)."
///
/// **Validates: Requirements 9.1, 9.3**
///
/// Property 4: AssetSearchResult JSON round-trip
/// "For any valid AssetSearchResult object, serializing to JSON then parsing
/// back SHALL produce an equivalent AssetSearchResult object (all fields
/// preserved)."
///
/// **Validates: Requirements 9.2**
void main() {
  setUpAll(() {
    registerFallbackValue(FakeUri());
  });

  group(
      'Feature: market-data-display, '
      'Property 3: AssetPrice JSON round-trip', () {
    // **Validates: Requirements 9.1, 9.3**

    property(
        'AssetPrice.fromJson(original.toJson()) == original for any valid AssetPrice',
        () {
      // Generate a random AssetPrice using combine5 + map
      final assetPriceArb = combine5(
        // symbol: random string
        string(minLength: 1, maxLength: 10),
        // price: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // dailyHigh: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // volume: non-negative double
        integer(min: 0, max: 9999999999).map((i) => i / 100.0),
        // percentageChange: can be negative
        integer(min: -10000, max: 100000).map((i) => i / 100.0),
      ).map((tuple) {
        // Use a UTC timestamp to ensure round-trip equality
        // (fromJson always converts to UTC)
        final timestamp = DateTime.utc(2024, 1, 15, 14, 30, 0);

        return AssetPrice(
          symbol: tuple.$1,
          price: tuple.$2,
          dailyHigh: tuple.$3,
          dailyLow: tuple.$2 * 0.95, // derive dailyLow from price
          volume: tuple.$4,
          percentageChange: tuple.$5,
          timestamp: timestamp,
        );
      });

      forAll(
        assetPriceArb,
        (original) {
          final json = original.toJson();
          final restored = AssetPrice.fromJson(json);

          expect(restored, equals(original),
              reason:
                  'Round-trip failed: fromJson(toJson(x)) != x for '
                  'symbol=${original.symbol}, price=${original.price}');
        },
        maxExamples: 100,
      );
    });

    property(
        'fromJson(toJson(assetPrice)) preserves all fields including varying timestamps',
        () {
      // Generate AssetPrice with varying timestamps
      final assetPriceWithTimestampArb = combine5(
        // symbol: random string
        string(minLength: 1, maxLength: 5),
        // price: positive double
        integer(min: 1, max: 9999999).map((i) => i / 100.0),
        // dailyLow: positive double
        integer(min: 1, max: 9999999).map((i) => i / 100.0),
        // volume: non-negative double
        integer(min: 0, max: 999999999).map((i) => i / 100.0),
        // timestamp as milliseconds since epoch (2020-2030 range, UTC)
        integer(min: 1577836800000, max: 1893456000000),
      ).map((tuple) {
        final timestamp = DateTime.fromMillisecondsSinceEpoch(
          tuple.$5,
          isUtc: true,
        );

        return AssetPrice(
          symbol: tuple.$1,
          price: tuple.$2,
          dailyHigh: tuple.$2 * 1.05, // derive dailyHigh from price
          dailyLow: tuple.$3,
          volume: tuple.$4,
          percentageChange: 1.5,
          timestamp: timestamp,
        );
      });

      forAll(
        assetPriceWithTimestampArb,
        (original) {
          final json = original.toJson();
          final restored = AssetPrice.fromJson(json);

          // Verify each field individually for clear error messages
          expect(restored.symbol, equals(original.symbol),
              reason: 'symbol mismatch');
          expect(restored.price, equals(original.price),
              reason: 'price mismatch');
          expect(restored.dailyHigh, equals(original.dailyHigh),
              reason: 'dailyHigh mismatch');
          expect(restored.dailyLow, equals(original.dailyLow),
              reason: 'dailyLow mismatch');
          expect(restored.volume, equals(original.volume),
              reason: 'volume mismatch');
          expect(restored.percentageChange,
              equals(original.percentageChange),
              reason: 'percentageChange mismatch');
          expect(restored.timestamp, equals(original.timestamp),
              reason: 'timestamp mismatch');

          // Also verify full equality via Equatable
          expect(restored, equals(original),
              reason: 'Full Equatable equality failed');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: market-data-display, '
      'Property 4: AssetSearchResult JSON round-trip', () {
    // **Validates: Requirements 9.2**
    //
    // For any valid AssetSearchResult object, serializing to JSON then parsing
    // back SHALL produce an equivalent AssetSearchResult object (all fields
    // preserved).

    property(
        'AssetSearchResult.fromJson(original.toJson()) == original for any valid instance',
        () {
      forAll(
        combine5(
          // Generate random non-empty symbol strings
          string(minLength: 1, maxLength: 10),
          // Generate random non-empty name strings
          string(minLength: 1, maxLength: 50),
          // Generate random currentPrice (positive doubles)
          integer(min: 1, max: 99999999).map((i) => i / 100.0),
          // Generate random percentageChange (can be negative)
          integer(min: -10000, max: 10000).map((i) => i / 100.0),
          // Generate random AssetType index
          integer(min: 0, max: AssetType.values.length - 1),
        ).map((combo) => AssetSearchResult(
              symbol: combo.$1,
              name: combo.$2,
              currentPrice: combo.$3,
              percentageChange: combo.$4,
              type: AssetType.values[combo.$5],
            )),
        (original) {
          final json = original.toJson();
          final restored = AssetSearchResult.fromJson(json);

          expect(restored, equals(original),
              reason:
                  'Round-trip failed: fromJson(toJson(x)) != x for $original');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: market-data-display, '
      'Property 11: Non-200 HTTP status codes throw MarketDataException', () {
    // **Validates: Requirements 7.3**
    //
    // For any HTTP response with a status code outside 200, the service SHALL
    // throw a MarketDataException containing the status code in its message.

    late MockHttpClient mockHttpClient;
    late MarketDataService service;

    setUp(() {
      mockHttpClient = MockHttpClient();
      service = MarketDataService(
        baseUrl: 'http://localhost',
        webSocketUrl: 'ws://localhost',
        httpClient: mockHttpClient,
      );
    });

    property(
        'getPrice throws MarketDataException with status code for any non-200 HTTP response',
        () {
      forAll(
        integer(min: 400, max: 599),
        (statusCode) async {
          when(() => mockHttpClient.get(any())).thenAnswer(
            (_) async => http.Response('Error', statusCode),
          );

          expect(
            () => service.getPrice('AAPL'),
            throwsA(
              isA<MarketDataException>().having(
                (e) => e.message,
                'message',
                contains('$statusCode'),
              ),
            ),
          );
        },
        maxExamples: 100,
      );
    });

    property(
        'searchAssets throws MarketDataException with status code for any non-200 HTTP response',
        () {
      forAll(
        integer(min: 400, max: 599),
        (statusCode) async {
          when(() => mockHttpClient.get(any())).thenAnswer(
            (_) async => http.Response('Error', statusCode),
          );

          expect(
            () => service.searchAssets('test'),
            throwsA(
              isA<MarketDataException>().having(
                (e) => e.message,
                'message',
                contains('$statusCode'),
              ),
            ),
          );
        },
        maxExamples: 100,
      );
    });
  });
}
