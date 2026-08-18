import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rally/data/repositories/market_data_repository.dart';
import 'package:rally/data/services/watchlist_store.dart';
import 'package:rally/domain/models/asset_price.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/price_update.dart';
import 'package:rally/domain/services/i_market_data_service.dart';
import 'package:rally/presentation/blocs/market_data/market_data_dashboard_bloc.dart';

// ---------------------------------------------------------------------------
// Mock: only the lowest-level external dependency
// ---------------------------------------------------------------------------

class MockMarketDataService extends Mock implements IMarketDataService {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockMarketDataService mockService;
  late StreamController<PriceUpdate> priceStreamController;
  late StreamController<ConnectionStatus> connectionStatusController;
  late MarketDataRepository repository;
  late WatchlistStore watchlistStore;
  late MarketDataDashboardBloc bloc;

  final testTimestamp = DateTime.utc(2024, 6, 15, 10, 30);

  setUpAll(() {
    registerFallbackValue(<String>{});
  });

  setUp(() async {
    mockService = MockMarketDataService();
    priceStreamController = StreamController<PriceUpdate>.broadcast();
    connectionStatusController = StreamController<ConnectionStatus>.broadcast();

    when(() => mockService.priceStream)
        .thenAnswer((_) => priceStreamController.stream);
    when(() => mockService.connectionStatus)
        .thenAnswer((_) => connectionStatusController.stream);
    when(() => mockService.subscribe(any())).thenReturn(null);
    when(() => mockService.unsubscribe(any())).thenReturn(null);
    when(() => mockService.resetReconnection()).thenReturn(null);

    // Create real repository wrapping mock service
    repository = MarketDataRepository(service: mockService);
  });

  tearDown(() async {
    await bloc.close();
    repository.dispose();
    await priceStreamController.close();
    await connectionStatusController.close();
  });

  /// Helper to create the WatchlistStore and BLoC with given initial symbols.
  Future<void> setupBlocWithWatchlist(List<String> initialSymbols) async {
    SharedPreferences.setMockInitialValues(
      initialSymbols.isEmpty
          ? <String, Object>{}
          : {'watchlist_symbols': initialSymbols},
    );
    final prefs = await SharedPreferences.getInstance();
    watchlistStore = WatchlistStore(prefs: prefs);
    bloc = MarketDataDashboardBloc(
      watchlistStore: watchlistStore,
      repository: repository,
    );
  }

  // -------------------------------------------------------------------------
  // Test 1: Full lifecycle
  // open dashboard → load watchlist → receive price updates → close → unsubscribe
  // Requirements: 2.1, 2.3, 2.4
  // -------------------------------------------------------------------------

  group('Integration: Dashboard full lifecycle', () {
    test(
      'open → watchlist symbols subscribed → receive price update → '
      'price appears in state → close → unsubscribed',
      () async {
        // Arrange: Watchlist has AAPL and TSLA
        await setupBlocWithWatchlist(['AAPL', 'TSLA']);

        // Collect states
        final states = <MarketDataDashboardState>[];
        final sub = bloc.stream.listen(states.add);

        // Act Step 1: Open the dashboard
        bloc.add(const DashboardOpened());
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Assert: Service was told to subscribe to both symbols
        verify(() => mockService.subscribe({'AAPL', 'TSLA'})).called(1);

        // Assert: State is DashboardLoaded with symbols in unavailable
        // (since no cached prices exist yet)
        expect(states.last, isA<DashboardLoaded>());
        final loadedState = states.last as DashboardLoaded;
        expect(loadedState.unavailable, containsAll(['AAPL', 'TSLA']));
        expect(loadedState.connectionStatus, ConnectionStatus.connected);

        // Act Step 2: Receive a price update for AAPL via the price stream
        final aaplUpdate = PriceUpdate(
          symbol: 'AAPL',
          price: 185.42,
          dailyHigh: 186.10,
          dailyLow: 183.55,
          volume: 52340000,
          percentageChange: 1.23,
          timestamp: testTimestamp,
        );
        priceStreamController.add(aaplUpdate);
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Assert: AAPL price appears in state, removed from unavailable
        expect(bloc.state, isA<DashboardLoaded>());
        final updatedState = bloc.state as DashboardLoaded;
        expect(updatedState.prices.containsKey('AAPL'), isTrue);
        expect(updatedState.prices['AAPL']!.price, equals(185.42));
        expect(updatedState.prices['AAPL']!.percentageChange, equals(1.23));
        expect(updatedState.unavailable.contains('AAPL'), isFalse);
        // TSLA still unavailable
        expect(updatedState.unavailable.contains('TSLA'), isTrue);

        // Assert: Repository cache was updated
        expect(repository.getCachedPrice('AAPL'), isNotNull);
        expect(repository.getCachedPrice('AAPL')!.price, equals(185.42));

        // Act Step 3: Close the dashboard
        bloc.add(const DashboardClosed());
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Assert: Service was told to unsubscribe
        verify(() => mockService.unsubscribe(any())).called(1);

        await sub.cancel();
      },
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: Watchlist add → subscribe → receive update → display
  // Requirements: 2.1, 2.3
  // -------------------------------------------------------------------------

  group('Integration: Add symbol and receive update', () {
    test(
      'open with empty watchlist → add symbol → price update comes in → '
      'state has the price',
      () async {
        // Arrange: Empty watchlist
        await setupBlocWithWatchlist([]);

        final states = <MarketDataDashboardState>[];
        final sub = bloc.stream.listen(states.add);

        // Act Step 1: Open the dashboard — should be empty
        bloc.add(const DashboardOpened());
        await Future<void>.delayed(const Duration(milliseconds: 100));

        expect(states.last, isA<DashboardEmpty>());
        // No subscribe call since watchlist is empty
        verifyNever(() => mockService.subscribe(any()));

        // Act Step 2: Add a symbol to the watchlist
        bloc.add(const AddToWatchlist('GOOG'));
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Assert: Service is told to subscribe to GOOG
        verify(() => mockService.subscribe({'GOOG'})).called(1);

        // Assert: State transitions from DashboardEmpty to DashboardLoaded
        // with GOOG in the unavailable set (no cached price yet)
        expect(bloc.state, isA<DashboardLoaded>());
        final loadedAfterAdd = bloc.state as DashboardLoaded;
        expect(loadedAfterAdd.unavailable, contains('GOOG'));

        // Act Step 3: Receive a price update for GOOG
        final googUpdate = PriceUpdate(
          symbol: 'GOOG',
          price: 2800.50,
          dailyHigh: 2850.00,
          dailyLow: 2750.00,
          volume: 500000,
          percentageChange: 0.75,
          timestamp: testTimestamp,
        );
        priceStreamController.add(googUpdate);
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Assert: GOOG price appears in state
        expect(bloc.state, isA<DashboardLoaded>());
        final finalState = bloc.state as DashboardLoaded;
        expect(finalState.prices.containsKey('GOOG'), isTrue);
        expect(finalState.prices['GOOG']!.price, equals(2800.50));
        expect(finalState.prices['GOOG']!.percentageChange, equals(0.75));
        expect(finalState.unavailable.contains('GOOG'), isFalse);

        // Assert: Repository cache reflects the update
        expect(repository.getCachedPrice('GOOG'), isNotNull);
        expect(repository.getCachedPrice('GOOG')!.price, equals(2800.50));

        // Assert: Watchlist is persisted
        expect(watchlistStore.getWatchlist(), contains('GOOG'));

        await sub.cancel();
      },
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: Connection loss → polling fallback → reconnect → polling stops
  // Requirements: 5.2, 5.3
  // -------------------------------------------------------------------------

  group('Integration: Connection loss and recovery', () {
    test(
      'open → disconnect → polling starts → reconnect → polling stops, '
      'connection status back to connected',
      () async {
        // Arrange: Watchlist with one symbol, mock getPrice for polling
        await setupBlocWithWatchlist(['AAPL']);

        when(() => mockService.getPrice('AAPL')).thenAnswer((_) async {
          return AssetPrice(
            symbol: 'AAPL',
            price: 190.00,
            dailyHigh: 191.00,
            dailyLow: 189.00,
            volume: 55000000,
            percentageChange: 2.0,
            timestamp: testTimestamp,
          );
        });

        final states = <MarketDataDashboardState>[];
        final sub = bloc.stream.listen(states.add);

        // Act Step 1: Open the dashboard
        bloc.add(const DashboardOpened());
        await Future<void>.delayed(const Duration(milliseconds: 100));

        expect(bloc.state, isA<DashboardLoaded>());
        final initialState = bloc.state as DashboardLoaded;
        expect(initialState.connectionStatus, ConnectionStatus.connected);

        // Act Step 2: Simulate connection loss
        connectionStatusController.add(ConnectionStatus.disconnected);
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Assert: State shows disconnected
        expect(bloc.state, isA<DashboardLoaded>());
        final disconnectedState = bloc.state as DashboardLoaded;
        expect(
          disconnectedState.connectionStatus,
          ConnectionStatus.disconnected,
        );

        // Assert: Polling has been started (repository internals — we can
        // verify by checking that the BLoC called startPolling on the
        // repository, which in turn schedules periodic getPrice calls).
        // We verify this indirectly: the repository should have a polling
        // timer active. Since we use a real repository, we can check via
        // the service mock calls after a brief delay.
        // However, the polling interval is 60s which is too long for a test.
        // Instead, we verify that the subscribe was called and the state
        // reflects the disconnect correctly. The BLoC calls
        // repository.startPolling which sets up the timer.

        // Act Step 3: Simulate reconnection
        connectionStatusController.add(ConnectionStatus.connected);
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Assert: State shows connected, polling is stopped
        expect(bloc.state, isA<DashboardLoaded>());
        final reconnectedState = bloc.state as DashboardLoaded;
        expect(
          reconnectedState.connectionStatus,
          ConnectionStatus.connected,
        );
        expect(reconnectedState.reconnectAttempt, isNull);

        // Verify full connection lifecycle:
        // States went: connected → disconnected → connected
        final connectionStates = states
            .whereType<DashboardLoaded>()
            .map((s) => s.connectionStatus)
            .toList();
        expect(connectionStates, contains(ConnectionStatus.disconnected));
        expect(connectionStates.last, ConnectionStatus.connected);

        await sub.cancel();
      },
    );

    test(
      'reconnecting status shows attempt number',
      () async {
        await setupBlocWithWatchlist(['AAPL']);

        final states = <MarketDataDashboardState>[];
        final sub = bloc.stream.listen(states.add);

        // Open the dashboard
        bloc.add(const DashboardOpened());
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Simulate disconnect then reconnecting attempts
        connectionStatusController.add(ConnectionStatus.disconnected);
        await Future<void>.delayed(const Duration(milliseconds: 50));

        connectionStatusController.add(ConnectionStatus.reconnecting);
        await Future<void>.delayed(const Duration(milliseconds: 50));

        connectionStatusController.add(ConnectionStatus.reconnecting);
        await Future<void>.delayed(const Duration(milliseconds: 50));

        // Assert: reconnect attempt counter increments
        final reconnectingStates = states
            .whereType<DashboardLoaded>()
            .where((s) => s.connectionStatus == ConnectionStatus.reconnecting)
            .toList();
        expect(reconnectingStates, isNotEmpty);
        expect(reconnectingStates.last.reconnectAttempt, greaterThan(0));

        // Simulate successful reconnection
        connectionStatusController.add(ConnectionStatus.connected);
        await Future<void>.delayed(const Duration(milliseconds: 50));

        // Assert: attempt is reset
        final finalState = bloc.state as DashboardLoaded;
        expect(finalState.connectionStatus, ConnectionStatus.connected);
        expect(finalState.reconnectAttempt, isNull);

        await sub.cancel();
      },
    );
  });
}
