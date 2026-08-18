import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../data/repositories/market_data_repository.dart';
import '../../domain/models/asset_price.dart';
import '../../domain/models/asset_search_result.dart';
import '../../domain/models/enums.dart';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Base class for all MarketData events.
sealed class MarketDataEvent extends Equatable {
  const MarketDataEvent();

  @override
  List<Object?> get props => [];
}

/// Triggers a search for assets matching [query].
class SearchAsset extends MarketDataEvent {
  final String query;

  const SearchAsset(this.query);

  @override
  List<Object?> get props => [query];
}

/// Selects an asset by [symbol] to load detailed price info.
class SelectAsset extends MarketDataEvent {
  final String symbol;

  const SelectAsset(this.symbol);

  @override
  List<Object?> get props => [symbol];
}

/// Subscribes to real-time price updates for a set of [symbols].
class SubscribeSymbols extends MarketDataEvent {
  final Set<String> symbols;

  const SubscribeSymbols(this.symbols);

  @override
  List<Object?> get props => [symbols];
}

/// Internal event triggered when the connection status changes.
class ConnectionStatusChanged extends MarketDataEvent {
  final ConnectionStatus status;

  const ConnectionStatusChanged(this.status);

  @override
  List<Object?> get props => [status];
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/// Base class for all MarketData states.
sealed class MarketDataState extends Equatable {
  const MarketDataState();

  @override
  List<Object?> get props => [];
}

/// Initial state before any interaction.
class MarketDataInitial extends MarketDataState {
  const MarketDataInitial();
}

/// Searching for assets (loading state).
class Searching extends MarketDataState {
  const Searching();
}

/// Search completed with results.
class SearchResults extends MarketDataState {
  final List<AssetSearchResult> results;

  const SearchResults(this.results);

  @override
  List<Object?> get props => [results];
}

/// Search returned no matching assets.
class NoResults extends MarketDataState {
  const NoResults();
}

/// Asset detail loaded for a selected symbol.
class AssetDetail extends MarketDataState {
  final AssetPrice assetPrice;

  const AssetDetail(this.assetPrice);

  @override
  List<Object?> get props => [assetPrice];
}

/// An error occurred while performing a market data operation.
class MarketDataError extends MarketDataState {
  final String message;

  const MarketDataError(this.message);

  @override
  List<Object?> get props => [message];
}

/// Connection to market data service was lost.
class ConnectionWarning extends MarketDataState {
  final DateTime lastUpdated;

  const ConnectionWarning(this.lastUpdated);

  @override
  List<Object?> get props => [lastUpdated];
}

// ---------------------------------------------------------------------------
// BLoC
// ---------------------------------------------------------------------------

/// Manages market data search, asset selection, and connection status.
class MarketDataBloc extends Bloc<MarketDataEvent, MarketDataState> {
  final MarketDataRepository _repository;
  StreamSubscription<ConnectionStatus>? _connectionSubscription;

  MarketDataBloc({required MarketDataRepository repository})
      : _repository = repository,
        super(const MarketDataInitial()) {
    on<SearchAsset>(_onSearchAsset);
    on<SelectAsset>(_onSelectAsset);
    on<SubscribeSymbols>(_onSubscribeSymbols);
    on<ConnectionStatusChanged>(_onConnectionStatusChanged);

    _connectionSubscription = _repository.connectionStatus.listen(
      (status) => add(ConnectionStatusChanged(status)),
    );
  }

  Future<void> _onSearchAsset(
    SearchAsset event,
    Emitter<MarketDataState> emit,
  ) async {
    // Enforce minimum 1 character search input (Requirement 2.3).
    if (event.query.length < 1) return;

    emit(const Searching());

    try {
      final results = await _repository.searchAssets(event.query);
      if (results.isEmpty) {
        emit(const NoResults());
      } else {
        emit(SearchResults(results));
      }
    } catch (e) {
      emit(MarketDataError(e.toString()));
    }
  }

  Future<void> _onSelectAsset(
    SelectAsset event,
    Emitter<MarketDataState> emit,
  ) async {
    try {
      final price = await _repository.getPrice(event.symbol);
      emit(AssetDetail(price));
    } catch (e) {
      emit(MarketDataError(e.toString()));
    }
  }

  void _onSubscribeSymbols(
    SubscribeSymbols event,
    Emitter<MarketDataState> emit,
  ) {
    _repository.startPolling(event.symbols);
  }

  void _onConnectionStatusChanged(
    ConnectionStatusChanged event,
    Emitter<MarketDataState> emit,
  ) {
    if (event.status == ConnectionStatus.disconnected ||
        event.status == ConnectionStatus.reconnecting) {
      emit(ConnectionWarning(DateTime.now()));
    }
  }

  @override
  Future<void> close() {
    _connectionSubscription?.cancel();
    return super.close();
  }
}
