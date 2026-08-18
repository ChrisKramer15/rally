import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';

import '../../data/repositories/market_data_repository.dart';
import '../../domain/models/asset_price.dart';
import '../../domain/models/enums.dart';
import '../../domain/models/price_update.dart';
import 'market_data/market_data_event.dart';
import 'market_data/market_data_state.dart';

export 'market_data/market_data_event.dart';
export 'market_data/market_data_state.dart';

// ---------------------------------------------------------------------------
// BLoC
// ---------------------------------------------------------------------------

/// Manages market data search, asset selection, and connection status.
class MarketDataBloc extends Bloc<MarketDataEvent, MarketDataState> {
  final MarketDataRepository _repository;
  StreamSubscription<ConnectionStatus>? _connectionSubscription;
  StreamSubscription<PriceUpdate>? _priceSubscription;

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

    _priceSubscription = _repository.priceStream.listen(_onPriceUpdate);
  }

  /// Handles incoming price updates from the WebSocket stream.
  ///
  /// If the BLoC is currently displaying an [AssetDetail] for the same symbol,
  /// the state is updated with the new price data.
  void _onPriceUpdate(PriceUpdate update) {
    final currentState = state;
    if (currentState is AssetDetail &&
        currentState.assetPrice.symbol == update.symbol) {
      // ignore: invalid_use_of_visible_for_testing_member
      emit(AssetDetail(AssetPrice(
        symbol: update.symbol,
        price: update.price,
        dailyHigh: update.dailyHigh,
        dailyLow: update.dailyLow,
        volume: update.volume,
        percentageChange: update.percentageChange,
        timestamp: update.timestamp,
      )));
    }
  }

  Future<void> _onSearchAsset(
    SearchAsset event,
    Emitter<MarketDataState> emit,
  ) async {
    if (event.query.isEmpty) return;

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
    _repository.subscribe(event.symbols);
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
    _priceSubscription?.cancel();
    return super.close();
  }
}
