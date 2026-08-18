import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../data/repositories/market_data_repository.dart';
import '../../domain/models/holding.dart';
import '../../domain/models/portfolio_summary.dart';
import '../../domain/services/i_portfolio_tracker.dart';

// --- Events ---

/// Base class for all portfolio events.
sealed class PortfolioEvent extends Equatable {
  const PortfolioEvent();

  @override
  List<Object?> get props => [];
}

/// Triggers loading of the portfolio from the tracker.
class LoadPortfolio extends PortfolioEvent {
  const LoadPortfolio();
}

/// Adds a new holding to the portfolio.
class AddHolding extends PortfolioEvent {
  final String symbol;
  final double quantity;
  final double price;

  const AddHolding({
    required this.symbol,
    required this.quantity,
    required this.price,
  });

  @override
  List<Object?> get props => [symbol, quantity, price];
}

/// Removes a holding from the portfolio by symbol.
class RemoveHolding extends PortfolioEvent {
  final String symbol;

  const RemoveHolding({required this.symbol});

  @override
  List<Object?> get props => [symbol];
}

/// Notifies the BLoC that market prices have been updated.
class PriceUpdated extends PortfolioEvent {
  final Map<String, double> prices;

  const PriceUpdated({required this.prices});

  @override
  List<Object?> get props => [prices];
}

// --- States ---

/// Base class for all portfolio states.
sealed class PortfolioState extends Equatable {
  const PortfolioState();

  @override
  List<Object?> get props => [];
}

/// The portfolio is currently being loaded.
class PortfolioLoading extends PortfolioState {
  const PortfolioLoading();
}

/// The portfolio has been loaded successfully.
class PortfolioLoaded extends PortfolioState {
  final PortfolioSummary summary;
  final List<Holding> holdings;

  const PortfolioLoaded({
    required this.summary,
    required this.holdings,
  });

  @override
  List<Object?> get props => [summary, holdings];
}

/// The portfolio contains no holdings.
class PortfolioEmpty extends PortfolioState {
  const PortfolioEmpty();
}

/// An error occurred during a portfolio operation.
class PortfolioError extends PortfolioState {
  final String message;

  const PortfolioError({required this.message});

  @override
  List<Object?> get props => [message];
}

// --- BLoC ---

/// BLoC managing portfolio state, wired to [IPortfolioTracker] for domain
/// logic and [MarketDataRepository] for price data.
///
/// Recalculates portfolio valuations within 2 seconds of receiving a
/// [PriceUpdated] event.
class PortfolioBloc extends Bloc<PortfolioEvent, PortfolioState> {
  final IPortfolioTracker _tracker;
  final MarketDataRepository _marketDataRepository;

  /// Stores the last known prices for recalculation.
  Map<String, double> _latestPrices = {};

  StreamSubscription<dynamic>? _priceSubscription;

  PortfolioBloc({
    required IPortfolioTracker tracker,
    required MarketDataRepository marketDataRepository,
  })  : _tracker = tracker,
        _marketDataRepository = marketDataRepository,
        super(const PortfolioLoading()) {
    on<LoadPortfolio>(_onLoadPortfolio);
    on<AddHolding>(_onAddHolding);
    on<RemoveHolding>(_onRemoveHolding);
    on<PriceUpdated>(_onPriceUpdated);

    // Subscribe to real-time price updates and dispatch PriceUpdated events.
    _priceSubscription = _marketDataRepository.priceStream.listen((update) {
      _latestPrices[update.symbol] = update.price;
      add(PriceUpdated(prices: Map.from(_latestPrices)));
    });
  }

  void _onLoadPortfolio(
    LoadPortfolio event,
    Emitter<PortfolioState> emit,
  ) {
    emit(const PortfolioLoading());

    final holdings = _tracker.getHoldings();

    if (holdings.isEmpty) {
      emit(const PortfolioEmpty());
      return;
    }

    final summary = _tracker.recalculate(_latestPrices);
    emit(PortfolioLoaded(summary: summary, holdings: holdings));
  }

  void _onAddHolding(
    AddHolding event,
    Emitter<PortfolioState> emit,
  ) {
    final result = _tracker.addHolding(
      symbol: event.symbol,
      quantity: event.quantity,
      averagePurchasePrice: event.price,
    );

    result.fold(
      onSuccess: (_) {
        // Reload the portfolio after a successful add.
        final holdings = _tracker.getHoldings();
        final summary = _tracker.recalculate(_latestPrices);
        emit(PortfolioLoaded(summary: summary, holdings: holdings));
      },
      onFailure: (error) {
        emit(PortfolioError(message: error));
      },
    );
  }

  void _onRemoveHolding(
    RemoveHolding event,
    Emitter<PortfolioState> emit,
  ) {
    final result = _tracker.removeHolding(event.symbol);

    result.fold(
      onSuccess: (_) {
        final holdings = _tracker.getHoldings();
        if (holdings.isEmpty) {
          emit(const PortfolioEmpty());
        } else {
          final summary = _tracker.recalculate(_latestPrices);
          emit(PortfolioLoaded(summary: summary, holdings: holdings));
        }
      },
      onFailure: (error) {
        emit(PortfolioError(message: error));
      },
    );
  }

  void _onPriceUpdated(
    PriceUpdated event,
    Emitter<PortfolioState> emit,
  ) {
    _latestPrices = Map.from(event.prices);

    final holdings = _tracker.getHoldings();
    if (holdings.isEmpty) {
      return;
    }

    final summary = _tracker.recalculate(_latestPrices);
    emit(PortfolioLoaded(summary: summary, holdings: holdings));
  }

  @override
  Future<void> close() {
    _priceSubscription?.cancel();
    return super.close();
  }
}
