import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mocktail/mocktail.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'package:rally/data/repositories/market_data_repository.dart';
import 'package:rally/data/services/market_data_service.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/price_update.dart';
import 'package:rally/presentation/blocs/market_data_bloc.dart';

// --- Mocks & Fakes ---

class MockHttpClient extends Mock implements http.Client {}

class FakeUri extends Fake implements Uri {}

/// A controllable fake WebSocket channel for integration testing.
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
  Future<void> closeStream() async {
    await _incomingController.close();
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

// --- Integration Tests ---

void main() {
  setUpAll(() {
    registerFallbackValue(FakeUri());
    registerFallbackValue(Uri.parse('http://localhost'));
  });

  group('Integration: End-to-end search flow', () {
    // Test: type query → see results → tap → see detail
    // Requirements: 1.1, 1.2, 1.4, 2.1, 2.2

    late MockHttpClient mockHttpClient;
    late FakeWebSocketChannel fakeChannel;
    late MarketDataService service;
    late MarketDataRepository repository;
    late MarketDataBloc bloc;

    setUp(() {
      mockHttpClient = MockHttpClient();
      fakeChannel = FakeWebSocketChannel();
      service = MarketDataService(
        baseUrl: 'http://localhost',
        webSocketUrl: 'ws://localhost',
        httpClient: mockHttpClient,
        channelFactory: (_) => fakeChannel,
      );
      repository = MarketDataRepository(service: service);
      bloc = MarketDataBloc(repository: repository);
    });

    tearDown(() async {
      await bloc.close();
      repository.dispose();
      service.dispose();
    });

    test(
      'SearchAsset → Searching → SearchResults → SelectAsset → AssetDetail',
      () async {
        // Arrange: Mock the search HTTP response
        final searchResponseBody = jsonEncode([
          {
            'symbol': 'AAPL',
            'name': 'Apple Inc.',
            'currentPrice': 185.50,
            'percentageChange': 1.25,
            'type': 'stock',
          },
          {
            'symbol': 'AAPLX',
            'name': 'Apple Extended',
            'currentPrice': 90.00,
            'percentageChange': -0.50,
            'type': 'etf',
          },
        ]);

        when(() => mockHttpClient.get(any()))
            .thenAnswer((invocation) async {
          final uri = invocation.positionalArguments[0] as Uri;
          if (uri.path.contains('/api/v1/search')) {
            return http.Response(searchResponseBody, 200);
          }
          if (uri.path.contains('/api/v1/price/AAPL')) {
            return http.Response(
              jsonEncode({
                'symbol': 'AAPL',
                'price': 185.50,
                'dailyHigh': 187.20,
                'dailyLow': 183.90,
                'volume': 52340000,
                'percentageChange': 1.25,
                'timestamp': '2024-01-15T14:30:00Z',
              }),
              200,
            );
          }
          return http.Response('Not found', 404);
        });

        // Collect states to verify transitions
        final states = <MarketDataState>[];
        final sub = bloc.stream.listen(states.add);

        // Act Step 1: Search for "AAPL"
        bloc.add(const SearchAsset('AAPL'));
        await Future<void>.delayed(const Duration(milliseconds: 150));

        // Assert: Should have transitioned through Searching → SearchResults
        expect(states, contains(isA<Searching>()));
        expect(states, contains(isA<SearchResults>()));

        final searchResultsState =
            states.whereType<SearchResults>().first;
        expect(searchResultsState.results.length, equals(2));
        expect(searchResultsState.results[0].symbol, equals('AAPL'));
        expect(searchResultsState.results[0].name, equals('Apple Inc.'));
        expect(searchResultsState.results[0].currentPrice, equals(185.50));
        expect(searchResultsState.results[0].percentageChange, equals(1.25));
        expect(searchResultsState.results[1].symbol, equals('AAPLX'));

        // Act Step 2: Select the first result
        states.clear();
        bloc.add(const SelectAsset('AAPL'));
        await Future<void>.delayed(const Duration(milliseconds: 150));

        // Assert: Should emit AssetDetail with full price data
        expect(states, contains(isA<AssetDetail>()));

        final detailState = states.whereType<AssetDetail>().first;
        expect(detailState.assetPrice.symbol, equals('AAPL'));
        expect(detailState.assetPrice.price, equals(185.50));
        expect(detailState.assetPrice.dailyHigh, equals(187.20));
        expect(detailState.assetPrice.dailyLow, equals(183.90));
        expect(detailState.assetPrice.volume, equals(52340000.0));
        expect(detailState.assetPrice.percentageChange, equals(1.25));

        await sub.cancel();
      },
    );

    test(
      'SearchAsset with no results emits NoResults state',
      () async {
        // Arrange: Mock empty search results
        when(() => mockHttpClient.get(any()))
            .thenAnswer((_) async => http.Response('[]', 200));

        // Act
        bloc.add(const SearchAsset('XYZZZZ'));
        await Future<void>.delayed(const Duration(milliseconds: 150));

        // Assert
        expect(bloc.state, isA<NoResults>());
      },
    );

    test(
      'SearchAsset with HTTP error emits MarketDataError state',
      () async {
        // Arrange: Mock a 500 server error
        when(() => mockHttpClient.get(any()))
            .thenAnswer((_) async => http.Response('Server Error', 500));

        // Act
        bloc.add(const SearchAsset('AAPL'));
        await Future<void>.delayed(const Duration(milliseconds: 150));

        // Assert
        expect(bloc.state, isA<MarketDataError>());
        final errorState = bloc.state as MarketDataError;
        expect(errorState.message, contains('500'));
      },
    );
  });

  group('Integration: WebSocket lifecycle', () {
    // Test: connect → receive updates → disconnect → reconnect
    // Requirements: 3.1, 2.1, 2.2

    late MockHttpClient mockHttpClient;
    late FakeWebSocketChannel fakeChannel;
    late MarketDataService service;
    late MarketDataRepository repository;

    setUp(() {
      mockHttpClient = MockHttpClient();
      fakeChannel = FakeWebSocketChannel();
      service = MarketDataService(
        baseUrl: 'http://localhost',
        webSocketUrl: 'ws://localhost',
        httpClient: mockHttpClient,
        channelFactory: (_) => fakeChannel,
      );
      repository = MarketDataRepository(service: service);
    });

    tearDown(() {
      repository.dispose();
      service.dispose();
    });

    test(
      'subscribe → connected status → receive price update via priceStream',
      () async {
        // Collect connection statuses and price updates
        final statuses = <ConnectionStatus>[];
        final prices = <PriceUpdate>[];
        final statusSub = repository.connectionStatus.listen(statuses.add);
        final priceSub = repository.priceStream.listen(prices.add);

        // Act: Subscribe to symbols (triggers WebSocket connection)
        repository.subscribe({'AAPL'});
        await Future<void>.delayed(const Duration(milliseconds: 50));

        // Assert: Should emit connected status
        expect(statuses, contains(ConnectionStatus.connected));

        // Act: Inject a price update JSON message on the WebSocket
        final priceUpdateJson = jsonEncode({
          'symbol': 'AAPL',
          'price': 186.00,
          'dailyHigh': 188.00,
          'dailyLow': 184.00,
          'volume': 53000000,
          'percentageChange': 1.50,
          'timestamp': '2024-01-15T14:35:00Z',
        });
        fakeChannel.addIncoming(priceUpdateJson);
        await Future<void>.delayed(const Duration(milliseconds: 50));

        // Assert: Price update flows through to repository's priceStream
        expect(prices.length, equals(1));
        expect(prices[0].symbol, equals('AAPL'));
        expect(prices[0].price, equals(186.00));
        expect(prices[0].dailyHigh, equals(188.00));
        expect(prices[0].dailyLow, equals(184.00));
        expect(prices[0].volume, equals(53000000.0));
        expect(prices[0].percentageChange, equals(1.50));

        await statusSub.cancel();
        await priceSub.cancel();
      },
    );

    test(
      'WebSocket close → disconnected status → reconnecting status',
      () async {
        final statuses = <ConnectionStatus>[];
        final statusSub = repository.connectionStatus.listen(statuses.add);

        // Subscribe triggers WebSocket connection
        repository.subscribe({'AAPL'});
        await Future<void>.delayed(const Duration(milliseconds: 50));

        // Verify connected
        expect(statuses, contains(ConnectionStatus.connected));
        statuses.clear();

        // Act: Close the WebSocket channel (simulate disconnect)
        await fakeChannel.closeStream();
        await Future<void>.delayed(const Duration(milliseconds: 50));

        // Assert: Should emit disconnected then reconnecting
        expect(statuses, contains(ConnectionStatus.disconnected));
        expect(statuses, contains(ConnectionStatus.reconnecting));

        await statusSub.cancel();
      },
    );

    test(
      'subscribe sends subscribe message over WebSocket sink',
      () async {
        // Act: Subscribe to symbols
        repository.subscribe({'AAPL', 'TSLA'});
        await Future<void>.delayed(const Duration(milliseconds: 50));

        // Assert: A subscribe message was sent over the WebSocket
        expect(fakeChannel.sink.messages, isNotEmpty);

        final sentMessage =
            jsonDecode(fakeChannel.sink.messages.first as String)
                as Map<String, dynamic>;
        expect(sentMessage['action'], equals('subscribe'));
        expect(
          (sentMessage['symbols'] as List).toSet(),
          containsAll(['AAPL', 'TSLA']),
        );
      },
    );
  });

  group('Integration: Cache fallback during network issues', () {
    // Test: fetch populates cache → network fails → stale cache returned
    // Requirements: 6.3

    late MockHttpClient mockHttpClient;
    late FakeWebSocketChannel fakeChannel;
    late MarketDataService service;
    late MarketDataRepository repository;

    setUp(() {
      mockHttpClient = MockHttpClient();
      fakeChannel = FakeWebSocketChannel();
      service = MarketDataService(
        baseUrl: 'http://localhost',
        webSocketUrl: 'ws://localhost',
        httpClient: mockHttpClient,
        channelFactory: (_) => fakeChannel,
      );
      repository = MarketDataRepository(service: service);
    });

    tearDown(() {
      repository.dispose();
      service.dispose();
    });

    test(
      'successful fetch populates cache, then network failure returns cached price',
      () async {
        // Arrange: First call succeeds
        final priceJson = jsonEncode({
          'symbol': 'AAPL',
          'price': 185.50,
          'dailyHigh': 187.20,
          'dailyLow': 183.90,
          'volume': 52340000,
          'percentageChange': 1.25,
          'timestamp': '2024-01-15T14:30:00Z',
        });

        var callCount = 0;
        when(() => mockHttpClient.get(any())).thenAnswer((_) async {
          callCount++;
          if (callCount == 1) {
            return http.Response(priceJson, 200);
          }
          // Subsequent calls fail with network error
          throw Exception('Network unavailable');
        });

        // Act Step 1: First fetch - populates cache
        final firstResult = await repository.getPrice('AAPL');
        expect(firstResult.symbol, equals('AAPL'));
        expect(firstResult.price, equals(185.50));

        // Act Step 2: Expire the cache entry so it doesn't short-circuit
        repository.expireCacheEntry('AAPL');

        // Act Step 3: Fetch again - network fails but cache should be returned
        final fallbackResult = await repository.getPrice('AAPL');

        // Assert: Should return the cached price despite network failure
        expect(fallbackResult.symbol, equals('AAPL'));
        expect(fallbackResult.price, equals(185.50));
        expect(fallbackResult.dailyHigh, equals(187.20));
        expect(fallbackResult.dailyLow, equals(183.90));
      },
    );

    test(
      'fresh cache returns without network call',
      () async {
        // Arrange: First call succeeds
        final priceJson = jsonEncode({
          'symbol': 'TSLA',
          'price': 250.00,
          'dailyHigh': 255.00,
          'dailyLow': 245.00,
          'volume': 30000000,
          'percentageChange': 2.00,
          'timestamp': '2024-01-15T15:00:00Z',
        });

        var callCount = 0;
        when(() => mockHttpClient.get(any())).thenAnswer((_) async {
          callCount++;
          return http.Response(priceJson, 200);
        });

        // Act: First fetch populates cache
        await repository.getPrice('TSLA');
        expect(callCount, equals(1));

        // Act: Second fetch within 60 seconds should use cache
        final secondResult = await repository.getPrice('TSLA');
        expect(secondResult.price, equals(250.00));
        // No additional HTTP call should have been made
        expect(callCount, equals(1));
      },
    );

    test(
      'no cached price and network failure propagates error',
      () async {
        // Arrange: Network always fails
        when(() => mockHttpClient.get(any()))
            .thenThrow(Exception('Network unavailable'));

        // Act & Assert: Should propagate error since no cached price
        expect(
          () => repository.getPrice('UNKNOWN'),
          throwsA(isA<Exception>()),
        );
      },
    );
  });
}
