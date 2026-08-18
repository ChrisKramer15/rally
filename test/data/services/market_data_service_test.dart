import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mocktail/mocktail.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'package:rally/data/services/market_data_service.dart';
import 'package:rally/domain/models/enums.dart';

// --- Mocks ---

class MockHttpClient extends Mock implements http.Client {}

class MockWebSocketChannel extends Mock implements WebSocketChannel {}

class MockWebSocketSink extends Mock implements WebSocketSink {}

class FakeUri extends Fake implements Uri {}

// --- Test Helpers ---

/// A controllable fake WebSocket channel for testing.
class FakeWebSocketChannel extends Fake implements WebSocketChannel {
  final StreamController<dynamic> _incomingController =
      StreamController<dynamic>.broadcast();
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

void main() {
  late MockHttpClient mockHttpClient;
  late FakeWebSocketChannel fakeChannel;
  late MarketDataService service;

  const baseUrl = 'http://localhost:8080';
  const wsUrl = 'ws://localhost:8080/ws';

  setUpAll(() {
    registerFallbackValue(FakeUri());
  });

  setUp(() {
    mockHttpClient = MockHttpClient();
    fakeChannel = FakeWebSocketChannel();
    service = MarketDataService(
      baseUrl: baseUrl,
      webSocketUrl: wsUrl,
      httpClient: mockHttpClient,
      channelFactory: (_) => fakeChannel,
    );
  });

  tearDown(() {
    service.dispose();
  });

  group('MarketDataService - REST', () {
    group('getPrice', () {
      test('returns AssetPrice on successful response', () async {
        final timestamp = DateTime(2024, 1, 15, 10, 30);
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response(
            jsonEncode({
              'symbol': 'AAPL',
              'price': 185.50,
              'dailyHigh': 187.00,
              'dailyLow': 184.20,
              'volume': 1500000.0,
              'percentageChange': 1.25,
              'timestamp': timestamp.toIso8601String(),
            }),
            200,
          ),
        );

        final result = await service.getPrice('AAPL');

        expect(result.symbol, 'AAPL');
        expect(result.price, 185.50);
        expect(result.dailyHigh, 187.00);
        expect(result.dailyLow, 184.20);
        expect(result.volume, 1500000.0);
        expect(result.percentageChange, 1.25);
        expect(result.timestamp, timestamp);

        final captured =
            verify(() => mockHttpClient.get(captureAny())).captured;
        expect(
          (captured.first as Uri).toString(),
          '$baseUrl/api/v1/price/AAPL',
        );
      });

      test('throws MarketDataException on non-200 status', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response('Not Found', 404),
        );

        expect(
          () => service.getPrice('INVALID'),
          throwsA(isA<MarketDataException>()),
        );
      });

      test('throws MarketDataException on invalid JSON', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response('not json', 200),
        );

        expect(
          () => service.getPrice('AAPL'),
          throwsA(isA<MarketDataException>()),
        );
      });
    });

    group('searchAssets', () {
      test('returns list of AssetSearchResult on success', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response(
            jsonEncode([
              {
                'symbol': 'AAPL',
                'name': 'Apple Inc.',
                'currentPrice': 185.50,
                'percentageChange': 1.25,
                'type': 'stock',
              },
              {
                'symbol': 'AMZN',
                'name': 'Amazon.com Inc.',
                'currentPrice': 178.25,
                'percentageChange': -0.50,
                'type': 'stock',
              },
            ]),
            200,
          ),
        );

        final results = await service.searchAssets('A');

        expect(results, hasLength(2));
        expect(results[0].symbol, 'AAPL');
        expect(results[0].name, 'Apple Inc.');
        expect(results[0].currentPrice, 185.50);
        expect(results[0].type, AssetType.stock);
        expect(results[1].symbol, 'AMZN');
      });

      test('returns empty list when no results', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response(jsonEncode([]), 200),
        );

        final results = await service.searchAssets('XYZ123');
        expect(results, isEmpty);
      });

      test('throws MarketDataException on non-200 status', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response('Server Error', 500),
        );

        expect(
          () => service.searchAssets('AAPL'),
          throwsA(isA<MarketDataException>()),
        );
      });

      test('constructs correct URL with query parameter', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response(jsonEncode([]), 200),
        );

        await service.searchAssets('Apple');

        final captured =
            verify(() => mockHttpClient.get(captureAny())).captured;
        final uri = captured.first as Uri;
        expect(uri.queryParameters['q'], 'Apple');
      });
    });

    group('getOhlcData', () {
      test('returns list of OhlcCandle on success', () async {
        final timestamp = DateTime(2024, 1, 15);
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response(
            jsonEncode([
              {
                'timestamp': timestamp.toIso8601String(),
                'open': 184.00,
                'high': 187.00,
                'low': 183.50,
                'close': 185.50,
                'volume': 1500000.0,
              },
            ]),
            200,
          ),
        );

        final result = await service.getOhlcData(
          symbol: 'AAPL',
          duration: TimeDuration.oneHour,
        );

        expect(result, hasLength(1));
        expect(result[0].open, 184.00);
        expect(result[0].high, 187.00);
        expect(result[0].low, 183.50);
        expect(result[0].close, 185.50);
        expect(result[0].volume, 1500000.0);
        expect(result[0].timestamp, timestamp);
      });

      test('includes duration in query parameters', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response(jsonEncode([]), 200),
        );

        await service.getOhlcData(
          symbol: 'AAPL',
          duration: TimeDuration.fourHour,
        );

        final captured =
            verify(() => mockHttpClient.get(captureAny())).captured;
        final uri = captured.first as Uri;
        expect(uri.path, '/api/v1/ohlc/AAPL');
        expect(uri.queryParameters['duration'], 'fourHour');
      });

      test('includes start and end dates when provided', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response(jsonEncode([]), 200),
        );

        final start = DateTime(2024, 1, 1);
        final end = DateTime(2024, 1, 31);

        await service.getOhlcData(
          symbol: 'AAPL',
          duration: TimeDuration.twentyFourHour,
          startDate: start,
          endDate: end,
        );

        final captured =
            verify(() => mockHttpClient.get(captureAny())).captured;
        final uri = captured.first as Uri;
        expect(uri.queryParameters['start'], start.toIso8601String());
        expect(uri.queryParameters['end'], end.toIso8601String());
      });

      test('throws MarketDataException on failure', () async {
        when(() => mockHttpClient.get(any())).thenAnswer(
          (_) async => http.Response('Error', 503),
        );

        expect(
          () => service.getOhlcData(
            symbol: 'AAPL',
            duration: TimeDuration.oneHour,
          ),
          throwsA(isA<MarketDataException>()),
        );
      });
    });
  });

  group('MarketDataService - WebSocket', () {
    group('subscribe', () {
      test('connects WebSocket on first subscribe', () async {
        service.subscribe({'AAPL'});

        // Give the stream listener time to set up
        await Future.delayed(Duration.zero);

        // Check that a subscribe message was sent
        expect(fakeChannel.sink.messages, hasLength(1));
        final message =
            jsonDecode(fakeChannel.sink.messages.first as String) as Map;
        expect(message['action'], 'subscribe');
        expect(message['symbols'], ['AAPL']);
      });

      test('sends subscribe message for additional symbols', () async {
        service.subscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        service.subscribe({'MSFT', 'GOOG'});
        await Future.delayed(Duration.zero);

        // First message subscribes AAPL, second subscribes MSFT/GOOG
        expect(fakeChannel.sink.messages, hasLength(2));
        final secondMessage =
            jsonDecode(fakeChannel.sink.messages[1] as String) as Map;
        expect(secondMessage['action'], 'subscribe');
        expect(
          (secondMessage['symbols'] as List).toSet(),
          {'MSFT', 'GOOG'},
        );
      });

      test('does nothing when subscribing with empty set', () async {
        service.subscribe({});
        await Future.delayed(Duration.zero);
        expect(fakeChannel.sink.messages, isEmpty);
      });
    });

    group('unsubscribe', () {
      test('sends unsubscribe message', () async {
        service.subscribe({'AAPL', 'MSFT'});
        await Future.delayed(Duration.zero);

        service.unsubscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        expect(fakeChannel.sink.messages, hasLength(2));
        final unsubMessage =
            jsonDecode(fakeChannel.sink.messages[1] as String) as Map;
        expect(unsubMessage['action'], 'unsubscribe');
        expect(unsubMessage['symbols'], ['AAPL']);
      });

      test('disconnects when all symbols unsubscribed', () async {
        service.subscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        service.unsubscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        expect(fakeChannel.sink.isClosed, isTrue);
      });
    });

    group('priceStream', () {
      test('emits PriceUpdate when WebSocket receives valid JSON', () async {
        final timestamp = DateTime(2024, 1, 15, 10, 30);
        service.subscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        final future = service.priceStream.first;
        fakeChannel.addIncoming(jsonEncode({
          'symbol': 'AAPL',
          'price': 186.00,
          'dailyHigh': 187.50,
          'dailyLow': 184.00,
          'volume': 2000000.0,
          'percentageChange': 1.50,
          'timestamp': timestamp.toIso8601String(),
        }));

        final update = await future;

        expect(update.symbol, 'AAPL');
        expect(update.price, 186.00);
        expect(update.dailyHigh, 187.50);
        expect(update.dailyLow, 184.00);
        expect(update.volume, 2000000.0);
        expect(update.percentageChange, 1.50);
        expect(update.timestamp, timestamp);
      });

      test('ignores malformed JSON messages', () async {
        service.subscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        final updates = <dynamic>[];
        final sub = service.priceStream.listen(updates.add);

        fakeChannel.addIncoming('not valid json');
        await Future.delayed(const Duration(milliseconds: 50));

        expect(updates, isEmpty);
        await sub.cancel();
      });
    });

    group('connectionStatus', () {
      test('emits connected when WebSocket connects', () async {
        final future = service.connectionStatus.first;
        service.subscribe({'AAPL'});

        final status = await future;
        expect(status, ConnectionStatus.connected);
      });

      test('emits disconnected when WebSocket closes', () async {
        service.subscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        final future = service.connectionStatus.first;
        fakeChannel.close();
        await Future.delayed(Duration.zero);

        final status = await future;
        expect(status, ConnectionStatus.disconnected);
      });

      test('emits disconnected on WebSocket error', () async {
        service.subscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        // Drain the initial 'connected' event
        final statuses = <ConnectionStatus>[];
        final sub = service.connectionStatus.listen(statuses.add);

        fakeChannel.addError(Exception('Connection lost'));
        await Future.delayed(const Duration(milliseconds: 50));

        expect(statuses, contains(ConnectionStatus.disconnected));
        await sub.cancel();
      });
    });

    group('exponential backoff reconnection', () {
      test('attempts to reconnect after disconnection', () async {
        // Use fakeAsync to control time
        var connectCount = 0;
        final channels = <FakeWebSocketChannel>[];

        service = MarketDataService(
          baseUrl: baseUrl,
          webSocketUrl: wsUrl,
          httpClient: mockHttpClient,
          channelFactory: (_) {
            connectCount++;
            final channel = FakeWebSocketChannel();
            channels.add(channel);
            return channel;
          },
        );

        service.subscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        expect(connectCount, 1);

        // Simulate disconnect
        channels[0].close();
        await Future.delayed(Duration.zero);

        // Wait for the initial reconnect delay (1 second)
        await Future.delayed(const Duration(milliseconds: 1100));

        expect(connectCount, 2);
        service.dispose();
      });

      test('emits reconnecting status before reconnect attempt', () async {
        final statuses = <ConnectionStatus>[];
        final sub = service.connectionStatus.listen(statuses.add);

        service.subscribe({'AAPL'});
        await Future.delayed(Duration.zero);

        // Simulate disconnect
        fakeChannel.close();
        await Future.delayed(const Duration(milliseconds: 50));

        expect(statuses, contains(ConnectionStatus.reconnecting));
        await sub.cancel();
      });
    });
  });

  group('MarketDataService - dispose', () {
    test('closes streams on dispose', () async {
      service.subscribe({'AAPL'});
      await Future.delayed(Duration.zero);

      service.dispose();

      // Streams should be closed
      expect(
        service.priceStream.listen((_) {}).asFuture(),
        completes,
      );
    });
  });
}
