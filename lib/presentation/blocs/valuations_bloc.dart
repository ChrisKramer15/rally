import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../data/repositories/market_data_repository.dart';
import '../../domain/models/enums.dart';
import '../../domain/models/ohlc_candle.dart';
import '../../domain/models/recommendation.dart';
import '../../domain/services/i_valuations_engine.dart';

// --- Events ---

/// Base event for the ValuationsBLoC.
sealed class ValuationsEvent extends Equatable {
  const ValuationsEvent();

  @override
  List<Object?> get props => [];
}

/// Event to load recommendations for a given symbol.
class LoadRecommendations extends ValuationsEvent {
  final String symbol;
  final double currentPrice;
  final List<OhlcCandle> historicalData;

  const LoadRecommendations({
    required this.symbol,
    required this.currentPrice,
    required this.historicalData,
  });

  @override
  List<Object?> get props => [symbol, currentPrice, historicalData];
}

/// Event indicating the price has been updated for a symbol.
class PriceUpdated extends ValuationsEvent {
  final String symbol;
  final double currentPrice;

  const PriceUpdated({
    required this.symbol,
    required this.currentPrice,
  });

  @override
  List<Object?> get props => [symbol, currentPrice];
}

/// Event to check completion of active recommendations against current price.
class CheckCompletion extends ValuationsEvent {
  final double currentPrice;

  const CheckCompletion({required this.currentPrice});

  @override
  List<Object?> get props => [currentPrice];
}

// --- States ---

/// Base state for the ValuationsBLoC.
sealed class ValuationsState extends Equatable {
  const ValuationsState();

  @override
  List<Object?> get props => [];
}

/// Initial state before any recommendations are loaded.
class ValuationsInitial extends ValuationsState {
  const ValuationsInitial();
}

/// Loading state while recommendations are being generated.
class ValuationsLoading extends ValuationsState {
  const ValuationsLoading();
}

/// State containing active and completed recommendations.
class ValuationsLoaded extends ValuationsState {
  final List<Recommendation> active;
  final List<Recommendation> completed;

  const ValuationsLoaded({
    required this.active,
    required this.completed,
  });

  @override
  List<Object?> get props => [active, completed];
}

/// State indicating no recommendations are available.
class NoRecommendations extends ValuationsState {
  const NoRecommendations();
}

// --- BLoC ---

/// BLoC managing trade recommendation state.
///
/// Generates recommendations using [IValuationsEngine], filters incomplete
/// ones, sorts by R:R descending, and tracks completion when prices update.
class ValuationsBloc extends Bloc<ValuationsEvent, ValuationsState> {
  final IValuationsEngine _engine;
  // ignore: unused_field
  final MarketDataRepository _marketDataRepository;

  ValuationsBloc({
    required IValuationsEngine engine,
    required MarketDataRepository marketDataRepository,
  })  : _engine = engine,
        _marketDataRepository = marketDataRepository,
        super(const ValuationsInitial()) {
    on<LoadRecommendations>(_onLoadRecommendations);
    on<PriceUpdated>(_onPriceUpdated);
    on<CheckCompletion>(_onCheckCompletion);
  }

  Future<void> _onLoadRecommendations(
    LoadRecommendations event,
    Emitter<ValuationsState> emit,
  ) async {
    emit(const ValuationsLoading());

    // Identify zones from historical data
    final supplyZones = _engine.identifySupplyZones(event.historicalData);
    final demandZones = _engine.identifyDemandZones(event.historicalData);

    // Generate recommendations
    final recommendations = _engine.generateRecommendations(
      symbol: event.symbol,
      currentPrice: event.currentPrice,
      supplyZones: supplyZones,
      demandZones: demandZones,
    );

    // Filter incomplete recommendations (entry/stop/target must be > 0)
    final filtered = recommendations
        .where((r) =>
            r.entryPrice > 0 && r.stopLossPrice > 0 && r.targetPrice > 0)
        .toList();

    // Sort by R:R descending
    filtered.sort((a, b) => b.rewardRisk.value.compareTo(a.rewardRisk.value));

    if (filtered.isEmpty) {
      emit(const NoRecommendations());
    } else {
      emit(ValuationsLoaded(active: filtered, completed: const []));
    }
  }

  Future<void> _onPriceUpdated(
    PriceUpdated event,
    Emitter<ValuationsState> emit,
  ) async {
    final currentState = state;
    if (currentState is! ValuationsLoaded) return;

    final active = <Recommendation>[];
    final completed = List<Recommendation>.from(currentState.completed);

    for (final rec in currentState.active) {
      if (rec.symbol == event.symbol &&
          _engine.isCompleted(rec, event.currentPrice)) {
        completed
            .add(rec.copyWith(status: RecommendationStatus.completed));
      } else {
        active.add(rec);
      }
    }

    // Re-sort active by R:R descending
    active.sort((a, b) => b.rewardRisk.value.compareTo(a.rewardRisk.value));

    if (active.isEmpty && completed.isEmpty) {
      emit(const NoRecommendations());
    } else {
      emit(ValuationsLoaded(active: active, completed: completed));
    }
  }

  Future<void> _onCheckCompletion(
    CheckCompletion event,
    Emitter<ValuationsState> emit,
  ) async {
    final currentState = state;
    if (currentState is! ValuationsLoaded) return;

    final active = <Recommendation>[];
    final completed = List<Recommendation>.from(currentState.completed);

    for (final rec in currentState.active) {
      if (_engine.isCompleted(rec, event.currentPrice)) {
        completed
            .add(rec.copyWith(status: RecommendationStatus.completed));
      } else {
        active.add(rec);
      }
    }

    // Re-sort active by R:R descending
    active.sort((a, b) => b.rewardRisk.value.compareTo(a.rewardRisk.value));

    if (active.isEmpty && completed.isEmpty) {
      emit(const NoRecommendations());
    } else {
      emit(ValuationsLoaded(active: active, completed: completed));
    }
  }
}
