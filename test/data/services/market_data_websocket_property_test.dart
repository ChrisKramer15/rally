import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:kiri_check/kiri_check.dart';
import 'package:mocktail/mocktail.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'package:rally/data/services/market_data_service.dart';
import 'package:rally/domain/models/price_update.dart';

// --- Mocks ---

class MockHttpClient extends Mock implements http.Client {}

class FakeUri extends Fake implements Uri {}

// --- Test Helpers ---

/// A controllable fake WebSocket channel for testing.
class FakeWebSocketChannel extends Fake implements WebSocketChannel {
  final StreamController<dynamic> _incomingController =
      StreamController<dynamic>.broadcast();

  @override
  final FakeWebSocketSink sink = FakeWebSocketSink();

  @override
  Stream<dynamic> get stream => _incomingController.stream;

  /// Simulate receiving a message from the server.
  void addIncoming(String message) {
    _incomingController.add(message);
  }

  /// Simulate a connection error.
  void addError(Object error) {
    _incomingController.addError(error);
  }

  /// Simulate the connection closing.
  void close() {
    _incomingController.close();
  }
}

class FakeWebSocketSink extends Fake implements WebSocketSink {
  final List<dynamic> messages = [];
  bool isClosed = false;

  @override
  void add(dynamic data) {
    messages.add(data);
  }

  @override
  Future close([int? closeCode, String? closeReason]) async {
    isClosed = true;
  }
}

/// Feature: market-data-display
/// Property-based tests for WebSocket message handling
void main() {
  setUpAll(() {
    registerFallbackValue(FakeUri());
  });

  group(
      'Feature: market-data-display, '
      'Property 7: Invalid WebSocket messages are silently discarded', () {
    // **Validates: Requirements 3.3**
    //
    // For any string that is not valid PriceUpdate JSON (malformed JSON,
    // missing fields, wrong types), the service SHALL not emit any PriceUpdate
    // and SHALL not throw an exception.

    late MockHttpClient mockHttpClient;
    late FakeWebSocketChannel fakeChannel;
    late MarketDataService service;

    setUp(() {
      mockHttpClient = MockHttpClient();
      fakeChannel = FakeWebSocketChannel();
      service = MarketDataService(
        baseUrl: 'http://localhost',
        webSocketUrl: 'ws://localhost',
        httpClient: mockHttpClient,
        channelFactory: (_) => fakeChannel,
      );

      // Subscribe to a symbol so the WebSocket connects
      service.subscribe({'AAPL'});
    });

    tearDown(() {
      service.dispose();
    });

    property(
        'random non-JSON strings do not emit on priceStream and do not throw',
        () {
      forAll(
        // Generate random strings that are not valid JSON
        string(minLength: 0, maxLength: 200),
        (randomString) async {
          final emissions = <PriceUpdate>[];
          final sub = service.priceStream.listen(emissions.add);

          // Send the random string - most random strings are not valid JSON
          // If it happens to be valid PriceUpdate JSON, skip this iteration
          try {
            final decoded = jsonDecode(randomString);
            if (decoded is Map<String, dynamic> &&
                decoded.containsKey('symbol') &&
                decoded.containsKey('price') &&
                decoded.containsKey('dailyHigh') &&
                decoded.containsKey('dailyLow') &&
                decoded.containsKey('volume') &&
                decoded.containsKey('percentageChange') &&
                decoded.containsKey('timestamp') &&
                decoded['symbol'] is String &&
                decoded['price'] is num &&
                decoded['dailyHigh'] is num &&
                decoded['dailyLow'] is num &&
                decoded['volume'] is num &&
                decoded['percentageChange'] is num &&
                decoded['timestamp'] is String &&
                DateTime.tryParse(decoded['timestamp'] as String) != null) {
              // This is actually a valid PriceUpdate - skip
              await sub.cancel();
              return;
            }
          } catch (_) {
            // Not valid JSON, which is exactly what we want to test
          }

          fakeChannel.addIncoming(randomString);

          // Allow stream events to propagate
          await Future.delayed(Duration.zero);

          expect(emissions, isEmpty,
              reason:
                  'Invalid message "$randomString" should not produce emissions');

          await sub.cancel();
        },
        maxExamples: 100,
      );
    });

    property(
        'valid JSON but not a map (arrays, numbers, strings, booleans) do not emit on priceStream',
        () {
      // Generate JSON values that are not maps
      final nonMapJsonArb = oneOf([
        // JSON arrays
        list(integer(min: -1000, max: 1000), minLength: 0, maxLength: 5)
            .map((items) => jsonEncode(items)),
        // JSON numbers
        integer(min: -99999, max: 99999).map((n) => jsonEncode(n)),
        // JSON strings (double-encoded)
        string(minLength: 0, maxLength: 50).map((s) => jsonEncode(s)),
        // JSON booleans and null
        integer(min: 0, max: 2).map((i) {
          if (i == 0) return 'true';
          if (i == 1) return 'false';
          return 'null';
        }),
      ]);

      forAll(
        nonMapJsonArb,
        (jsonString) async {
          final emissions = <PriceUpdate>[];
          final sub = service.priceStream.listen(emissions.add);

          fakeChannel.addIncoming(jsonString);

          // Allow stream events to propagate
          await Future.delayed(Duration.zero);

          expect(emissions, isEmpty,
              reason:
                  'Non-map JSON "$jsonString" should not produce emissions');

          await sub.cancel();
        },
        maxExamples: 100,
      );
    });

    property(
        'valid JSON maps missing required PriceUpdate fields do not emit on priceStream',
        () {
      // Required fields for PriceUpdate
      final requiredFields = [
        'symbol',
        'price',
        'dailyHigh',
        'dailyLow',
        'volume',
        'percentageChange',
        'timestamp',
      ];

      // Generate a valid map then randomly remove one or more fields
      final incompleteMapArb = combine2(
        // Number of fields to remove (1 to all 7)
        integer(min: 1, max: requiredFields.length),
        // Random seed for picking which fields to remove
        integer(min: 0, max: 99999),
      ).map((tuple) {
        final numToRemove = tuple.$1;
        final seed = tuple.$2;

        // Start with a complete valid map
        final map = <String, dynamic>{
          'symbol': 'AAPL',
          'price': 185.50,
          'dailyHigh': 187.20,
          'dailyLow': 183.90,
          'volume': 52340000.0,
          'percentageChange': 1.25,
          'timestamp': '2024-01-15T14:30:00Z',
        };

        // Shuffle the fields deterministically and remove some
        final shuffled = List<String>.from(requiredFields);
        for (var i = shuffled.length - 1; i > 0; i--) {
          final j = (seed + i) % (i + 1);
          final temp = shuffled[i];
          shuffled[i] = shuffled[j];
          shuffled[j] = temp;
        }

        // Remove fields
        for (var i = 0; i < numToRemove; i++) {
          map.remove(shuffled[i]);
        }

        return jsonEncode(map);
      });

      forAll(
        incompleteMapArb,
        (jsonString) async {
          final emissions = <PriceUpdate>[];
          final sub = service.priceStream.listen(emissions.add);

          fakeChannel.addIncoming(jsonString);

          // Allow stream events to propagate
          await Future.delayed(Duration.zero);

          expect(emissions, isEmpty,
              reason:
                  'Map with missing fields "$jsonString" should not produce emissions');

          await sub.cancel();
        },
        maxExamples: 100,
      );
    });

    property(
        'valid JSON maps with incorrectly typed field values do not emit on priceStream',
        () {
      // Generate a map where one or more fields have wrong types
      final wrongTypesArb = combine2(
        // Which field to corrupt (0-6)
        integer(min: 0, max: 6),
        // Value to use as corruption
        integer(min: 0, max: 3),
      ).map((tuple) {
        final fieldIndex = tuple.$1;
        final corruptionType = tuple.$2;

        // Start with a complete valid map
        final map = <String, dynamic>{
          'symbol': 'AAPL',
          'price': 185.50,
          'dailyHigh': 187.20,
          'dailyLow': 183.90,
          'volume': 52340000.0,
          'percentageChange': 1.25,
          'timestamp': '2024-01-15T14:30:00Z',
        };

        final fields = [
          'symbol',
          'price',
          'dailyHigh',
          'dailyLow',
          'volume',
          'percentageChange',
          'timestamp',
        ];

        final fieldToCorrupt = fields[fieldIndex];

        // Apply wrong type based on what the field expects
        if (fieldToCorrupt == 'symbol' || fieldToCorrupt == 'timestamp') {
          // These expect String, give them non-string values
          switch (corruptionType) {
            case 0:
              map[fieldToCorrupt] = 12345;
              break;
            case 1:
              map[fieldToCorrupt] = true;
              break;
            case 2:
              map[fieldToCorrupt] = [1, 2, 3];
              break;
            default:
              map[fieldToCorrupt] = null;
              break;
          }
        } else {
          // These expect num, give them non-num values
          switch (corruptionType) {
            case 0:
              map[fieldToCorrupt] = 'not_a_number';
              break;
            case 1:
              map[fieldToCorrupt] = true;
              break;
            case 2:
              map[fieldToCorrupt] = [1, 2, 3];
              break;
            default:
              map[fieldToCorrupt] = null;
              break;
          }
        }

        return jsonEncode(map);
      });

      forAll(
        wrongTypesArb,
        (jsonString) async {
          final emissions = <PriceUpdate>[];
          final sub = service.priceStream.listen(emissions.add);

          fakeChannel.addIncoming(jsonString);

          // Allow stream events to propagate
          await Future.delayed(Duration.zero);

          expect(emissions, isEmpty,
              reason:
                  'Map with wrong types "$jsonString" should not produce emissions');

          await sub.cancel();
        },
        maxExamples: 100,
      );
    });
  });
}
