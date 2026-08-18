import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../data/repositories/market_data_repository.dart';
import '../../../domain/models/asset_price.dart';
import '../../../domain/models/enums.dart';
import '../../../domain/models/price_update.dart';
import '../../../domain/models/watchlist_change_result.dart';
import '../../../domain/services/i_watchlist_store.dart';
import 'market_data_dashboard_event.dart';
import 'market_data_dashboard_state.dart';

export 'market_data_dashboard_event.dart';
export 'market_data_dashboard_state.dart';

/// Manages the live market data dashboard: watchlist subscriptions,
/// price streaming, connection state, and polling fallback.
class MarketDataDashboardBloc
    extends Bloc<MarketDataDashboardEvent, MarketDataDashboardState> {
  final IWatchlistStore _watchlistStore;
  final MarketDataRepository _repository;

  /// Maximum number of reconnection attempts before showing persistent error.
  static const int maxReconnectAttempts = 10;

  StreamSubscription<PriceUpdate>? _priceSubscription;
  StreamSubscription<ConnectionStatus>? _connectionSubscription;
  Timer? _staleCheckTimer;

  /// Symbols currently subscribed to via WebSocket.
  final Set<String> _subscribedSymbols = {};

  /// Per-symbol timeout timers. If no PriceUpdate is received within
  /// 10 seconds of subscribing, the symbol remains in the unavailable set.
  final Map<String, Timer> _symbolTimeouts = {};

  MarketDataDashboardBloc({
    required IWatchlistStore watchlistStore,
    required MarketDataRepository repository,
  })  : _watchlistStore = watchlistStore,
        _repository = repository,
        super(const DashboardLoading()) {
    on<DashboardOpened>(_onDashboardOpened);
    on<DashboardClosed>(_onDashboardClosed);
    on<AddToWatchlist>(_onAddToWatchlist);
    on<RemoveFromWatchlist>(_onRemoveFromWatchlist);
    on<PriceUpdated>(_onPriceUpdated);
    on<ConnectionChanged>(_onConnectionChanged);
    on<StaleCheckTriggered>(_onStaleCheckTriggered);
    on<ManualRetryRequested>(_onManualRetryRequested);
  }

  /// Loads the watchlist, subscribes to all symbols, and emits initial state.
  Future<void> _onDashboardOpened(
    DashboardOpened event,
    Emitter<MarketDataDashboardState> emit,
  ) async {
    final watchlist = _watchlistStore.getWatchlist();

    if (watchlist.isEmpty) {
      emit(const DashboardEmpty());
      _startListening();
      return;
    }

    // Subscribe to all watchlist symbols via the repository.
    final symbols = watchlist.toSet();
    _subscribedSymbols.addAll(symbols);
    _repository.subscribe(symbols);

    // Build initial prices map from cached prices.
    final prices = <String, AssetPrice>{};
    final unavailable = <String>{};
    for (final symbol in watchlist) {
      final cached = _repository.getCachedPrice(symbol);
      if (cached != null) {
        prices[symbol] = cached;
      } else {
        unavailable.add(symbol);
      }
    }

    // Compute initial stale prices.
    final stalePrices = <String>{};
    for (final symbol in prices.keys) {
      if (_repository.isStale(symbol)) {
        stalePrices.add(symbol);
      }
    }

    emit(DashboardLoaded(
      prices: prices,
      stalePrices: stalePrices,
      unavailable: unavailable,
      connectionStatus: ConnectionStatus.connected,
    ));

    // Start 10-second timeout timers for symbols without cached data.
    for (final symbol in unavailable) {
      _startSymbolTimeout(symbol);
    }

    _startListening();
  }

  /// Sets up stream subscriptions for price updates and connection status.
  void _startListening() {
    _priceSubscription = _repository.priceStream.listen(
      (update) => add(PriceUpdated(update)),
    );

    _connectionSubscription = _repository.connectionStatus.listen(
      (status) => add(ConnectionChanged(status)),
    );

    // Periodic stale check every 10 seconds.
    _staleCheckTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => add(const StaleCheckTriggered()),
    );
  }

  /// Starts a 10-second timeout timer for [symbol]. If no PriceUpdate is
  /// received before the timer fires, the symbol stays in the unavailable set.
  void _startSymbolTimeout(String symbol) {
    _symbolTimeouts[symbol]?.cancel();
    _symbolTimeouts[symbol] = Timer(
      const Duration(seconds: 10),
      () {
        // Timer fired — symbol is already in the unavailable set since it was
        // added there on subscribe. No additional state change needed.
        _symbolTimeouts.remove(symbol);
      },
    );
  }

  /// Unsubscribes all streams, cancels timers, and stops polling.
  void _onDashboardClosed(
    DashboardClosed event,
    Emitter<MarketDataDashboardState> emit,
  ) {
    _cleanup();
  }

  /// Cancels all subscriptions, timers, and unsubscribes from the repository.
  void _cleanup() {
    _priceSubscription?.cancel();
    _priceSubscription = null;
    _connectionSubscription?.cancel();
    _connectionSubscription = null;
    _staleCheckTimer?.cancel();
    _staleCheckTimer = null;

    // Cancel all per-symbol timeout timers.
    for (final timer in _symbolTimeouts.values) {
      timer.cancel();
    }
    _symbolTimeouts.clear();

    if (_subscribedSymbols.isNotEmpty) {
      _repository.unsubscribe(_subscribedSymbols);
      _subscribedSymbols.clear();
    }

    _repository.stopPolling();
  }

  /// Adds a symbol to the watchlist and subscribes to its price stream.
  Future<void> _onAddToWatchlist(
    AddToWatchlist event,
    Emitter<MarketDataDashboardState> emit,
  ) async {
    final result = await _watchlistStore.addSymbol(event.symbol);

    switch (result) {
      case WatchlistSymbolAdded(:final symbol):
        // Subscribe to the new symbol.
        _subscribedSymbols.add(symbol);
        _repository.subscribe({symbol});

        // Update state: add symbol to prices (cached if available) or
        // unavailable set.
        final currentState = state;
        if (currentState is DashboardLoaded) {
          final newPrices = Map<String, AssetPrice>.from(currentState.prices);
          final newUnavailable = Set<String>.from(currentState.unavailable);
          final newStalePrices = Set<String>.from(currentState.stalePrices);

          final cached = _repository.getCachedPrice(symbol);
          if (cached != null) {
            newPrices[symbol] = cached;
            if (_repository.isStale(symbol)) {
              newStalePrices.add(symbol);
            }
          } else {
            newUnavailable.add(symbol);
            // Start 10-second timeout for the new symbol.
            _startSymbolTimeout(symbol);
          }

          emit(currentState.copyWith(
            prices: newPrices,
            unavailable: newUnavailable,
            stalePrices: newStalePrices,
          ));
        } else if (currentState is DashboardEmpty) {
          // Transition from empty to loaded.
          final cached = _repository.getCachedPrice(symbol);
          if (cached != null) {
            emit(DashboardLoaded(
              prices: {symbol: cached},
              stalePrices:
                  _repository.isStale(symbol) ? {symbol} : const {},
              unavailable: const {},
            ));
          } else {
            emit(DashboardLoaded(
              prices: const {},
              unavailable: {symbol},
            ));
            // Start 10-second timeout for the new symbol.
            _startSymbolTimeout(symbol);
          }
        }

      case WatchlistAlreadyExists():
        // No state change needed — the symbol is already present.
        // The UI can detect this case if needed from the current state.
        break;

      case WatchlistAtCapacity():
        // No state change needed — the watchlist is full.
        // The UI can detect this case if needed from the current state.
        break;

      case WatchlistSymbolRemoved():
        // Should not happen for addSymbol, but handle gracefully.
        break;

      case WatchlistPersistenceWarning():
        // In-memory add succeeded but persistence failed.
        // Still subscribe to the symbol.
        _subscribedSymbols.add(event.symbol);
        _repository.subscribe({event.symbol});

        final currentState = state;
        if (currentState is DashboardLoaded) {
          final newPrices = Map<String, AssetPrice>.from(currentState.prices);
          final newUnavailable = Set<String>.from(currentState.unavailable);

          final cached = _repository.getCachedPrice(event.symbol);
          if (cached != null) {
            newPrices[event.symbol] = cached;
          } else {
            newUnavailable.add(event.symbol);
            // Start 10-second timeout for the new symbol.
            _startSymbolTimeout(event.symbol);
          }

          emit(currentState.copyWith(
            prices: newPrices,
            unavailable: newUnavailable,
          ));
        }
    }
  }

  /// Removes a symbol from the watchlist and unsubscribes from its stream.
  Future<void> _onRemoveFromWatchlist(
    RemoveFromWatchlist event,
    Emitter<MarketDataDashboardState> emit,
  ) async {
    await _watchlistStore.removeSymbol(event.symbol);

    // Unsubscribe from the symbol.
    _subscribedSymbols.remove(event.symbol);
    _repository.unsubscribe({event.symbol});

    // Cancel any pending timeout timer for this symbol.
    _symbolTimeouts[event.symbol]?.cancel();
    _symbolTimeouts.remove(event.symbol);

    final currentState = state;
    if (currentState is DashboardLoaded) {
      final newPrices = Map<String, AssetPrice>.from(currentState.prices)
        ..remove(event.symbol);
      final newUnavailable = Set<String>.from(currentState.unavailable)
        ..remove(event.symbol);
      final newStalePrices = Set<String>.from(currentState.stalePrices)
        ..remove(event.symbol);

      // If the watchlist is now empty, transition to DashboardEmpty.
      if (newPrices.isEmpty && newUnavailable.isEmpty) {
        emit(const DashboardEmpty());
      } else {
        emit(currentState.copyWith(
          prices: newPrices,
          unavailable: newUnavailable,
          stalePrices: newStalePrices,
        ));
      }
    }
  }

  /// Handles incoming price updates from the WebSocket stream.
  void _onPriceUpdated(
    PriceUpdated event,
    Emitter<MarketDataDashboardState> emit,
  ) {
    final update = event.priceUpdate;

    // Only process updates for symbols we're subscribed to.
    if (!_subscribedSymbols.contains(update.symbol)) return;

    // Cancel the timeout timer for this symbol — data arrived in time.
    _symbolTimeouts[update.symbol]?.cancel();
    _symbolTimeouts.remove(update.symbol);

    // Update the repository cache.
    _repository.updateCacheFromPriceUpdate(update);

    final currentState = state;
    if (currentState is DashboardLoaded) {
      final newPrices = Map<String, AssetPrice>.from(currentState.prices);
      newPrices[update.symbol] = AssetPrice(
        symbol: update.symbol,
        price: update.price,
        dailyHigh: update.dailyHigh,
        dailyLow: update.dailyLow,
        volume: update.volume,
        percentageChange: update.percentageChange,
        timestamp: update.timestamp,
      );

      // Remove from unavailable since we received data.
      final newUnavailable = Set<String>.from(currentState.unavailable)
        ..remove(update.symbol);

      // Remove from stale since this is fresh data.
      final newStalePrices = Set<String>.from(currentState.stalePrices)
        ..remove(update.symbol);

      emit(currentState.copyWith(
        prices: newPrices,
        unavailable: newUnavailable,
        stalePrices: newStalePrices,
        lastDataReceived: () => DateTime.now(),
      ));
    }
  }

  /// Handles connection status changes.
  void _onConnectionChanged(
    ConnectionChanged event,
    Emitter<MarketDataDashboardState> emit,
  ) {
    final currentState = state;
    if (currentState is DashboardLoaded) {
      switch (event.connectionStatus) {
        case ConnectionStatus.disconnected:
          // Start REST polling fallback.
          if (_subscribedSymbols.isNotEmpty) {
            _repository.startPolling(_subscribedSymbols);
          }
          emit(currentState.copyWith(
            connectionStatus: ConnectionStatus.disconnected,
          ));

        case ConnectionStatus.reconnecting:
          final currentAttempt =
              (currentState.reconnectAttempt ?? 0) + 1;
          emit(currentState.copyWith(
            connectionStatus: ConnectionStatus.reconnecting,
            reconnectAttempt: () => currentAttempt,
          ));

        case ConnectionStatus.connected:
          // Stop polling — WebSocket is back.
          _repository.stopPolling();
          emit(currentState.copyWith(
            connectionStatus: ConnectionStatus.connected,
            reconnectAttempt: () => null,
          ));
      }
    }
  }

  /// Re-evaluates which prices are stale.
  void _onStaleCheckTriggered(
    StaleCheckTriggered event,
    Emitter<MarketDataDashboardState> emit,
  ) {
    final currentState = state;
    if (currentState is DashboardLoaded) {
      final stalePrices = <String>{};
      for (final symbol in currentState.prices.keys) {
        if (_repository.isStale(symbol)) {
          stalePrices.add(symbol);
        }
      }

      // Only emit if staleness set changed.
      if (stalePrices.length != currentState.stalePrices.length ||
          !stalePrices.containsAll(currentState.stalePrices)) {
        emit(currentState.copyWith(stalePrices: stalePrices));
      }
    }
  }

  /// Resets reconnection and triggers a fresh attempt.
  void _onManualRetryRequested(
    ManualRetryRequested event,
    Emitter<MarketDataDashboardState> emit,
  ) {
    final currentState = state;
    if (currentState is DashboardLoaded) {
      emit(currentState.copyWith(
        connectionStatus: ConnectionStatus.reconnecting,
        reconnectAttempt: () => 1,
      ));
    }

    // Re-subscribe to trigger a fresh connection via the repository/service.
    if (_subscribedSymbols.isNotEmpty) {
      _repository.subscribe(_subscribedSymbols);
    }
  }

  @override
  Future<void> close() {
    _cleanup();
    return super.close();
  }
}
